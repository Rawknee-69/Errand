import { describe, expect, test } from "bun:test";
import { createGatewayApp } from "../../src/app.ts";
import { requestErrand } from "../../src/agent/request.ts";
import { verifyCapability } from "../../src/policy/capability.ts";
import { getSlip } from "../../src/db/scoped-reads.ts";
import { seedConnector, seedTool, userDb } from "../agent/support.ts";
import { SLIP_KEY } from "../support/fixtures.ts";

const NOW = new Date("2026-04-01T12:00:00.000Z");

function setup() {
  const db = userDb();
  seedConnector(db, "user-a", "conn-a", "Calendar");
  seedTool(db, "user-a", {
    id: "tool-a",
    connectorId: "conn-a",
    name: "list_events",
    agentName: "calendar__list_events",
  });
  const app = createGatewayApp(db, { userId: "user-a", auth: "disabled", hmacKey: SLIP_KEY });
  const slipId = requestErrand(
    db,
    "user-a",
    { goal: "Book a dinner", tools: ["calendar__list_events"], limits: { calls: 10, spendCents: 5000 } },
    new Date(),
  ).slipId;
  return { app, db, slipId };
}

describe("slip API", () => {
  test("lists slips and returns the approval card", async () => {
    const { app, slipId } = setup();

    const list = await app.request("/api/slips");
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { slips: { slipId: string }[] };
    expect(listBody.slips.map((slip) => slip.slipId)).toEqual([slipId]);

    const detail = await app.request(`/api/slips/${slipId}`);
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as {
      slip: { state: string };
      card: { goal: string; services: unknown[]; cannot: string[] };
    };
    expect(body.slip.state).toBe("pending");
    expect(body.card).toMatchObject({
      goal: "Book a dinner",
      services: [{ id: "conn-a", name: "Calendar", tools: ["calendar__list_events"] }],
    });
    expect(body.card.cannot.length).toBeGreaterThan(0);
  });

  test("approving with edited caps reports each trim and its reason", async () => {
    const { app, db, slipId } = setup();

    const response = await app.request(`/api/slips/${slipId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callCap: 4, spendCapCents: 1000 }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      slip: { state: string; callCap: number; spendCapCents: number };
      trims: { field: string; requested: number; applied: number; reason: string }[];
    };
    expect(body.slip).toMatchObject({ state: "approved", callCap: 4, spendCapCents: 1000 });
    expect(body.trims).toEqual([
      { field: "call_cap", requested: 4, applied: 10, reason: "human_trim" },
      { field: "spend_cap_cents", requested: 1000, applied: 5000, reason: "human_trim" },
    ]);

    const row = getSlip(db, "user-a", slipId);
    expect(row === undefined ? false : row.signature !== null).toBe(true);
  });

  test("a denied slip reads denied and carries no capability", async () => {
    const { app, db, slipId } = setup();

    const response = await app.request(`/api/slips/${slipId}/deny`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Not this week" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ slip: { state: "denied" } });

    const row = getSlip(db, "user-a", slipId);
    expect(row?.capabilityHash).toBeNull();
    expect(row === undefined ? true : verifyCapability(row, "cap_x", SLIP_KEY, NOW)).toBe(false);
  });

  test("raising a cap is refused before anything is signed", async () => {
    const { app, db, slipId } = setup();

    const response = await app.request(`/api/slips/${slipId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callCap: 50 }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "cap_above_request" });
    expect(getSlip(db, "user-a", slipId)?.state).toBe("pending");
  });

  test("an unknown slip is a 404", async () => {
    const { app } = setup();
    expect((await app.request("/api/slips/nope")).status).toBe(404);
    expect((await app.request("/api/slips/nope/approve", { method: "POST" })).status).toBe(404);
  });
});
