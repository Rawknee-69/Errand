import { describe, expect, test } from "bun:test";
import { formatTimestamp } from "../src/format.ts";

describe("formatTimestamp", () => {
  test("says never for an unset time instead of inventing one", () => {
    expect(formatTimestamp(null)).toBe("never");
  });

  test("formats a real timestamp and refuses to render an invalid one", () => {
    expect(formatTimestamp("2026-01-02T03:04:00.000Z")).not.toBe("never");
    expect(formatTimestamp("not-a-date")).toBe("unknown time");
  });
});
