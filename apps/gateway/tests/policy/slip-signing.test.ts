import { describe, expect, test } from "bun:test";
import { signSlip, verifySlipSignature, type SlipRecord } from "../../src/policy/slip-signing.ts";
import { SLIP_KEY } from "../support/fixtures.ts";

const APPROVED_AT = "2026-04-01T12:00:00.000Z";

function slip(overrides: Partial<SlipRecord> = {}): SlipRecord {
  return {
    id: "slip-1",
    userId: "user-a",
    errandType: "type-1",
    goal: "Book a dinner",
    state: "approved",
    tier: "learner",
    tools: JSON.stringify([{ name: "calendar__list_events", connectorId: "conn-a", class: "read" }]),
    constraints: JSON.stringify({ time_window: "evening" }),
    callCap: 5,
    rateCap: 20,
    spendCapCents: 5000,
    expiresAt: "2026-04-01T12:30:00.000Z",
    approvedAt: APPROVED_AT,
    signature: null,
    capabilityHash: null,
    ...overrides,
  };
}

describe("slip signing", () => {
  test("a signed slip verifies with the same key", () => {
    const row = slip();
    const signed = { ...row, signature: signSlip(row, SLIP_KEY) };
    expect(verifySlipSignature(signed, SLIP_KEY)).toBe(true);
  });

  test("a different key does not verify", () => {
    const row = slip();
    const signed = { ...row, signature: signSlip(row, SLIP_KEY) };
    expect(verifySlipSignature(signed, "another-key-material-long-enough-for-hmac")).toBe(false);
  });

  const alterations: { name: string; change: Partial<SlipRecord> }[] = [
    { name: "goal", change: { goal: "Transfer everything" } },
    { name: "call cap", change: { callCap: 50 } },
    { name: "rate cap", change: { rateCap: 500 } },
    { name: "spend cap", change: { spendCapCents: 500_000 } },
    { name: "expiry", change: { expiresAt: "2026-04-02T12:30:00.000Z" } },
    {
      name: "tools",
      change: {
        tools: JSON.stringify([
          { name: "calendar__list_events", connectorId: "conn-a", class: "read" },
          { name: "calendar__delete_event", connectorId: "conn-a", class: "delete" },
        ]),
      },
    },
    { name: "constraints", change: { constraints: JSON.stringify({ time_window: "any" }) } },
    { name: "tier", change: { tier: "license" } },
    { name: "approval time", change: { approvedAt: "2026-04-01T11:59:59.000Z" } },
  ];

  test.each(alterations)("a byte-altered $name fails verification", ({ change }) => {
    const row = slip();
    const signed = { ...row, signature: signSlip(row, SLIP_KEY) };
    expect(verifySlipSignature({ ...signed, ...change }, SLIP_KEY)).toBe(false);
  });

  test("a slip with no signature does not verify", () => {
    expect(verifySlipSignature(slip(), SLIP_KEY)).toBe(false);
  });

  test("a legitimate state change after approval keeps the signature valid", () => {
    const row = slip();
    const signed = { ...row, signature: signSlip(row, SLIP_KEY) };
    expect(verifySlipSignature({ ...signed, state: "burned" }, SLIP_KEY)).toBe(true);
  });
});
