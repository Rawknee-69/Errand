import { describe, expect, test } from "bun:test";
import { AGENT_LIMITS, type TrustCaps } from "@errand/shared";
import {
  clampToCeiling,
  rateCallsRemaining,
  remainingAllowance,
  tighten,
} from "../../src/slips/caps.ts";

describe("cap ceiling", () => {
  test("omitted limits resolve to the server maxima", () => {
    expect(clampToCeiling({})).toEqual({
      callCap: AGENT_LIMITS.calls,
      spendCapCents: AGENT_LIMITS.spendCents,
      minutes: AGENT_LIMITS.minutes,
      clamped: [],
    });
  });

  test("a request above a server maximum is clamped and reported", () => {
    const limits = clampToCeiling({ calls: 5_000, spendCents: 9_999_999, minutes: 1_440 });

    expect(limits.callCap).toBe(AGENT_LIMITS.calls);
    expect(limits.spendCapCents).toBe(AGENT_LIMITS.spendCents);
    expect(limits.minutes).toBe(AGENT_LIMITS.minutes);
    expect(limits.clamped).toEqual([
      { field: "calls", requested: 5_000, applied: AGENT_LIMITS.calls, reason: "server_maximum" },
      {
        field: "spend_cents",
        requested: 9_999_999,
        applied: AGENT_LIMITS.spendCents,
        reason: "server_maximum",
      },
      { field: "minutes", requested: 1_440, applied: AGENT_LIMITS.minutes, reason: "server_maximum" },
    ]);
  });

  test("a request inside the maxima is kept as asked", () => {
    expect(clampToCeiling({ calls: 3, spendCents: 0, minutes: 5 })).toEqual({
      callCap: 3,
      spendCapCents: 0,
      minutes: 5,
      clamped: [],
    });
  });
});

describe("license tightening", () => {
  const license: TrustCaps = { callCap: 4, spendCapCents: 1_000, minutes: 6 };

  test("a license narrows a wider request field by field", () => {
    expect(tighten({ callCap: 10, spendCapCents: 5_000, minutes: 30 }, license)).toEqual({
      callCap: 4,
      spendCapCents: 1_000,
      minutes: 6,
    });
  });

  test("a license never widens a narrower request", () => {
    expect(tighten({ callCap: 2, spendCapCents: 500, minutes: 3 }, license)).toEqual({
      callCap: 2,
      spendCapCents: 500,
      minutes: 3,
    });
  });
});

describe("remaining allowance", () => {
  const slip = {
    callCap: 10,
    callsUsed: 4,
    spendCapCents: 5_000,
    spendUsedCents: 1_200,
    rateCap: 20,
    rateWindowCalls: 18,
    expiresAt: "2026-01-01T00:10:00.000Z",
  };
  const now = new Date("2026-01-01T00:00:00.000Z");

  test("reports what is left of every cap", () => {
    expect(remainingAllowance(slip, now)).toEqual({
      callsRemaining: 6,
      spendRemainingCents: 3_800,
      timeLeftSeconds: 600,
    });
    expect(rateCallsRemaining(slip)).toBe(2);
  });

  test("an exhausted or expired cap floors at zero", () => {
    expect(
      remainingAllowance(
        {
          ...slip,
          callsUsed: 12,
          spendUsedCents: 9_000,
          expiresAt: "2025-12-31T23:59:00.000Z",
        },
        now,
      ),
    ).toEqual({
      callsRemaining: 0,
      spendRemainingCents: 0,
      timeLeftSeconds: 0,
    });
    expect(rateCallsRemaining({ ...slip, rateWindowCalls: 25 })).toBe(0);
  });
});
