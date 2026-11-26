import { describe, expect, test } from "bun:test";
import { requestErrand } from "../../src/agent/request.ts";
import { listJournalEvents } from "../../src/db/journal.ts";
import { getSlip } from "../../src/db/scoped-reads.ts";
import { approveSlip, denySlip, SlipError } from "../../src/slips/approval.ts";
import { verifySlipSignature } from "../../src/policy/slip-signing.ts";
import { seedConnector, seedTool, userDb } from "../agent/support.ts";
import { SLIP_KEY } from "../support/fixtures.ts";

const NOW = new Date("2026-04-01T12:00:00.000Z");

function seeded() {
  const db = userDb();
  seedConnector(db, "user-a", "conn-a", "Calendar");
  seedTool(db, "user-a", {
    id: "tool-a",
    connectorId: "conn-a",
    name: "list_events",
    agentName: "calendar__list_events",
  });
  return db;
}

function requested(db: ReturnType<typeof seeded>, calls = 10, spendCents = 5000): string {
  return requestErrand(
    db,
    "user-a",
    { goal: "Book a dinner", tools: ["calendar__list_events"], limits: { calls, spendCents } },
    NOW,
  ).slipId;
}

describe("approving a slip", () => {
  test("signs the final slip and issues a capability", () => {
    const db = seeded();
    const slipId = requested(db);

    const result = approveSlip(db, "user-a", slipId, {}, { now: NOW, hmacKey: SLIP_KEY });
    const row = getSlip(db, "user-a", slipId);
    expect(row).toBeDefined();
    if (row === undefined) return;

    expect(result.detail.slip).toMatchObject({ state: "approved", approvedAt: NOW.toISOString() });
    expect(row.signature).not.toBeNull();
    expect(row.capabilityHash).not.toBeNull();
    expect(verifySlipSignature(row, SLIP_KEY)).toBe(true);
    expect(result.trims).toEqual([]);

    const event = listJournalEvents(db, "user-a").at(-1);
    expect(event).toMatchObject({ eventType: "slip.approved" });
    expect(event?.payload).toContain(slipId);
  });

  test("a human trim lowers caps and reports what changed and why", () => {
    const db = seeded();
    const slipId = requested(db);

    const result = approveSlip(
      db,
      "user-a",
      slipId,
      { callCap: 4, spendCapCents: 1000 },
      { now: NOW, hmacKey: SLIP_KEY },
    );

    expect(result.trims).toEqual([
      { field: "call_cap", requested: 4, applied: 10, reason: "human_trim" },
      { field: "spend_cap_cents", requested: 1000, applied: 5000, reason: "human_trim" },
    ]);
    expect(result.detail.slip).toMatchObject({ callCap: 4, spendCapCents: 1000 });
    expect(result.detail.card).toMatchObject({ callCap: 4, spendCapCents: 1000 });

    const row = getSlip(db, "user-a", slipId);
    expect(row === undefined ? false : verifySlipSignature(row, SLIP_KEY)).toBe(true);
  });

  test("a cap cannot be raised above what the agent requested", () => {
    const db = seeded();
    const slipId = requested(db, 5);
    expect(() =>
      approveSlip(db, "user-a", slipId, { callCap: 6 }, { now: NOW, hmacKey: SLIP_KEY }),
    ).toThrow(expect.objectContaining({ code: "cap_above_request" }));
  });

  test("an expired slip cannot be approved", () => {
    const db = seeded();
    const slipId = requested(db);
    expect(() =>
      approveSlip(db, "user-a", slipId, {}, { now: new Date("2026-04-01T12:30:00.000Z"), hmacKey: SLIP_KEY }),
    ).toThrow(expect.objectContaining({ code: "expired" }));
  });

  test("a second approval is refused", () => {
    const db = seeded();
    const slipId = requested(db);
    approveSlip(db, "user-a", slipId, {}, { now: NOW, hmacKey: SLIP_KEY });
    expect(() => approveSlip(db, "user-a", slipId, {}, { now: NOW, hmacKey: SLIP_KEY })).toThrow(
      expect.objectContaining({ code: "not_pending" }),
    );
  });

  test("approving one slip leaves every other slip untouched", () => {
    const db = seeded();
    const first = requested(db);
    const second = requested(db);
    approveSlip(db, "user-a", first, { callCap: 2 }, { now: NOW, hmacKey: SLIP_KEY });

    expect(getSlip(db, "user-a", first)?.state).toBe("approved");
    expect(getSlip(db, "user-a", second)).toMatchObject({ state: "pending", callCap: 10 });
  });

  test("another user cannot approve the slip", () => {
    const db = userDb(["user-a", "user-b"]);
    seedConnector(db, "user-a", "conn-a", "Calendar");
    seedTool(db, "user-a", {
      id: "tool-a",
      connectorId: "conn-a",
      name: "list_events",
      agentName: "calendar__list_events",
    });
    const slipId = requested(db);
    expect(() => approveSlip(db, "user-b", slipId, {}, { now: NOW, hmacKey: SLIP_KEY })).toThrow(
      expect.objectContaining({ code: "not_found" }),
    );
  });

  test("without a signing key the slip stays pending", () => {
    const db = seeded();
    const slipId = requested(db);
    expect(() => approveSlip(db, "user-a", slipId, {}, { now: NOW })).toThrow(
      expect.objectContaining({ code: "signing_unavailable" }),
    );
    expect(getSlip(db, "user-a", slipId)?.state).toBe("pending");
  });
});

describe("denying a slip", () => {
  test("marks it denied, journals the reason and issues no capability", () => {
    const db = seeded();
    const slipId = requested(db);

    const detail = denySlip(db, "user-a", slipId, "Too broad", { now: NOW });
    expect(detail.slip.state).toBe("denied");
    expect(detail.card.state).toBe("denied");
    expect(getSlip(db, "user-a", slipId)?.capabilityHash).toBeNull();
    expect(listJournalEvents(db, "user-a").at(-1)).toMatchObject({ eventType: "slip.denied" });
  });

  test("an approved slip cannot be denied afterwards", () => {
    const db = seeded();
    const slipId = requested(db);
    approveSlip(db, "user-a", slipId, {}, { now: NOW, hmacKey: SLIP_KEY });
    expect(() => denySlip(db, "user-a", slipId, undefined, { now: NOW })).toThrow(SlipError);
  });
});
