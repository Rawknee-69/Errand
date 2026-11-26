import { describe, expect, test } from "bun:test";
import { AGENT_LIMITS } from "../../src/agent/limits.ts";
import { ErrandRequestError, requestErrand, type RequestErrandInput } from "../../src/agent/request.ts";
import { listJournalEvents } from "../../src/db/journal.ts";
import { getSlip } from "../../src/db/scoped-reads.ts";
import { seedConnector, seedTool, userDb } from "./support.ts";

const NOW = new Date("2026-04-01T12:00:00.000Z");

function seeded() {
  const db = userDb(["user-a", "user-b"]);
  seedConnector(db, "user-a", "conn-a", "Calendar");
  seedTool(db, "user-a", {
    id: "tool-a",
    connectorId: "conn-a",
    name: "list_events",
    agentName: "calendar__list_events",
  });
  seedTool(db, "user-a", {
    id: "tool-b",
    connectorId: "conn-a",
    name: "create_event",
    agentName: "calendar__create_event",
    class: "write",
  });
  seedTool(db, "user-a", {
    id: "tool-delete",
    connectorId: "conn-a",
    name: "delete_event",
    agentName: "calendar__delete_event",
    class: "delete",
    requestable: false,
  });
  seedTool(db, "user-a", {
    id: "tool-decoy",
    connectorId: "conn-a",
    name: "export_all_contacts",
    agentName: "calendar__export_all_contacts",
    requestable: true,
  });
  seedConnector(db, "user-b", "conn-b", "Notion");
  seedTool(db, "user-b", {
    id: "tool-c",
    connectorId: "conn-b",
    name: "search_pages",
    agentName: "notion__search_pages",
  });
  return db;
}

describe("requestErrand", () => {
  test("persists a pending slip with clamped caps and returns immediately", () => {
    const db = seeded();

    const result = requestErrand(
      db,
      "user-a",
      { goal: "Book a dinner", tools: ["calendar__list_events"], limits: { calls: 5_000 } },
      NOW,
    );

    expect(result).toMatchObject({
      state: "pending",
      tier: "learner",
      callCap: AGENT_LIMITS.calls,
      spendCapCents: AGENT_LIMITS.spendCents,
      expiresAt: "2026-04-01T12:30:00.000Z",
      clamped: [
        {
          field: "calls",
          requested: 5_000,
          applied: AGENT_LIMITS.calls,
          reason: "server_maximum",
        },
      ],
    });
    expect(result.tools).toEqual([
      { name: "calendar__list_events", connectorId: "conn-a", class: "read" },
    ]);

    const slip = getSlip(db, "user-a", result.slipId);
    expect(slip?.state).toBe("pending");
    expect(slip?.goal).toBe("Book a dinner");
    expect(slip?.callCap).toBe(AGENT_LIMITS.calls);
    expect(slip?.signature).toBeNull();
    expect(listJournalEvents(db, "user-a").map((event) => event.eventType)).toEqual([
      "slip.requested",
    ]);
    const requested = listJournalEvents(db, "user-a")[0];
    if (requested === undefined) throw new Error("the request was not journaled");
    expect(JSON.parse(requested.payload)).toMatchObject({
      goal: "Book a dinner",
      clamped: [
        {
          field: "calls",
          requested: 5_000,
          applied: AGENT_LIMITS.calls,
          reason: "server_maximum",
        },
      ],
    });
  });

  test("the same tools in a different order are the same errand type", () => {
    const db = seeded();
    const first = requestErrand(
      db,
      "user-a",
      { goal: "one", tools: ["calendar__list_events", "calendar__create_event"] },
      NOW,
    );
    const second = requestErrand(
      db,
      "user-a",
      { goal: "two", tools: ["calendar__create_event", "calendar__list_events"] },
      NOW,
    );

    expect(getSlip(db, "user-a", first.slipId)?.errandType).toBe(
      getSlip(db, "user-a", second.slipId)?.errandType,
    );
  });

  const refusals: { name: string; input: RequestErrandInput; code: string }[] = [
    {
      name: "a tool this user does not have",
      input: { goal: "x", tools: ["notion__search_pages"] },
      code: "unknown_tool",
    },
    {
      name: "a non-requestable tool",
      input: { goal: "x", tools: ["calendar__delete_event"] },
      code: "unknown_tool",
    },
    {
      name: "a decoy",
      input: { goal: "x", tools: ["calendar__export_all_contacts"] },
      code: "decoy",
    },
    {
      name: "a blank goal",
      input: { goal: "   ", tools: ["calendar__list_events"] },
      code: "invalid_goal",
    },
  ];

  test.each(refusals)("refuses $name", ({ input, code }) => {
    const db = seeded();
    expect(() => requestErrand(db, "user-a", input, NOW)).toThrow(
      expect.objectContaining({ code }),
    );
    expect(() => requestErrand(db, "user-a", input, NOW)).toThrow(ErrandRequestError);
  });
});
