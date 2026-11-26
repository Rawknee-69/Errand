import { describe, expect, test } from "bun:test";
import { errandStatus } from "../../src/agent/status.ts";
import { slips } from "../../src/db/schema.ts";
import { approveSlip, denySlip } from "../../src/slips/approval.ts";
import { SLIP_KEY, TS, userDb } from "../support/fixtures.ts";

function seedSlip(
  db: ReturnType<typeof userDb>,
  state: "pending" | "approved" | "denied" | "burned",
  expiresAt: string,
): void {
  db.insert(slips)
    .values({
      id: "slip",
      userId: "user-a",
      errandType: "type",
      goal: "goal",
      state,
      tier: "learner",
      tools: JSON.stringify([{ name: "calendar__list_events", connectorId: "conn-a", class: "read" }]),
      callCap: 5,
      spendCapCents: 100,
      expiresAt,
      createdAt: TS,
      updatedAt: TS,
    })
    .run();
}

describe("errand status", () => {
  const now = new Date("2026-04-01T12:00:00.000Z");

  test("a pending slip inside its lifetime stays pending and carries no capability", () => {
    const db = userDb();
    seedSlip(db, "pending", "2026-04-01T12:30:00.000Z");
    const status = errandStatus(db, "user-a", "slip", { now, hmacKey: SLIP_KEY });
    expect(status).toMatchObject({
      state: "pending",
      callsRemaining: 5,
      spendRemainingCents: 100,
      capability: null,
    });
  });

  test("a pending or approved slip past expiry reads expired without a capability", () => {
    const pending = userDb();
    seedSlip(pending, "pending", "2026-04-01T11:59:00.000Z");
    expect(errandStatus(pending, "user-a", "slip", { now, hmacKey: SLIP_KEY })).toMatchObject({
      state: "expired",
      capability: null,
    });

    const approved = userDb();
    seedSlip(approved, "approved", "2026-04-01T11:59:00.000Z");
    expect(errandStatus(approved, "user-a", "slip", { now, hmacKey: SLIP_KEY })).toMatchObject({
      state: "expired",
      capability: null,
    });
  });

  test("an approved slip returns its capability and remaining caps", () => {
    const db = userDb();
    seedSlip(db, "pending", "2026-04-01T12:30:00.000Z");
    approveSlip(db, "user-a", "slip", {}, { now, hmacKey: SLIP_KEY });

    const status = errandStatus(db, "user-a", "slip", { now, hmacKey: SLIP_KEY });
    expect(status).toMatchObject({
      state: "approved",
      callCap: 5,
      callsUsed: 0,
      callsRemaining: 5,
      spendCapCents: 100,
      spendRemainingCents: 100,
    });
    expect(status?.capability).toMatch(/^cap_/);
  });

  test("the capability stops exactly when the slip expires", () => {
    const db = userDb();
    seedSlip(db, "pending", "2026-04-01T12:30:00.000Z");
    approveSlip(db, "user-a", "slip", {}, { now, hmacKey: SLIP_KEY });

    const lastMillisecond = new Date("2026-04-01T12:29:59.999Z");
    expect(errandStatus(db, "user-a", "slip", { now: lastMillisecond, hmacKey: SLIP_KEY })).toMatchObject({
      state: "approved",
      timeLeftSeconds: 0,
    });
    expect(
      errandStatus(db, "user-a", "slip", { now: lastMillisecond, hmacKey: SLIP_KEY })?.capability,
    ).toMatch(/^cap_/);

    const atExpiry = new Date("2026-04-01T12:30:00.000Z");
    expect(errandStatus(db, "user-a", "slip", { now: atExpiry, hmacKey: SLIP_KEY })).toMatchObject({
      state: "expired",
      capability: null,
    });
  });

  test("denied and burned slips never carry a capability", () => {
    const denied = userDb();
    seedSlip(denied, "pending", "2026-04-01T12:30:00.000Z");
    denySlip(denied, "user-a", "slip", "Not today", { now });
    expect(errandStatus(denied, "user-a", "slip", { now, hmacKey: SLIP_KEY })).toMatchObject({
      state: "denied",
      capability: null,
    });

    const burned = userDb();
    seedSlip(burned, "burned", "2026-04-01T12:30:00.000Z");
    expect(errandStatus(burned, "user-a", "slip", { now, hmacKey: SLIP_KEY })).toMatchObject({
      state: "burned",
      capability: null,
    });
  });

  test("another user's slip is not found", () => {
    const db = userDb(["user-a", "user-b"]);
    seedSlip(db, "pending", "2026-04-01T12:30:00.000Z");
    expect(errandStatus(db, "user-b", "slip", { now })).toBeUndefined();
  });
});
