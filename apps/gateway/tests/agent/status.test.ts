import { describe, expect, test } from "bun:test";
import { errandStatus } from "../../src/agent/status.ts";
import { slips } from "../../src/db/schema.ts";
import { TS, userDb } from "./support.ts";

function seedSlip(db: ReturnType<typeof userDb>, state: "pending" | "approved", expiresAt: string): void {
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

  test("a pending slip inside its lifetime stays pending", () => {
    const db = userDb();
    seedSlip(db, "pending", "2026-04-01T12:30:00.000Z");
    expect(errandStatus(db, "user-a", "slip", now)?.state).toBe("pending");
  });

  test("a pending or approved slip past expiry reads expired", () => {
    const pending = userDb();
    seedSlip(pending, "pending", "2026-04-01T11:59:00.000Z");
    expect(errandStatus(pending, "user-a", "slip", now)?.state).toBe("expired");

    const approved = userDb();
    seedSlip(approved, "approved", "2026-04-01T11:59:00.000Z");
    expect(errandStatus(approved, "user-a", "slip", now)?.state).toBe("expired");
  });

  test("another user's slip is not found", () => {
    const db = userDb(["user-a", "user-b"]);
    seedSlip(db, "pending", "2026-04-01T12:30:00.000Z");
    expect(errandStatus(db, "user-b", "slip", now)).toBeUndefined();
  });
});
