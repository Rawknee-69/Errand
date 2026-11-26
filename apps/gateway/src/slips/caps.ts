import { AGENT_LIMITS, type LimitClamp, type TrustCaps } from "@errand/shared";
import type { SlipRow } from "./row.ts";

export type RequestedLimits = {
  calls?: number;
  spendCents?: number;
  minutes?: number;
};

export type SlipCaps = {
  callCap: number;
  spendCapCents: number;
  minutes: number;
};

export type ResolvedLimits = SlipCaps & { clamped: LimitClamp[] };

export type SlipAllowance = {
  callsRemaining: number;
  spendRemainingCents: number;
  timeLeftSeconds: number;
};

type AllowanceSlip = Pick<
  SlipRow,
  "callCap" | "callsUsed" | "spendCapCents" | "spendUsedCents" | "expiresAt"
>;

type RateSlip = Pick<SlipRow, "rateCap" | "rateWindowCalls">;

// The server maxima are the only ceiling: what the agent asks above them is
// clamped and reported, never refused.
export function clampToCeiling(requested: RequestedLimits): ResolvedLimits {
  const calls = requested.calls ?? AGENT_LIMITS.calls;
  const spendCents = requested.spendCents ?? AGENT_LIMITS.spendCents;
  const minutes = requested.minutes ?? AGENT_LIMITS.minutes;
  const clamped: LimitClamp[] = [];

  const callCap = Math.min(calls, AGENT_LIMITS.calls);
  if (callCap !== calls) {
    clamped.push({ field: "calls", requested: calls, applied: callCap, reason: "server_maximum" });
  }

  const spendCapCents = Math.min(spendCents, AGENT_LIMITS.spendCents);
  if (spendCapCents !== spendCents) {
    clamped.push({
      field: "spend_cents",
      requested: spendCents,
      applied: spendCapCents,
      reason: "server_maximum",
    });
  }

  const cappedMinutes = Math.min(minutes, AGENT_LIMITS.minutes);
  if (cappedMinutes !== minutes) {
    clamped.push({
      field: "minutes",
      requested: minutes,
      applied: cappedMinutes,
      reason: "server_maximum",
    });
  }

  return { callCap, spendCapCents, minutes: cappedMinutes, clamped };
}

// A license may only narrow what the agent asked for, never widen it.
export function tighten(asked: SlipCaps, license: TrustCaps): SlipCaps {
  return {
    callCap: Math.min(asked.callCap, license.callCap),
    spendCapCents: Math.min(asked.spendCapCents, license.spendCapCents),
    minutes: Math.min(asked.minutes, license.minutes),
  };
}

export function remainingAllowance(slip: AllowanceSlip, now: Date): SlipAllowance {
  return {
    callsRemaining: Math.max(0, slip.callCap - slip.callsUsed),
    spendRemainingCents: Math.max(0, slip.spendCapCents - slip.spendUsedCents),
    timeLeftSeconds: Math.max(0, Math.floor((Date.parse(slip.expiresAt) - now.getTime()) / 1000)),
  };
}

export function rateCallsRemaining(slip: RateSlip): number {
  return Math.max(0, slip.rateCap - slip.rateWindowCalls);
}
