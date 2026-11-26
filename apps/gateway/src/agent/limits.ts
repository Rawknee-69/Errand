import { DEFAULT_CALL_RATE_PER_MINUTE } from "../policy/rate.ts";

// Hard ceilings a request can never exceed; the agent may ask for less and a
// human may trim further before approving.
export const AGENT_LIMITS = {
  tools: 20,
  calls: 50,
  callsPerMinute: DEFAULT_CALL_RATE_PER_MINUTE,
  spendCents: 20_000,
  minutes: 30,
} as const;

export type RequestedLimits = {
  calls?: number;
  spendCents?: number;
  minutes?: number;
};

export type ClampedLimit = {
  field: "calls" | "spend_cents" | "minutes";
  requested: number;
  applied: number;
  reason: "server_maximum";
};

export type ResolvedLimits = {
  callCap: number;
  spendCapCents: number;
  minutes: number;
  clamped: ClampedLimit[];
};

export function resolveLimits(requested: RequestedLimits): ResolvedLimits {
  const calls = requested.calls ?? AGENT_LIMITS.calls;
  const spendCents = requested.spendCents ?? AGENT_LIMITS.spendCents;
  const minutes = requested.minutes ?? AGENT_LIMITS.minutes;
  const clamped: ClampedLimit[] = [];

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
