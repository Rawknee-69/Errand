import { describe, expect, test } from "bun:test";
import { evaluateRun, type RunSlip } from "../../src/policy/trust.ts";

const READ_TOOL = { name: "calendar__list_events", connectorId: "conn-a", class: "read" as const };
const WRITE_TOOL = { name: "calendar__create_event", connectorId: "conn-a", class: "write" as const };

function slip(overrides: Partial<RunSlip> = {}): RunSlip {
  return {
    state: "approved",
    tools: JSON.stringify([READ_TOOL]),
    scopeViolations: 0,
    callsUsed: 1,
    callCap: 1,
    expiresAt: "2026-01-01T00:30:00.000Z",
    settledAt: null,
    ...overrides,
  };
}

describe("run verdict", () => {
  test("a read run with a recorded success is clean", () => {
    expect(
      evaluateRun(
        slip(),
        [{ id: "call-1", tool: READ_TOOL.name, error: null, result: "{}" }],
        [],
      ),
    ).toBe("clean");
  });

  test("a change without a matched receipt does not count as verified", () => {
    const run = slip({ tools: JSON.stringify([WRITE_TOOL]) });
    const call = [{ id: "call-1", tool: WRITE_TOOL.name, error: null, result: "{}" }];

    expect(evaluateRun(run, call, [])).toEqual({ unclean: "receipt_missing" });
    expect(evaluateRun(run, call, [{ callId: "call-1", verification: "unverified" }])).toEqual({
      unclean: "receipt_unverified",
    });
    expect(evaluateRun(run, call, [{ callId: "call-1", verification: "mismatched" }])).toEqual({
      unclean: "receipt_mismatched",
    });
    expect(evaluateRun(run, call, [{ callId: "call-1", verification: "matched" }])).toBe("clean");
  });

  test("an admitted call with no row is pending, an all-failed run is unclean, and no calls is empty", () => {
    const readCall = [{ id: "call-1", tool: READ_TOOL.name, error: null, result: "{}" }];

    expect(evaluateRun(slip({ callsUsed: 2, callCap: 2 }), readCall, [])).toBe("pending");
    expect(
      evaluateRun(slip(), [{ id: "call-1", tool: READ_TOOL.name, error: "timeout", result: null }], []),
    ).toEqual({ unclean: "call_failed" });
    expect(evaluateRun(slip({ callsUsed: 0 }), [], [])).toBe("empty");
  });
});
