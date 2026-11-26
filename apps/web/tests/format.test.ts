import { describe, expect, test } from "bun:test";
import {
  errandTypeLabel,
  formatCalls,
  formatClock,
  formatDollarsInput,
  formatMoney,
  formatTimestamp,
  timeLeftLabel,
} from "../src/format.ts";

describe("formatTimestamp", () => {
  test("says never for an unset time instead of inventing one", () => {
    expect(formatTimestamp(null)).toBe("never");
  });

  test("formats a real timestamp and refuses to render an invalid one", () => {
    expect(formatTimestamp("2026-01-02T03:04:00.000Z")).not.toBe("never");
    expect(formatTimestamp("not-a-date")).toBe("unknown time");
  });
});

describe("money, calls and time", () => {
  test("shows money and calls in everyday words", () => {
    expect(formatMoney(500)).toBe("$5.00");
    expect(formatDollarsInput(1_050)).toBe("10.50");
    expect(formatCalls(1)).toBe("1 call");
    expect(formatCalls(12)).toBe("12 calls");
    expect(timeLeftLabel(30)).toBe("under a minute left");
    expect(timeLeftLabel(121)).toBe("3 min left");
    expect(timeLeftLabel(7_200)).toBe("2 h left");
    expect(timeLeftLabel(0)).toBe("expired");
    expect(formatClock("not-a-date")).toBe("--:--");
  });

  test("shortens a hash for a label but keeps a short one whole", () => {
    expect(errandTypeLabel("0123456789abcdef")).toBe("01234567…cdef");
    expect(errandTypeLabel("short")).toBe("short");
  });
});
