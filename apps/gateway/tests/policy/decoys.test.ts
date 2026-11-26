import { describe, expect, test } from "bun:test";
import { DECOY_NAMES, isDecoyToolName } from "@errand/shared";

describe("decoys", () => {
  test("every bait name is recognised bare and under a connector prefix", () => {
    for (const name of DECOY_NAMES) {
      expect(isDecoyToolName(name)).toBe(true);
      expect(isDecoyToolName(`notion__${name}`)).toBe(true);
    }
  });

  test("ordinary tools are not decoys", () => {
    expect(isDecoyToolName("calendar__list_events")).toBe(false);
    expect(isDecoyToolName("export_contacts")).toBe(false);
  });
});
