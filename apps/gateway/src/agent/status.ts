import type { SlipState, SlipTool, Tier } from "@errand/shared";
import type { Db } from "../db/client.ts";
import { getSlip } from "../db/scoped-reads.ts";
import { issueValidCapability } from "../policy/capability.ts";
import { remainingAllowance } from "../slips/caps.ts";
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
  burnedAt: string | null;
  burnedReason: string | null;
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
    state === "approved" && options.hmacKey !== undefined
      ? issueValidCapability(slip, options.hmacKey, now)
      : null;

  const allowance = remainingAllowance(slip, now);
  return {
    slipId: slip.id,
    state,
    tier: slip.tier,
    goal: slip.goal,
    tools: parseSlipTools(slip.tools),
    callCap: slip.callCap,
    callsUsed: slip.callsUsed,
    callsRemaining: allowance.callsRemaining,
    spendCapCents: slip.spendCapCents,
    spendUsedCents: slip.spendUsedCents,
    spendRemainingCents: allowance.spendRemainingCents,
    expiresAt: slip.expiresAt,
    timeLeftSeconds: allowance.timeLeftSeconds,
    createdAt: slip.createdAt,
    burnedAt: slip.burnedAt,
    burnedReason: slip.burnedReason,
    capability,
  };
}
