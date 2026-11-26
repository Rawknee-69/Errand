import { describe, expect, test } from "bun:test";
import {
  capsSummary,
  cleanRunView,
  parseTrustCapsEdit,
  tierView,
  trustCapInputs,
  trustTitle,
} from "../src/trust.ts";

describe("tier and clean-run copy", () => {
  test("names what each tier means for the human", () => {
    expect(tierView("learner")).toEqual({
      label: "Learner",
      tone: "accent",
      detail: "Every slip needs your tap before it runs.",
    });
    expect(tierView("license")).toEqual({
      label: "License",
      tone: "ok",
      detail: "Runs without a tap inside the caps you set.",
    });
  });

  test("names a row by the tools that define its kind, falling back to the hash", () => {
    expect(
      trustTitle({ tools: ["calendar__list_events", "calendar__create_event"], errandType: "abc" }),
    ).toBe("calendar__list_events, calendar__create_event");
    expect(trustTitle({ tools: [], errandType: "0123456789abcdef" })).toBe("01234567…cdef");
  });

  test("counts the clean runs still needed for a license", () => {
    expect(cleanRunView(0)).toEqual({ remaining: 5, label: "0 of 5 clean runs" });
    expect(cleanRunView(3)).toEqual({ remaining: 2, label: "3 of 5 clean runs" });
    expect(cleanRunView(5)).toEqual({ remaining: 0, label: "5 of 5 clean runs" });
    expect(cleanRunView(9)).toEqual({ remaining: 0, label: "9 of 5 clean runs" });
  });
});

describe("license caps", () => {
  test("describes the caps in plain money and units", () => {
    expect(capsSummary({ callCap: 2, spendCapCents: 0, minutes: 5 })).toBe(
      "2 calls · $0.00 · 5 min",
    );
    expect(capsSummary(null)).toBe("No caps set");
  });

  test("seeds a form with the current caps, or a conservative default", () => {
    expect(trustCapInputs({ callCap: 2, spendCapCents: 1_500, minutes: 5 })).toEqual({
      calls: "2",
      spendDollars: "15.00",
      minutes: "5",
    });
    expect(trustCapInputs(null)).toEqual({ calls: "5", spendDollars: "10.00", minutes: "10" });
  });

  test("accepts caps inside the server maxima", () => {
    expect(parseTrustCapsEdit({ calls: "2", spendDollars: "5", minutes: "5" })).toEqual({
      ok: true,
      caps: { callCap: 2, spendCapCents: 500, minutes: 5 },
    });
    expect(parseTrustCapsEdit({ calls: "50", spendDollars: "200", minutes: "30" })).toEqual({
      ok: true,
      caps: { callCap: 50, spendCapCents: 20_000, minutes: 30 },
    });
  });

  test("refuses caps above the maxima or below the floor", () => {
    expect(parseTrustCapsEdit({ calls: "51", spendDollars: "5", minutes: "5" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("50"),
    });
    expect(parseTrustCapsEdit({ calls: "2", spendDollars: "200.01", minutes: "5" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("$200.00"),
    });
    expect(parseTrustCapsEdit({ calls: "2", spendDollars: "5", minutes: "31" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("30"),
    });
    expect(parseTrustCapsEdit({ calls: "0", spendDollars: "5", minutes: "5" })).toMatchObject({
      ok: false,
    });
    expect(parseTrustCapsEdit({ calls: "2", spendDollars: "-1", minutes: "5" })).toMatchObject({
      ok: false,
    });
    expect(
      parseTrustCapsEdit({ calls: "2", spendDollars: "5", minutes: "1.5" }),
    ).toMatchObject({ ok: false });
  });
});
