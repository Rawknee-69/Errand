import type { CapTrim, SlipApprovalInput, SlipDetail } from "@errand/shared";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { appendJournalEvent } from "../db/journal.ts";
import { slips } from "../db/schema.ts";
import { getSlip } from "../db/scoped-reads.ts";
import { issueCapability, hashCapability } from "../policy/capability.ts";
import { signSlip } from "../policy/slip-signing.ts";
import { effectiveSlipState } from "./state.ts";
import { slipDetail } from "./view.ts";

export type SlipErrorCode =
  | "not_found"
  | "not_pending"
  | "expired"
  | "cap_above_request"
  | "signing_unavailable";

export class SlipError extends Error {
  constructor(
    readonly code: SlipErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SlipError";
  }
}

export type SlipDecisionOptions = {
  now?: Date;
  hmacKey?: string | undefined;
};

export type ApproveSlipResult = {
  detail: SlipDetail;
  trims: CapTrim[];
};

function pendingRow(db: Db, userId: string, id: string, now: Date) {
  const row = getSlip(db, userId, id);
  if (row === undefined) throw new SlipError("not_found", `No slip ${id} for this user`);
  if (row.state !== "pending") {
    throw new SlipError("not_pending", `Slip ${id} is ${row.state}, not pending`);
  }
  if (effectiveSlipState(row, now) === "expired") {
    throw new SlipError("expired", `Slip ${id} expired before a decision`);
  }
  return row;
}

function trim(
  field: CapTrim["field"],
  requested: number,
  applied: number,
): CapTrim | undefined {
  return requested < applied
    ? { field, requested, applied, reason: "human_trim" }
    : undefined;
}

export function approveSlip(
  db: Db,
  userId: string,
  id: string,
  input: SlipApprovalInput,
  options: SlipDecisionOptions = {},
): ApproveSlipResult {
  const now = options.now ?? new Date();
  const master = options.hmacKey;
  if (master === undefined) {
    throw new SlipError("signing_unavailable", "Slip signing is not configured on this gateway");
  }
  const row = pendingRow(db, userId, id, now);

  const callCap = input.callCap ?? row.callCap;
  const spendCapCents = input.spendCapCents ?? row.spendCapCents;
  if (callCap > row.callCap) {
    throw new SlipError("cap_above_request", `The call cap cannot rise from ${row.callCap} to ${callCap}`);
  }
  if (spendCapCents > row.spendCapCents) {
    throw new SlipError(
      "cap_above_request",
      `The spend cap cannot rise from ${row.spendCapCents} to ${spendCapCents}`,
    );
  }

  const trims = [
    trim("call_cap", callCap, row.callCap),
    trim("spend_cap_cents", spendCapCents, row.spendCapCents),
  ].filter((entry): entry is CapTrim => entry !== undefined);

  const approvedAt = now.toISOString();
  db.update(slips)
    .set({
      state: "approved",
      callCap,
      spendCapCents,
      approvedAt,
      updatedAt: approvedAt,
    })
    .where(and(eq(slips.userId, userId), eq(slips.id, id)))
    .run();

  const approved = getSlip(db, userId, id);
  if (approved === undefined) throw new Error(`Slip ${id} vanished while approving`);

  const signature = signSlip(approved, master);
  const capability = issueCapability(approved, master);
  db.update(slips)
    .set({ signature, capabilityHash: hashCapability(capability) })
    .where(and(eq(slips.userId, userId), eq(slips.id, id)))
    .run();

  const final = getSlip(db, userId, id);
  if (final === undefined) throw new Error(`Slip ${id} vanished while signing`);

  appendJournalEvent(db, {
    userId,
    eventType: "slip.approved",
    payload: {
      slip_id: id,
      errand_type: final.errandType,
      tier: final.tier,
      call_cap: final.callCap,
      spend_cap_cents: final.spendCapCents,
      expires_at: final.expiresAt,
      trims,
    },
  });

  return { detail: slipDetail(db, userId, final, now), trims };
}

export function denySlip(
  db: Db,
  userId: string,
  id: string,
  reason: string | undefined,
  options: SlipDecisionOptions = {},
): SlipDetail {
  const now = options.now ?? new Date();
  pendingRow(db, userId, id, now);
  const decidedAt = now.toISOString();
  db.update(slips)
    .set({ state: "denied", updatedAt: decidedAt })
    .where(and(eq(slips.userId, userId), eq(slips.id, id)))
    .run();

  const final = getSlip(db, userId, id);
  if (final === undefined) throw new Error(`Slip ${id} vanished while denying`);

  appendJournalEvent(db, {
    userId,
    eventType: "slip.denied",
    payload: {
      slip_id: id,
      errand_type: final.errandType,
      reason: reason ?? "",
    },
  });

  return slipDetail(db, userId, final, now);
}
