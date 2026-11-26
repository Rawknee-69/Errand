import { describe, expect, test } from "bun:test";
import { traceResponseSchema } from "@errand/shared";
import { createGatewayApp } from "../../src/app.ts";
import { appendJournalEvent } from "../../src/db/journal.ts";
import { calls, slips } from "../../src/db/schema.ts";
import { traceView } from "../../src/trace/view.ts";
import { seedConnector, TS, userDb } from "../agent/support.ts";

function seeded() {
  const db = userDb(["user-a", "user-b"]);
  seedConnector(db, "user-a", "conn-1", "Calendar");
  seedConnector(db, "user-b", "conn-b", "Notion");
  db.insert(slips)
    .values({
      id: "slip-1",
      userId: "user-a",
      errandType: "type-1",
      goal: "Summarise the week",
      state: "approved",
      tier: "learner",
      expiresAt: TS,
      createdAt: TS,
      updatedAt: TS,
    })
    .run();
  db.insert(calls)
    .values({
      id: "call-1",
      userId: "user-a",
      slipId: "slip-1",
      connectorId: "conn-1",
      tool: "calendar__list_events",
      arguments: '{"from":"2026-11-01"}',
      result: '{"events":1}',
      createdAt: TS,
    })
    .run();
  appendJournalEvent(db, {
    userId: "user-a",
    eventType: "vault.credential_used",
    payload: { connector_id: "conn-1", auth_type: "bearer", purpose: "connector_call" },
  });
  appendJournalEvent(db, {
    userId: "user-a",
    eventType: "call.succeeded",
    payload: { call_id: "call-1", tool: "calendar__list_events", result_bytes: 14 },
  });
  appendJournalEvent(db, { userId: "user-b", eventType: "slip.requested", payload: {} });
  return db;
}

describe("trace view", () => {
  test("newest first, scoped, and call rows joined to their event", () => {
    const trace = traceView(seeded(), "user-a");

    expect(trace.events.map((event) => event.eventType)).toEqual([
      "call.succeeded",
      "vault.credential_used",
    ]);
    const call = trace.events[0]?.call;
    expect(call).toMatchObject({
      id: "call-1",
      tool: "calendar__list_events",
      arguments: '{"from":"2026-11-01"}',
      result: '{"events":1}',
    });
    expect(trace.events[1]?.call).toBeNull();
    expect(trace.events[1]?.connectorName).toBe("Calendar");
    expect(trace.events[0]?.connectorName).toBe("Calendar");
    expect(JSON.stringify(trace)).not.toContain("Notion");
  });

  test("limit keeps the latest events and is a bounded query", () => {
    const trace = traceView(seeded(), "user-a", 1);
    expect(trace.events).toHaveLength(1);
    expect(trace.events[0]?.eventType).toBe("call.succeeded");
  });

  test("GET /api/trace returns the contract", async () => {
    const db = seeded();
    const app = createGatewayApp(db, { userId: "user-a", auth: "disabled" });

    const response = await app.request("/api/trace?limit=2");
    expect(response.status).toBe(200);
    const trace = traceResponseSchema.parse(await response.json());
    expect(trace.events).toHaveLength(2);
    expect(trace.events[0]?.call?.tool).toBe("calendar__list_events");
  });
});
