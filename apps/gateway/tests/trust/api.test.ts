import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MOCK_AUTH, MOCK_PATHS, startMockServices } from "@errand/mock-services";
import { licenseAcceptResponseSchema, trustListResponseSchema } from "@errand/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { createGatewayApp } from "../../src/app.ts";
import type { Db } from "../../src/db/client.ts";
import { listJournalEvents } from "../../src/db/journal.ts";
import { trust } from "../../src/db/schema.ts";
import { getSlip } from "../../src/db/scoped-reads.ts";
import { issueAgentKey } from "../../src/vault/agent-keys.ts";
import { VaultKeyring } from "../../src/vault/keyring.ts";
import { KEK, SLIP_KEY, userDb } from "../support/fixtures.ts";
import { callTool, connectAgent } from "../agent/mcp-client.ts";

type TestApp = {
  app: ReturnType<typeof createGatewayApp>;
  db: Db;
  server: ReturnType<typeof Bun.serve>;
  base: string;
};

const requestedSchema = z.object({ slipId: z.string(), state: z.string(), tier: z.string() });

function makeApp(db: Db): TestApp {
  const app = createGatewayApp(db, {
    userId: "user-a",
    auth: "disabled",
    hmacKey: SLIP_KEY,
    keyring: new VaultKeyring(KEK),
    discoverOptions: { allowLocalhostDev: true, timeoutMs: 5_000 },
  });
  const server = Bun.serve({ port: 0, fetch: app.fetch });
  return { app, db, server, base: `http://127.0.0.1:${server.port}` };
}

let mockServer: ReturnType<typeof startMockServices>;
let testApp: TestApp;
let client: Awaited<ReturnType<typeof connectAgent>>;
let errandType: string;

function mockUrl(path: string): string {
  return `http://127.0.0.1:${mockServer.port}${path}`;
}

async function trustList() {
  const response = await testApp.app.request("/api/trust");
  expect(response.status).toBe(200);
  return trustListResponseSchema.parse(await response.json()).trust;
}

async function request(tools: string[], limits?: Record<string, number>) {
  const response = await callTool(client, "request_errand", {
    goal: "A trust test errand",
    tools,
    ...(limits === undefined ? {} : { limits }),
  });
  if (response.result.isError === true) throw new Error(JSON.stringify(response.body));
  return requestedSchema.parse(response.body);
}

async function approve(slipId: string): Promise<void> {
  const response = await testApp.app.request(`/api/slips/${slipId}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  expect(response.status).toBe(200);
}

async function capabilityFor(slipId: string): Promise<string> {
  const status = await callTool(client, "errand_status", { slip_id: slipId });
  return z.object({ capability: z.string() }).parse(status.body).capability;
}

async function call(slipId: string, tool: string, args: Record<string, unknown> = {}) {
  const capability = await capabilityFor(slipId);
  return callTool(client, "errand_call", {
    slip_id: slipId,
    tool,
    capability,
    arguments: args,
  });
}

async function setCalendarFault(mode: "none" | "drop_write"): Promise<void> {
  const response = await fetch(mockUrl("/mock/calendar/fault"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  expect(response.status).toBe(200);
}

async function setRequestable(agentName: string, requestable: boolean): Promise<void> {
  const listed = z
    .object({ tools: z.array(z.object({ id: z.string(), agentName: z.string() })) })
    .parse(await (await testApp.app.request("/api/catalog")).json());
  const tool = listed.tools.find((entry) => entry.agentName === agentName);
  if (tool === undefined) throw new Error(`missing ${agentName}`);
  const response = await testApp.app.request(`/api/catalog/${tool.id}/requestable`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestable }),
  });
  expect(response.status).toBe(200);
}

async function typeFor(tools: string[]): Promise<string> {
  const requested = await request(tools);
  const slip = getSlip(testApp.db, "user-a", requested.slipId);
  if (slip === undefined) throw new Error("the arrangement slip vanished");
  return slip.errandType;
}

function seedLicense(
  type: string,
  caps: { callCap: number; spendCapCents: number; minutes: number } = {
    callCap: 5,
    spendCapCents: 0,
    minutes: 5,
  },
): void {
  testApp.db
    .update(trust)
    .set({
      tier: "license",
      cleanRuns: 5,
      caps: JSON.stringify(caps),
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(trust.userId, "user-a"), eq(trust.errandType, type)))
    .run();
}

function lastTrustEvent() {
  const event = listJournalEvents(testApp.db, "user-a")
    .filter((entry) => entry.eventType === "trust.demoted")
    .at(-1);
  if (event === undefined) throw new Error("no trust.demoted event was journaled");
  return z
    .object({ errand_type: z.string(), reason: z.string(), from_tier: z.string() })
    .parse(JSON.parse(event.payload));
}

beforeAll(async () => {
  mockServer = startMockServices({ port: 0 });
  testApp = makeApp(userDb(["user-a"]));
  const connected = await testApp.app.request("/api/connectors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Calendar",
      url: mockUrl(MOCK_PATHS.calendarSecure),
      authType: "bearer",
      token: MOCK_AUTH.calendarBearer,
    }),
  });
  expect(connected.status).toBe(201);
  const pay = await testApp.app.request("/api/connectors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Pay",
      url: mockUrl(MOCK_PATHS.pay),
      authType: "header",
      headerName: MOCK_AUTH.payHeaderName,
      headerValue: MOCK_AUTH.payHeaderValue,
    }),
  });
  expect(pay.status).toBe(201);
  await setRequestable("pay__charge_card", true);
  const key = issueAgentKey(testApp.db, "user-a", "trust test").key;
  client = await connectAgent(testApp.base, key);
});

afterAll(async () => {
  await client.close();
  testApp.server.stop(true);
  mockServer.stop(true);
});

describe("trust ledger", () => {
  test("a new errand type starts as a learner with no clean runs", async () => {
    const requested = await request(["calendar__list_events"]);
    expect(requested).toMatchObject({ state: "pending", tier: "learner" });

    const slip = getSlip(testApp.db, "user-a", requested.slipId);
    expect(slip?.tier).toBe("learner");
    if (slip === undefined) throw new Error("the requested slip vanished");
    errandType = slip.errandType;
    const views = await trustList();
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      errandType: slip?.errandType,
      tools: ["calendar__list_events"],
      tier: "learner",
      cleanRuns: 0,
      licenseOffered: false,
      caps: null,
    });
  });

  test("five consecutive clean verified runs offer a license", async () => {
    for (let run = 1; run <= 5; run++) {
      const requested = await request(["calendar__list_events"], { calls: 1, minutes: 1 });
      await approve(requested.slipId);
      const response = await call(requested.slipId, "calendar__list_events");
      expect(response.result.isError).toBeFalsy();

      const views = await trustList();
      expect(views[0]?.cleanRuns).toBe(run);
    }

    const views = await trustList();
    expect(views[0]).toMatchObject({ tier: "learner", cleanRuns: 5, licenseOffered: true });
    const offered = listJournalEvents(testApp.db, "user-a").filter(
      (event) => event.eventType === "trust.license_offered",
    );
    expect(offered).toHaveLength(1);
  });

  test("accepting the license sets caps and a license auto-approves within them", async () => {
    const accepted = await testApp.app.request(`/api/trust/${errandType}/license`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callCap: 2, spendCapCents: 0, minutes: 5 }),
    });
    expect(accepted.status).toBe(200);
    const view = licenseAcceptResponseSchema.parse(await accepted.json()).trust;
    expect(view).toMatchObject({
      tier: "license",
      cleanRuns: 5,
      licenseOffered: false,
      caps: { callCap: 2, spendCapCents: 0, minutes: 5 },
    });

    const requested = await request(["calendar__list_events"], {
      calls: 10,
      spend_cents: 5_000,
      minutes: 20,
    });
    expect(requested).toMatchObject({ state: "approved", tier: "license" });

    const slip = getSlip(testApp.db, "user-a", requested.slipId);
    if (slip === undefined) throw new Error("the auto-approved slip vanished");
    expect(slip).toMatchObject({
      state: "approved",
      tier: "license",
      callCap: 2,
      spendCapCents: 0,
    });
    expect(Date.parse(slip.expiresAt) - Date.parse(slip.createdAt)).toBe(5 * 60_000);

    const status = await callTool(client, "errand_status", { slip_id: requested.slipId });
    expect(z.object({ capability: z.string().nullable() }).parse(status.body).capability).not.toBeNull();

    const events = listJournalEvents(testApp.db, "user-a").map((event) => event.eventType);
    expect(events).toContain("trust.license_accepted");
    expect(events).toContain("trust.license_used");
    expect(events).toContain("slip.approved");
  });

  test("a license cannot be accepted before the offer and caps cannot exceed the server maximum", async () => {
    const unknown = await testApp.app.request(`/api/trust/${"f".repeat(64)}/license`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callCap: 1, spendCapCents: 0, minutes: 1 }),
    });
    expect(unknown.status).toBe(404);

    const fresh = await request(["calendar__create_event"]);
    const freshSlip = getSlip(testApp.db, "user-a", fresh.slipId);
    if (freshSlip === undefined) throw new Error("the fresh slip vanished");
    const early = await testApp.app.request(`/api/trust/${freshSlip.errandType}/license`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callCap: 1, spendCapCents: 0, minutes: 1 }),
    });
    expect(early.status).toBe(409);

    const tooWide = await testApp.app.request(`/api/trust/${errandType}/license`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callCap: 10_000, spendCapCents: 0, minutes: 1 }),
    });
    expect(tooWide.status).toBe(400);
  });

  test("a mismatched receipt demotes the errand type and journals its reason", async () => {
    const type = await typeFor(["calendar__create_event"]);
    seedLicense(type);
    await setCalendarFault("drop_write");
    try {
      const requested = await request(["calendar__create_event"]);
      expect(requested.state).toBe("approved");
      const response = await call(requested.slipId, "calendar__create_event", {
        title: "Ghost event",
        start: "2026-12-10T09:00:00Z",
      });
      const receipt = z
        .object({ receipt: z.object({ verification: z.string() }) })
        .parse(response.body).receipt;
      expect(receipt.verification).toBe("mismatched");
    } finally {
      await setCalendarFault("none");
    }

    const view = (await trustList()).find((entry) => entry.errandType === type);
    expect(view).toMatchObject({ tier: "learner", cleanRuns: 0, caps: null });
    expect(lastTrustEvent()).toMatchObject({ errand_type: type, reason: "mismatch", from_tier: "license" });
  });

  test("undoing a change demotes the errand type and journals its reason", async () => {
    const type = await typeFor(["calendar__create_event"]);
    seedLicense(type);
    const requested = await request(["calendar__create_event"]);
    const response = await call(requested.slipId, "calendar__create_event", {
      title: "Undo me",
      start: "2026-12-11T18:00:00Z",
    });
    const receipt = z
      .object({ receipt: z.object({ id: z.string(), verification: z.string() }) })
      .parse(response.body).receipt;
    expect(receipt.verification).toBe("matched");

    const undone = await testApp.app.request(`/api/receipts/${receipt.id}/undo`, { method: "POST" });
    expect(undone.status).toBe(200);

    const view = (await trustList()).find((entry) => entry.errandType === type);
    expect(view).toMatchObject({ tier: "learner", cleanRuns: 0, caps: null });
    expect(lastTrustEvent()).toMatchObject({ errand_type: type, reason: "undo", from_tier: "license" });
  });

  test("an undo that does not land still demotes the errand type", async () => {
    const type = await typeFor(["calendar__create_event"]);
    seedLicense(type);
    const requested = await request(["calendar__create_event"]);
    const response = await call(requested.slipId, "calendar__create_event", {
      title: "Stubborn event",
      start: "2026-12-12T17:00:00Z",
    });
    const receipt = z
      .object({ receipt: z.object({ id: z.string(), verification: z.string() }) })
      .parse(response.body).receipt;
    expect(receipt.verification).toBe("matched");

    await setCalendarFault("drop_write");
    try {
      const undone = await testApp.app.request(`/api/receipts/${receipt.id}/undo`, { method: "POST" });
      expect(undone.status).toBe(200);
      const body = z
        .object({ verification: z.string() })
        .parse(await undone.json());
      expect(body.verification).toBe("mismatched");
    } finally {
      await setCalendarFault("none");
    }

    const view = (await trustList()).find((entry) => entry.errandType === type);
    expect(view).toMatchObject({ tier: "learner", cleanRuns: 0, caps: null });
    expect(lastTrustEvent()).toMatchObject({ errand_type: type, reason: "undo" });
  });

  test("a scope violation demotes the errand type and journals its reason", async () => {
    const type = await typeFor(["calendar__create_event"]);
    seedLicense(type);
    const requested = await request(["calendar__create_event"]);
    const refused = await call(requested.slipId, "calendar__list_events");
    expect(refused.body).toMatchObject({ error: "out_of_scope" });

    const view = (await trustList()).find((entry) => entry.errandType === type);
    expect(view).toMatchObject({ tier: "learner", cleanRuns: 0, caps: null });
    expect(lastTrustEvent()).toMatchObject({
      errand_type: type,
      reason: "scope_violation",
      from_tier: "license",
    });
  });

  test("a license never moves money without the human tap", async () => {
    const type = await typeFor(["pay__charge_card"]);
    seedLicense(type, { callCap: 2, spendCapCents: 500, minutes: 5 });
    const requested = await request(["pay__charge_card"], {
      calls: 2,
      spend_cents: 500,
      minutes: 5,
    });
    expect(requested.state).toBe("approved");

    const response = await call(requested.slipId, "pay__charge_card", { cents: 500 });
    expect(response.body).toMatchObject({
      state: "needs_human",
      amountCents: 500,
    });
    const view = (await trustList()).find((entry) => entry.errandType === type);
    expect(view?.tier).toBe("license");
    const needsHuman = listJournalEvents(testApp.db, "user-a").filter(
      (event) => event.eventType === "outbox.needs_human",
    );
    expect(needsHuman.at(-1)?.payload).toContain(requested.slipId);
  });
});
