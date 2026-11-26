import { describe, expect, test } from "bun:test";
import { DECOY_NAMES, exposureOf, isExposed } from "@errand/shared";

const tool = {
  name: "list_events",
  agentName: "calendar__list_events",
  state: "active" as const,
  requestable: true,
};

describe("catalog exposure", () => {
  test("a requestable, active definition is exposed", () => {
    expect(exposureOf(tool)).toEqual({ exposed: true });
    expect(isExposed(tool)).toBe(true);
  });

  test("a decoy is hidden by either name, before any state reason", () => {
    const decoy = DECOY_NAMES[0];
    expect(exposureOf({ ...tool, name: decoy })).toEqual({ exposed: false, reason: "decoy" });
    expect(exposureOf({ ...tool, agentName: `notion__${decoy}`, state: "changed" })).toEqual({
      exposed: false,
      reason: "decoy",
    });
  });

  test("a changed or removed definition hides where the reason is specific", () => {
    expect(exposureOf({ ...tool, state: "changed" })).toEqual({
      exposed: false,
      reason: "definition_changed",
    });
    expect(exposureOf({ ...tool, state: "removed" })).toEqual({
      exposed: false,
      reason: "definition_removed",
    });
  });

  test("a definition the human has not exposed is not_requestable", () => {
    expect(exposureOf({ ...tool, requestable: false })).toEqual({
      exposed: false,
      reason: "not_requestable",
    });
  });
});
