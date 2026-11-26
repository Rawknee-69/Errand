import { describe, expect, test } from "bun:test";
import { AGENT_LIMITS } from "@errand/shared";
import { resolveLimits } from "../../src/agent/limits.ts";

describe("requested limits", () => {
  test("omitted limits resolve to the server maxima", () => {
    expect(resolveLimits({})).toEqual({
      callCap: AGENT_LIMITS.calls,
      spendCapCents: AGENT_LIMITS.spendCents,
      minutes: AGENT_LIMITS.minutes,
      clamped: [],
    });
  });

  test("a request above a server maximum is clamped and reported", () => {
    const limits = resolveLimits({ calls: 5_000, spendCents: 9_999_999, minutes: 1_440 });

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
    expect(resolveLimits({ calls: 3, spendCents: 0, minutes: 5 })).toEqual({
      callCap: 3,
      spendCapCents: 0,
      minutes: 5,
      clamped: [],
    });
  });
});
