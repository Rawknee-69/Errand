import { describe, expect, test } from "bun:test";
import { hashCapability, issueCapability, verifyCapability } from "../../src/policy/capability.ts";
import type { SlipRecord } from "../../src/policy/slip-signing.ts";
import { SLIP_KEY } from "../support/fixtures.ts";

const NOW = new Date("2026-04-01T12:00:00.000Z");
const EXPIRES = "2026-04-01T12:30:00.000Z";

function slip(overrides: Partial<SlipRecord> = {}): SlipRecord {
  return {
    id: "slip-1",
    userId: "user-a",
    errandType: "type-1",
    goal: "goal",
    state: "approved",
    tier: "learner",
    tools: "[]",
    constraints: "{}",
    callCap: 5,
    spendCapCents: 100,
    expiresAt: EXPIRES,
    approvedAt: NOW.toISOString(),
    signature: "00",
    capabilityHash: null,
    ...overrides,
  };
}

function issued(overrides: Partial<SlipRecord> = {}): { row: SlipRecord; token: string } {
  const token = issueCapability(slip(overrides), SLIP_KEY);
  return { row: slip({ ...overrides, capabilityHash: hashCapability(token) }), token };
}

describe("capability", () => {
  test("is deterministic and verifies before expiry", () => {
    const { row, token } = issued();
    expect(issueCapability(row, SLIP_KEY)).toBe(token);
    expect(verifyCapability(row, token, SLIP_KEY, NOW)).toBe(true);
  });

  test("stops exactly when the slip expires", () => {
    const { row, token } = issued();
    expect(verifyCapability(row, token, SLIP_KEY, new Date("2026-04-01T12:29:59.999Z"))).toBe(true);
    expect(verifyCapability(row, token, SLIP_KEY, new Date(EXPIRES))).toBe(false);
  });

  test("is audience-bound: another slip cannot use it", () => {
    const { row, token } = issued();
    expect(verifyCapability({ ...row, id: "slip-2" }, token, SLIP_KEY, NOW)).toBe(false);
  });

  test("another user's slip cannot use it", () => {
    const { row, token } = issued();
    expect(verifyCapability({ ...row, userId: "user-b" }, token, SLIP_KEY, NOW)).toBe(false);
  });

  test("a different key does not verify", () => {
    const { row, token } = issued();
    expect(verifyCapability(row, token, "another-key-material-long-enough-for-hmac", NOW)).toBe(false);
  });

  test("a revoked or replaced capability hash does not verify", () => {
    const { row, token } = issued();
    expect(verifyCapability({ ...row, capabilityHash: null }, token, SLIP_KEY, NOW)).toBe(false);
    expect(verifyCapability({ ...row, capabilityHash: hashCapability("cap_other") }, token, SLIP_KEY, NOW)).toBe(false);
  });

  test("a non-approved slip has no valid capability", () => {
    const { row, token } = issued();
    expect(verifyCapability({ ...row, state: "denied" }, token, SLIP_KEY, NOW)).toBe(false);
  });
});
