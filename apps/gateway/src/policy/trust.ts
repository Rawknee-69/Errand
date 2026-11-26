import {
  CLEAN_RUNS_FOR_LICENSE,
  trustCapsSchema,
  type TrustCaps,
  type TrustView,
} from "@errand/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { appendJournalEventIn } from "../db/journal.ts";
import { calls, receipts, slips, trust } from "../db/schema.ts";
import {
  getSlip,
  getTrust,
  listCalls,
  listReceipts,
  listSlips,
  listTrust,
} from "../db/scoped-reads.ts";
import { parseSlipTools } from "../agent/slip-tools.ts";
import type { SlipRow } from "../slips/row.ts";

type TrustRow = typeof trust.$inferSelect;
export type RunSlip = Pick<
  SlipRow,
  "state" | "tools" | "scopeViolations" | "callsUsed" | "callCap" | "expiresAt" | "settledAt"
>;

type RunCall = Pick<typeof calls.$inferSelect, "id" | "tool" | "error" | "result">;
type RunReceipt = Pick<typeof receipts.$inferSelect, "callId" | "verification">;

type UncleanRunReason =
  | "scope_violation"
  | "call_failed"
  | "receipt_missing"
  | "receipt_mismatched"
  | "receipt_unverified"
  | "unclean_run";

type RunVerdict = "clean" | "empty" | "pending" | { unclean: UncleanRunReason };

export function parseTrustCaps(json: string): TrustCaps | null {
  try {
    const parsed = trustCapsSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function trustView(row: TrustRow, tools: string[]): TrustView {
  return {
    errandType: row.errandType,
    tools,
    tier: row.tier,
    cleanRuns: row.cleanRuns,
    licenseOffered: row.tier === "learner" && row.cleanRuns >= CLEAN_RUNS_FOR_LICENSE,
    caps: parseTrustCaps(row.caps),
    updatedAt: row.updatedAt,
  };
}

// The trust key is a hash; the human needs the tools that hash represents.
function toolsForType(db: Db, userId: string, errandType: string): string[] {
  const slip = listSlips(db, userId).find((row) => row.errandType === errandType);
  return slip === undefined ? [] : parseSlipTools(slip.tools).map((tool) => tool.name);
}

type TrustWriter = Pick<Db, "select" | "insert" | "update">;

// A first sighting is always a learner; no path may create trust already earned.
export function ensureLearnerTrust(
  writer: TrustWriter,
  userId: string,
  errandType: string,
  now = new Date(),
): TrustRow {
  const at = now.toISOString();
  writer
    .insert(trust)
    .values({
      userId,
      errandType,
      tier: "learner",
      cleanRuns: 0,
      caps: "{}",
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoNothing()
    .run();
  const row = writer
    .select()
    .from(trust)
    .where(and(eq(trust.userId, userId), eq(trust.errandType, errandType)))
    .all()[0];
  if (row === undefined) throw new Error(`Trust for ${errandType} was not stored`);
  return row;
}

// A run is clean only when every successful change has a matched receipt; no
// verifier means the run was not verified, so it does not earn trust.
export function evaluateRun(slip: RunSlip, calls: RunCall[], receipts: RunReceipt[]): RunVerdict {
  if (slip.scopeViolations > 0) return { unclean: "scope_violation" };
  // An admitted call without a row may still be in the forwarder or the outbox;
  // settling now would judge a run that has not finished.
  if (slip.callsUsed !== calls.length) return "pending";
  if (calls.length === 0) return "empty";
  const succeeded = calls.filter((call) => call.error === null && call.result !== null);
  if (succeeded.length === 0) return { unclean: "call_failed" };
  if (calls.some((call) => call.error !== null)) return { unclean: "call_failed" };

  const classes = new Map(parseSlipTools(slip.tools).map((tool) => [tool.name, tool.class]));
  for (const call of succeeded) {
    if (classes.get(call.tool) === "read") continue;
    const receipt = receipts.find((entry) => entry.callId === call.id);
    if (receipt === undefined) return { unclean: "receipt_missing" };
    if (receipt.verification === "mismatched") return { unclean: "receipt_mismatched" };
    if (receipt.verification === "unverified") return { unclean: "receipt_unverified" };
  }
  return "clean";
}

function runFinished(
  slip: Pick<SlipRow, "callsUsed" | "callCap" | "expiresAt">,
  now: Date,
): boolean {
  return slip.callsUsed >= slip.callCap || Date.parse(slip.expiresAt) <= now.getTime();
}

export function settleRuns(db: Db, userId: string, now = new Date()): void {
  for (const slip of listSlips(db, userId)) {
    if (slip.state !== "approved" || slip.settledAt !== null) continue;
    if (runFinished(slip, now)) settleSlip(db, userId, slip.id, now);
  }
}

export function settleSlip(db: Db, userId: string, slipId: string, now = new Date()): void {
  const slip = getSlip(db, userId, slipId);
  if (slip === undefined || slip.state !== "approved" || slip.settledAt !== null) return;
  if (!runFinished(slip, now)) return;

  const verdict = evaluateRun(
    slip,
    listCalls(db, userId).filter((call) => call.slipId === slip.id),
    listReceipts(db, userId).filter((receipt) => receipt.slipId === slip.id),
  );
  if (verdict === "pending") return;
  const at = now.toISOString();

  db.transaction((tx) => {
    const claimed = tx
      .update(slips)
      .set({ settledAt: at })
      .where(and(eq(slips.userId, userId), eq(slips.id, slip.id), isNull(slips.settledAt)))
      .returning({ id: slips.id })
      .all();
    if (claimed.length !== 1 || verdict === "empty") return;

    const trustRow = ensureLearnerTrust(tx, userId, slip.errandType, now);
    if (verdict === "clean") {
      const event = appendJournalEventIn(tx, {
        userId,
        eventType: "trust.run_clean",
        payload: {
          slip_id: slip.id,
          errand_type: slip.errandType,
          clean_runs: trustRow.cleanRuns + 1,
        },
      });
      tx.update(trust)
        .set({ cleanRuns: trustRow.cleanRuns + 1, updatedAt: event.createdAt })
        .where(and(eq(trust.userId, userId), eq(trust.errandType, slip.errandType)))
        .run();
      if (trustRow.tier === "learner" && trustRow.cleanRuns + 1 === CLEAN_RUNS_FOR_LICENSE) {
        appendJournalEventIn(tx, {
          userId,
          eventType: "trust.license_offered",
          payload: { errand_type: slip.errandType, clean_runs: trustRow.cleanRuns + 1 },
        });
      }
      return;
    }

    appendJournalEventIn(tx, {
      userId,
      eventType: "trust.run_unclean",
      payload: {
        slip_id: slip.id,
        errand_type: slip.errandType,
        reason: verdict.unclean,
      },
    });
    demoteTrust(tx, userId, slip.errandType, "unclean_run");
  });
}

type DemotionReason =
  | "mismatch"
  | "undo"
  | "scope_violation"
  | "decoy"
  | "second_scope_violation"
  | "unclean_run";

// Trust is lost faster than it is gained: any unverified change or hostile call
// returns the type to a learner with no caps. A row with nothing to lose is left alone.
export function demoteTrust(
  writer: TrustWriter,
  userId: string,
  errandType: string,
  reason: DemotionReason,
): void {
  const row = writer
    .select()
    .from(trust)
    .where(and(eq(trust.userId, userId), eq(trust.errandType, errandType)))
    .all()[0];
  if (row === undefined || (row.tier === "learner" && row.cleanRuns === 0)) return;

  const event = appendJournalEventIn(writer, {
    userId,
    eventType: "trust.demoted",
    payload: {
      errand_type: errandType,
      reason,
      from_tier: row.tier,
      from_clean_runs: row.cleanRuns,
    },
  });
  writer
    .update(trust)
    .set({ tier: "learner", cleanRuns: 0, caps: "{}", updatedAt: event.createdAt })
    .where(and(eq(trust.userId, userId), eq(trust.errandType, errandType)))
    .run();
}

export function listTrustViews(db: Db, userId: string, now = new Date()): TrustView[] {
  settleRuns(db, userId, now);
  const tools = new Map<string, string[]>();
  for (const slip of listSlips(db, userId)) {
    if (!tools.has(slip.errandType)) {
      tools.set(slip.errandType, parseSlipTools(slip.tools).map((tool) => tool.name));
    }
  }
  return listTrust(db, userId)
    .map((row) => trustView(row, tools.get(row.errandType) ?? []))
    .sort((left, right) => left.errandType.localeCompare(right.errandType));
}

export type TrustErrorCode = "unknown_errand_type" | "license_not_offered";
export class TrustError extends Error {
  constructor(
    readonly code: TrustErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TrustError";
  }
}

// Accepting or re-capping a license is always the human's act; the caps can
// never exceed the server maxima the agent is held to.
export function acceptLicense(
  db: Db,
  userId: string,
  errandType: string,
  caps: TrustCaps,
  now = new Date(),
): TrustView {
  const row = getTrust(db, userId, errandType);
  if (row === undefined) {
    throw new TrustError("unknown_errand_type", `No errand type ${errandType} has run yet`);
  }
  if (row.tier === "learner" && row.cleanRuns < CLEAN_RUNS_FOR_LICENSE) {
    throw new TrustError(
      "license_not_offered",
      `A license needs ${CLEAN_RUNS_FOR_LICENSE} clean runs; ${errandType} has ${row.cleanRuns}`,
    );
  }
  const at = now.toISOString();
  db.transaction((tx) => {
    tx.update(trust)
      .set({ tier: "license", caps: JSON.stringify(caps), updatedAt: at })
      .where(and(eq(trust.userId, userId), eq(trust.errandType, errandType)))
      .run();
    appendJournalEventIn(tx, {
      userId,
      eventType: "trust.license_accepted",
      payload: { errand_type: errandType, caps, clean_runs: row.cleanRuns },
    });
  });

  const updated = getTrust(db, userId, errandType);
  if (updated === undefined) throw new Error(`Trust for ${errandType} vanished while accepting a license`);
  return trustView(updated, toolsForType(db, userId, errandType));
}
