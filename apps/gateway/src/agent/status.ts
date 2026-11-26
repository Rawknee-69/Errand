import type { Db } from "../db/client.ts";
import { getSlip } from "../db/scoped-reads.ts";
import type { SlipState, Tier } from "../db/schema.ts";
import { parseSlipTools, type SlipTool } from "./slip-tools.ts";

export type ErrandStatusResult = {
  slipId: string;
  state: SlipState;
  tier: Tier;
  goal: string;
  tools: SlipTool[];
  callCap: number;
  callsUsed: number;
  spendCapCents: number;
  spendUsedCents: number;
  expiresAt: string;
  createdAt: string;
};

export function errandStatus(
  db: Db,
  userId: string,
  slipId: string,
  now = new Date(),
): ErrandStatusResult | undefined {
  const slip = getSlip(db, userId, slipId);
  if (slip === undefined) return undefined;
  const expired = Date.parse(slip.expiresAt) <= now.getTime();
  const state: SlipState =
    expired && (slip.state === "pending" || slip.state === "approved") ? "expired" : slip.state;
  return {
    slipId: slip.id,
    state,
    tier: slip.tier,
    goal: slip.goal,
    tools: parseSlipTools(slip.tools),
    callCap: slip.callCap,
    callsUsed: slip.callsUsed,
    spendCapCents: slip.spendCapCents,
    spendUsedCents: slip.spendUsedCents,
    expiresAt: slip.expiresAt,
    createdAt: slip.createdAt,
  };
}
