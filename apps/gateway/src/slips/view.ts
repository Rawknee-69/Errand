import type { SlipDetail, SlipSummary } from "@errand/shared";
import type { Db } from "../db/client.ts";
import type { slips } from "../db/schema.ts";
import { getSlip, listSlips } from "../db/scoped-reads.ts";
import { buildApprovalCard } from "./card.ts";
import { effectiveSlipState } from "./state.ts";

export type SlipRow = typeof slips.$inferSelect;

export function slipSummary(row: SlipRow, now = new Date()): SlipSummary {
  return {
    slipId: row.id,
    state: effectiveSlipState(row, now),
    tier: row.tier,
    goal: row.goal,
    errandType: row.errandType,
    callCap: row.callCap,
    callsUsed: row.callsUsed,
    spendCapCents: row.spendCapCents,
    spendUsedCents: row.spendUsedCents,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    approvedAt: row.approvedAt,
    burnedAt: row.burnedAt,
    burnedReason: row.burnedReason,
  };
}

export function slipDetail(db: Db, userId: string, row: SlipRow, now = new Date()): SlipDetail {
  return { slip: slipSummary(row, now), card: buildApprovalCard(db, userId, row, now) };
}

export function getSlipDetail(db: Db, userId: string, id: string, now = new Date()): SlipDetail | undefined {
  const row = getSlip(db, userId, id);
  return row === undefined ? undefined : slipDetail(db, userId, row, now);
}

export function listSlipSummaries(db: Db, userId: string, now = new Date()): SlipSummary[] {
  return listSlips(db, userId)
    .map((row) => slipSummary(row, now))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
