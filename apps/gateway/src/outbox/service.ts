import { randomUUID } from "node:crypto";
import { and, eq, inArray, lte } from "drizzle-orm";
import type { OutboxItem } from "@errand/shared";
import type { AdmittedCall, Forwarder } from "../agent/forward.ts";
import type { Db } from "../db/client.ts";
import { appendJournalEventIn } from "../db/journal.ts";
import { outbox, type OutboxClass } from "../db/schema.ts";
import { getOutboxItem, getSlip, listOutbox } from "../db/scoped-reads.ts";
import { admitCall } from "../policy/pipeline.ts";
import { releaseCall } from "../policy/reservation.ts";
import { SEND_EXPIRY_GRACE_MS, SEND_HOLD_MS, SPEND_TAP_TTL_MS } from "./constants.ts";
import { outboxView, type OutboxRow } from "./view.ts";

export type OutboxErrorCode = "not_found" | "not_pending" | "not_confirmable" | "expired";

export class OutboxError extends Error {
  constructor(
    readonly code: OutboxErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OutboxError";
  }
}

const PENDING_STATES = ["held", "needs_human"] as const;

export type OutboxService = {
  hold(userId: string, decision: AdmittedCall, args: Record<string, unknown>): OutboxItem;
  needsHuman(userId: string, decision: AdmittedCall, args: Record<string, unknown>): OutboxItem;
  list(userId: string): OutboxItem[];
  cancel(userId: string, id: string, now?: Date): OutboxItem;
  confirm(userId: string, id: string, now?: Date): Promise<OutboxItem>;
  releaseDue(now?: Date): Promise<number>;
};

export type OutboxServiceOptions = {
  db: Db;
  forward: Forwarder;
  hmacKey?: string | undefined;
};

function isPending(state: OutboxRow["state"]): boolean {
  return state === "held" || state === "needs_human";
}

function earliest(...values: string[]): string {
  return values.reduce((left, right) => (Date.parse(left) <= Date.parse(right) ? left : right));
}

function create(
  db: Db,
  userId: string,
  decision: AdmittedCall,
  args: Record<string, unknown>,
  toolClass: OutboxClass,
  now: Date,
): OutboxItem {
  const slip = getSlip(db, userId, decision.slipId);
  if (slip === undefined) {
    throw new Error(`Slip ${decision.slipId} vanished before it reached the outbox`);
  }
  const id = randomUUID();
  const createdAt = now.toISOString();
  const releaseAt =
    toolClass === "send"
      ? new Date(now.getTime() + SEND_HOLD_MS).toISOString()
      : null;
  const expiresAt =
    toolClass === "send"
      ? earliest(slip.expiresAt, new Date(now.getTime() + SEND_HOLD_MS + SEND_EXPIRY_GRACE_MS).toISOString())
      : earliest(slip.expiresAt, new Date(now.getTime() + SPEND_TAP_TTL_MS).toISOString());

  db.transaction((tx) => {
    tx.insert(outbox)
      .values({
        id,
        userId,
        slipId: decision.slipId,
        connectorId: decision.connectorId,
        tool: decision.tool,
        toolClass,
        arguments: JSON.stringify(args),
        capability: decision.capability,
        amountCents: decision.amountCents,
        state: toolClass === "send" ? "held" : "needs_human",
        releaseAt,
        expiresAt,
        createdAt,
        updatedAt: createdAt,
      })
      .run();
    appendJournalEventIn(tx, {
      userId,
      eventType: toolClass === "send" ? "outbox.held" : "outbox.needs_human",
      payload: {
        outbox_id: id,
        slip_id: decision.slipId,
        tool: decision.tool,
        class: toolClass,
        amount_cents: decision.amountCents,
        release_at: releaseAt,
        expires_at: expiresAt,
      },
    });
  });

  const row = getOutboxItem(db, userId, id);
  if (row === undefined) throw new Error(`Outbox item ${id} vanished after insert`);
  return outboxView(db, userId, row);
}

function claim(
  db: Pick<Db, "update">,
  userId: string,
  id: string,
  from: OutboxRow["state"][],
  to: OutboxRow["state"],
  now: Date,
  reason: string | null = null,
): OutboxRow | undefined {
  return db
    .update(outbox)
    .set({ state: to, reason, updatedAt: now.toISOString() })
    .where(and(eq(outbox.userId, userId), eq(outbox.id, id), inArray(outbox.state, from)))
    .returning()
    .all()[0];
}

function expire(db: Db, row: OutboxRow, reason: string, now: Date): void {
  db.transaction((tx) => {
    const updated = claim(
      tx,
      row.userId,
      row.id,
      [...PENDING_STATES, "releasing"],
      "expired",
      now,
      reason,
    );
    if (updated === undefined) return;
    releaseCall(tx, {
      userId: row.userId,
      slipId: row.slipId,
      amountCents: row.amountCents,
      now,
    });
    appendJournalEventIn(tx, {
      userId: row.userId,
      eventType: "outbox.expired",
      payload: {
        outbox_id: row.id,
        slip_id: row.slipId,
        tool: row.tool,
        class: row.toolClass,
        reason,
        expires_at: row.expiresAt,
      },
    });
  });
}

function revalidate(
  db: Db,
  row: OutboxRow,
  hmacKey: string | undefined,
  now: Date,
): AdmittedCall | { reason: string; message: string } {
  const decision = admitCall(
    db,
    row.userId,
    {
      slipId: row.slipId,
      tool: row.tool,
      capability: row.capability,
      arguments: JSON.parse(row.arguments) as Record<string, unknown>,
    },
    { hmacKey, now, reserve: false },
  );
  return decision.outcome === "admitted"
    ? decision
    : { reason: decision.reason, message: decision.message };
}

async function run(
  db: Db,
  forward: Forwarder,
  hmacKey: string | undefined,
  row: OutboxRow,
  now: Date,
): Promise<OutboxRow> {
  const check = revalidate(db, row, hmacKey, now);
  if ("reason" in check) {
    expire(db, row, check.reason, now);
    const expired = getOutboxItem(db, row.userId, row.id);
    if (expired === undefined) throw new Error(`Outbox item ${row.id} vanished while expiring`);
    return expired;
  }

  const outcome = await forward(row.userId, check, JSON.parse(row.arguments) as Record<string, unknown>);
  const state = row.toolClass === "send" ? "released" : "confirmed";
  const callId = outcome.state === "forwarded" ? outcome.callId : null;
  const reason = outcome.state === "failed" ? outcome.message : null;
  const finalize = (tx: Pick<Db, "update">) => {
    tx.update(outbox)
      .set({ state, callId, reason, updatedAt: now.toISOString() })
      .where(and(eq(outbox.userId, row.userId), eq(outbox.id, row.id)))
      .run();
  };
  if (row.toolClass === "send") {
    db.transaction((tx) => {
      finalize(tx);
      appendJournalEventIn(tx, {
        userId: row.userId,
        eventType: "outbox.released",
        payload: {
          outbox_id: row.id,
          slip_id: row.slipId,
          tool: row.tool,
          class: row.toolClass,
          call_id: callId,
          outcome: outcome.state === "failed" ? "failed" : "succeeded",
          reason,
        },
      });
    });
  } else {
    finalize(db);
  }
  const final = getOutboxItem(db, row.userId, row.id);
  if (final === undefined) throw new Error(`Outbox item ${row.id} vanished after release`);
  return final;
}

export function createOutboxService(options: OutboxServiceOptions): OutboxService {
  const { db, forward, hmacKey } = options;
  let releasing = false;

  return {
    hold(userId, decision, args) {
      return create(db, userId, decision, args, "send", new Date());
    },
    needsHuman(userId, decision, args) {
      return create(db, userId, decision, args, "spend", new Date());
    },
    list(userId) {
      const items = listOutbox(db, userId).map((row) => outboxView(db, userId, row));
      return items
        .sort((left, right) => {
          const leftPending = isPending(left.state) ? 1 : 0;
          const rightPending = isPending(right.state) ? 1 : 0;
          return rightPending - leftPending || right.createdAt.localeCompare(left.createdAt);
        })
        .slice(0, 50);
    },
    cancel(userId, id, now = new Date()) {
      const row = getOutboxItem(db, userId, id);
      if (row === undefined) throw new OutboxError("not_found", `No outbox item ${id}`);
      if (!isPending(row.state)) {
        throw new OutboxError("not_pending", `Outbox item ${id} is already ${row.state}`);
      }
      if (Date.parse(row.expiresAt) <= now.getTime()) {
        expire(db, row, "expired", now);
        const expired = getOutboxItem(db, userId, id);
        if (expired === undefined) throw new Error(`Outbox item ${id} vanished`);
        return outboxView(db, userId, expired);
      }

      const cancelled = db.transaction((tx) => {
        const updated = claim(tx, userId, id, [...PENDING_STATES], "cancelled", now, "human_cancelled");
        if (updated === undefined) return undefined;
        releaseCall(tx, { userId, slipId: row.slipId, amountCents: row.amountCents, now });
        appendJournalEventIn(tx, {
          userId,
          eventType: "outbox.cancelled",
          payload: {
            outbox_id: id,
            slip_id: row.slipId,
            tool: row.tool,
            class: row.toolClass,
            reason: "human_cancelled",
          },
        });
        return updated;
      });
      if (cancelled === undefined) throw new OutboxError("not_pending", `Outbox item ${id} was just decided`);
      return outboxView(db, userId, cancelled);
    },
    async confirm(userId, id, now = new Date()) {
      const row = getOutboxItem(db, userId, id);
      if (row === undefined) throw new OutboxError("not_found", `No outbox item ${id}`);
      if (row.toolClass !== "spend") {
        throw new OutboxError("not_confirmable", `Outbox item ${id} is a send, not a spend`);
      }
      if (!isPending(row.state)) {
        throw new OutboxError("not_pending", `Outbox item ${id} is already ${row.state}`);
      }
      if (Date.parse(row.expiresAt) <= now.getTime()) {
        expire(db, row, "expired", now);
        throw new OutboxError("expired", `Outbox item ${id} expired before the tap`);
      }

      const claimed = db.transaction((tx) => {
        const updated = claim(tx, userId, id, ["needs_human"], "releasing", now);
        if (updated === undefined) return undefined;
        appendJournalEventIn(tx, {
          userId,
          eventType: "outbox.confirmed",
          payload: {
            outbox_id: id,
            slip_id: row.slipId,
            tool: row.tool,
            class: row.toolClass,
            amount_cents: row.amountCents,
          },
        });
        return updated;
      });
      if (claimed === undefined) throw new OutboxError("not_pending", `Outbox item ${id} was just decided`);
      const final = await run(db, forward, hmacKey, claimed, now);
      if (final.state === "expired") {
        throw new OutboxError("expired", `Outbox item ${id} could no longer run`);
      }
      return outboxView(db, userId, final);
    },
    async releaseDue(now = new Date()) {
      if (releasing) return 0;
      releasing = true;
      try {
        const due = db
          .select()
          .from(outbox)
          .where(and(eq(outbox.state, "held"), lte(outbox.releaseAt, now.toISOString())))
          .all();
        let fired = 0;
        for (const row of due) {
          if (Date.parse(row.expiresAt) <= now.getTime()) {
            expire(db, row, "expired", now);
            continue;
          }
          const claimed = claim(db, row.userId, row.id, ["held"], "releasing", now);
          if (claimed === undefined) continue;
          const final = await run(db, forward, hmacKey, claimed, now);
          if (final.state === "released") fired++;
        }
        return fired;
      } finally {
        releasing = false;
      }
    },
  };
}
