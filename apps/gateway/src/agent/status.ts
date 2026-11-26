import type { SlipState, SlipTool, Tier } from "@errand/shared";
import type { Db } from "../db/client.ts";
import { getSlip } from "../db/scoped-reads.ts";
import { issueCapability, verifyCapability } from "../policy/capability.ts";
import { verifySlipSignature } from "../policy/slip-signing.ts";
import { parseSlipTools } from "./slip-tools.ts";
import { effectiveSlipState } from "../slips/state.ts";

export type ErrandStatusOptions = {
  now?: Date;
  hmacKey?: string | undefined;
};

export type ErrandStatusResult = {
  slipId: string;
  state: SlipState;
  tier: Tier;
  goal: string;
  tools: SlipTool[];
  callCap: number;
  callsUsed: number;
  callsRemaining: number;
  spendCapCents: number;
  spendUsedCents: number;
  spendRemainingCents: number;
  expiresAt: string;
  timeLeftSeconds: number;
  createdAt: string;
  capability: string | null;
};

export function errandStatus(
  db: Db,
  userId: string,
  slipId: string,
  options: ErrandStatusOptions = {},
): ErrandStatusResult | undefined {
  const slip = getSlip(db, userId, slipId);
  if (slip === undefined) return undefined;
  const now = options.now ?? new Date();
  const state = effectiveSlipState(slip, now);

  const capability =
    state === "approved" && options.hmacKey !== undefined && verifySlipSignature(slip, options.hmacKey)
      ? (() => {
          const token = issueCapability(slip, options.hmacKey);
          return verifyCapability(slip, token, options.hmacKey, now) ? token : null;
        })()
      : null;

  return {
    slipId: slip.id,
    state,
    tier: slip.tier,
    goal: slip.goal,
    tools: parseSlipTools(slip.tools),
    callCap: slip.callCap,
    callsUsed: slip.callsUsed,
    callsRemaining: Math.max(0, slip.callCap - slip.callsUsed),
    spendCapCents: slip.spendCapCents,
    spendUsedCents: slip.spendUsedCents,
    spendRemainingCents: Math.max(0, slip.spendCapCents - slip.spendUsedCents),
    expiresAt: slip.expiresAt,
    timeLeftSeconds: Math.max(0, Math.floor((Date.parse(slip.expiresAt) - now.getTime()) / 1000)),
    createdAt: slip.createdAt,
    capability,
  };
}
