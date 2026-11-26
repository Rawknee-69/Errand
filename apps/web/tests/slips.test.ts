import { describe, expect, test } from "bun:test";
import { describeTrim, describeTrims, parseCapEdits } from "../src/slips.ts";

describe("slip cap formatting", () => {
  test("names what was removed and why", () => {
    expect(
      describeTrim({ field: "call_cap", requested: 10, applied: 4, reason: "human_trim" }),
    ).toBe("Calls 10 → 4 (tightened by you)");
    expect(
      describeTrims([
        { field: "call_cap", requested: 10, applied: 4, reason: "human_trim" },
        { field: "spend_cap_cents", requested: 5_000, applied: 1_000, reason: "human_trim" },
      ]),
    ).toBe("Calls 10 → 4 (tightened by you); Spend $50.00 → $10.00 (tightened by you)");
  });
});

describe("parseCapEdits", () => {
  const requested = { callCap: 10, spendCapCents: 5_000 };

  test("accepts caps below or equal to the request", () => {
    expect(parseCapEdits({ callCap: "4", spendDollars: "10" }, requested)).toEqual({
      ok: true,
      input: { callCap: 4, spendCapCents: 1_000 },
    });
    expect(parseCapEdits({ callCap: "10", spendDollars: "$50.00" }, requested)).toEqual({
      ok: true,
      input: { callCap: 10, spendCapCents: 5_000 },
    });
  });

  test("accepts a zero spend cap and thousands separators", () => {
    expect(parseCapEdits({ callCap: "2", spendDollars: "0" }, requested)).toEqual({
      ok: true,
      input: { callCap: 2, spendCapCents: 0 },
    });
    expect(parseCapEdits({ callCap: "2", spendDollars: "1,2.5" }, requested)).toEqual({
      ok: true,
      input: { callCap: 2, spendCapCents: 1_250 },
    });
  });

  test("refuses a raise, a zero call cap and a non-number", () => {
    expect(parseCapEdits({ callCap: "11", spendDollars: "10" }, requested)).toMatchObject({
      ok: false,
      message: expect.stringContaining("cannot be raised"),
    });
    expect(parseCapEdits({ callCap: "0", spendDollars: "10" }, requested)).toMatchObject({
      ok: false,
    });
    expect(parseCapEdits({ callCap: "2", spendDollars: "lots" }, requested)).toMatchObject({
      ok: false,
      message: expect.stringContaining("dollar amount"),
    });
    expect(parseCapEdits({ callCap: "2", spendDollars: "50.01" }, requested)).toMatchObject({
      ok: false,
      message: expect.stringContaining("cannot be raised"),
    });
  });
});
