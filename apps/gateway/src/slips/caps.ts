import type { SlipRow } from "./row.ts";

export type SlipAllowance = {
  callsRemaining: number;
  spendRemainingCents: number;
  timeLeftSeconds: number;
};

type AllowanceSlip = Pick<
  SlipRow,
  "callCap" | "callsUsed" | "spendCapCents" | "spendUsedCents" | "expiresAt"
>;

export function remainingAllowance(slip: AllowanceSlip, now: Date): SlipAllowance {
  return {
    callsRemaining: Math.max(0, slip.callCap - slip.callsUsed),
    spendRemainingCents: Math.max(0, slip.spendCapCents - slip.spendUsedCents),
    timeLeftSeconds: Math.max(0, Math.floor((Date.parse(slip.expiresAt) - now.getTime()) / 1000)),
  };
}
