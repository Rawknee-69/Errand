import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MOCK_AUTH, MOCK_PATHS, startMockServices } from "@errand/mock-services";
import { receiptViewSchema, type ReceiptView } from "@errand/shared";
import { z } from "zod";
import { createGatewayApp, type GatewayAppOptions } from "../../src/app.ts";
import { createForwarder } from "../../src/agent/forward.ts";
import { redactAuthSecrets } from "../../src/connectors/redaction.ts";
import type { Db } from "../../src/db/client.ts";
import { calls, connectors, journal } from "../../src/db/schema.ts";
import { issueAgentKey } from "../../src/vault/agent-keys.ts";
import { VaultKeyring } from "../../src/vault/keyring.ts";
import { listJournalEvents } from "../../src/db/journal.ts";
import { KEK, SLIP_KEY, userDb } from "../support/fixtures.ts";
import { callTool, connectAgent } from "./mcp-client.ts";
import { call, errorSchema, forwardedSchema, requestAndApprove as requestAndApproveShared } from "./forward-support.ts";

const catalogSchema = z.object({
  tools: z.array(
    z.object({
      id: z.string(),
      connectorId: z.string(),
      name: z.string(),
      agentName: z.string(),
      class: z.string(),
      requestable: z.boolean(),
    }),
  ),
});

type TestApp = {
  app: ReturnType<typeof createGatewayApp>;
  db: Db;
  server: ReturnType<typeof Bun.serve>;
  base: string;
};

function makeApp(db: Db, overrides: Partial<GatewayAppOptions> = {}): TestApp {
  const app = createGatewayApp(db, {
    userId: "user-a",
    auth: "disabled",
    hmacKey: SLIP_KEY,
    keyring: new VaultKeyring(KEK),
    discoverOptions: { allowLocalhostDev: true, timeoutMs: 5_000 },
    ...overrides,
  });
  const server = Bun.serve({ port: 0, fetch: app.fetch });
  return { app, db, server, base: `http://127.0.0.1:${server.port}` };
}

async function connectConnector(
  testApp: TestApp,
  name: string,
  path: string,
  auth: Record<string, unknown>,
): Promise<string> {
  const response = await testApp.app.request("/api/connectors", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, url: mockUrl(path), ...auth }),
  });
  expect(response.status).toBe(201);
  const body = z.object({ connector: z.object({ id: z.string() }) }).parse(await response.json());
  return body.connector.id;
}

async function catalog(testApp: TestApp) {
  return catalogSchema.parse(await (await testApp.app.request("/api/catalog")).json());
}

async function setRequestable(testApp: TestApp, toolId: string, requestable: boolean): Promise<void> {
  const response = await testApp.app.request(`/api/catalog/${toolId}/requestable`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestable }),
  });
  expect(response.status).toBe(200);
}

async function requestAndApprove(
  testApp: TestApp,
  client: Awaited<ReturnType<typeof connectAgent>>,
  tools: string[],
): Promise<{ slipId: string; capability: string }> {
  return requestAndApproveShared(client, tools, async (slipId) => {
    const approved = await testApp.app.request(`/api/slips/${slipId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(approved.status).toBe(200);
  });
}

function mockUrl(path: string): string {
  return `http://127.0.0.1:${mockServer.port}${path}`;
}

const receiptSchema = receiptViewSchema;

async function listReceipts(testApp: TestApp): Promise<ReceiptView[]> {
  const response = await testApp.app.request("/api/receipts");
  expect(response.status).toBe(200);
  return z.object({ receipts: z.array(receiptSchema) }).parse(await response.json()).receipts;
}

async function setCalendarFault(mode: "none" | "drop_write"): Promise<void> {
  const response = await fetch(mockUrl("/mock/calendar/fault"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  expect(response.status).toBe(200);
}

function firstText(result: unknown): string {
  const parsed = z
    .object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })) })
    .parse(result);
  return parsed.content.map((item) => item.text ?? "").join("");
}

let mockServer: ReturnType<typeof startMockServices>;
let testApp: TestApp;
let client: Awaited<ReturnType<typeof connectAgent>>;
let bigConnectorId: string;

beforeAll(async () => {
  mockServer = startMockServices({ port: 0 });
  testApp = makeApp(userDb(["user-a"]));
  await connectConnector(testApp, "Calendar", MOCK_PATHS.calendarSecure, {
    authType: "bearer",
    token: MOCK_AUTH.calendarBearer,
  });
  bigConnectorId = await connectConnector(testApp, "Big", MOCK_PATHS.big, {
    authType: "bearer",
    token: MOCK_AUTH.bigBearer,
  });
  const listed = await catalog(testApp);
  for (const agentName of ["calendar__delete_event"]) {
    const tool = listed.tools.find((entry) => entry.agentName === agentName);
    if (tool === undefined) throw new Error(`missing ${agentName}`);
    await setRequestable(testApp, tool.id, true);
  }
  const key = issueAgentKey(testApp.db, "user-a", "forward test").key;
  client = await connectAgent(testApp.base, key);
});

afterAll(async () => {
  await client.close();
  testApp.server.stop(true);
  mockServer.stop(true);
});

describe("forwarding admitted calls", () => {
  test("a read call uses the vault credential, forwards, and redacts the secret everywhere", async () => {
    const { slipId, capability } = await requestAndApprove(testApp, client, ["big__echo_token"]);
    const response = await call(client, slipId, capability, "big__echo_token");

    expect(response.result.isError).toBeFalsy();
    expect(response.body).toMatchObject({
      state: "forwarded",
      slipId,
      tool: "big__echo_token",
      class: "read",
      result: { isError: false, truncated: false },
    });
    expect(JSON.stringify(response.body)).not.toContain(MOCK_AUTH.bigBearer);
    expect(JSON.stringify(response.body)).toContain("[redacted]");

    const status = z
      .object({ callsUsed: z.number() })
      .parse((await callTool(client, "errand_status", { slip_id: slipId })).body);
    expect(status.callsUsed).toBe(1);

    const callRow = testApp.db.select().from(calls).all().find((row) => row.slipId === slipId);
    expect(callRow?.error).toBeNull();
    expect(callRow?.result).toContain("[redacted]");
    expect(callRow?.result).not.toContain(MOCK_AUTH.bigBearer);

    const events = listJournalEvents(testApp.db, "user-a");
    const succeeded = events.filter((event) => event.eventType === "call.succeeded").at(-1);
    expect(succeeded?.payload).toContain(slipId);
    expect(succeeded?.payload).not.toContain(MOCK_AUTH.bigBearer);
    for (const event of events) expect(event.payload).not.toContain(MOCK_AUTH.bigBearer);

    const connector = testApp.db
      .select()
      .from(connectors)
      .all()
      .find((row) => row.id === bigConnectorId);
    expect(connector?.lastSuccessAt).not.toBeNull();
  });

  test("write and delete forward immediately, and delete stays out of scope when not in the slip", async () => {
    const write = await requestAndApprove(testApp, client, ["calendar__create_event"]);
    const written = await call(client, write.slipId, write.capability, "calendar__create_event", {
      title: "Dinner with Sam",
      start: "2026-12-01T19:00:00Z",
    });
    expect(written.result.isError).toBeFalsy();
    expect(written.body).toMatchObject({ state: "forwarded", class: "write" });
    expect(JSON.stringify(written.body)).toContain("evt-2");

    const deletion = await requestAndApprove(testApp, client, ["calendar__delete_event"]);
    const deleted = await call(client, deletion.slipId, deletion.capability, "calendar__delete_event", {
      id: "evt-1",
    });
    expect(deleted.result.isError).toBeFalsy();
    expect(deleted.body).toMatchObject({ state: "forwarded", class: "delete" });
    expect(JSON.stringify(deleted.body)).toContain("evt-1");

    const read = await requestAndApprove(testApp, client, ["calendar__list_events"]);
    const refused = await call(client, read.slipId, read.capability, "calendar__delete_event", {
      id: "evt-1",
    });
    expect(refused.result.isError).toBe(true);
    expect(refused.body).toMatchObject({ error: "out_of_scope" });
  });

  test("a result over 256 KB is truncated and flagged", async () => {
    const { slipId, capability } = await requestAndApprove(testApp, client, ["big__large_result"]);
    const response = await call(client, slipId, capability, "big__large_result", {
      bytes: 300 * 1024,
    });
    expect(response.result.isError).toBeFalsy();
    const body = forwardedSchema.parse(response.body);
    const result = z
      .object({
        truncated: z.literal(true),
        originalBytes: z.number().int().positive(),
      })
      .parse(body.result);
    expect(result.originalBytes).toBeGreaterThan(256 * 1024);
    expect(Buffer.byteLength(JSON.stringify(body.result), "utf8")).toBeLessThanOrEqual(256 * 1024);

    const callRow = testApp.db.select().from(calls).all().find((row) => row.slipId === slipId);
    expect(callRow?.result).not.toBeNull();
    expect(Buffer.byteLength(callRow?.result ?? "", "utf8")).toBeLessThanOrEqual(256 * 1024);
  });

  test("send and spend classes are held until their handlers exist", async () => {
    const payConnectorId = await connectConnector(testApp, "Pay", MOCK_PATHS.pay, {
      authType: "header",
      headerName: MOCK_AUTH.payHeaderName,
      headerValue: MOCK_AUTH.payHeaderValue,
    });
    const forwarder = createForwarder({
      db: testApp.db,
      keyring: new VaultKeyring(KEK),
      discoverOptions: { allowLocalhostDev: true, timeoutMs: 5_000 },
      redirectUri: "http://127.0.0.1:8787/api/oauth/callback",
    });
    const decision = {
      outcome: "admitted" as const,
      slipId: "deferred-slip",
      tool: "pay__send_receipt",
      connectorId: payConnectorId,
      upstreamTool: "send_receipt",
      class: "send" as const,
      amountCents: 0,
      callsRemaining: 1,
      spendRemainingCents: 0,
    };
    const outcome = await forwarder("user-a", decision, { id: "rcpt-1" });
    expect(outcome).toEqual({ state: "not_forwarded", reason: "outbox_not_installed" });

    const spend = await forwarder("user-a", { ...decision, class: "spend" }, { cents: 50 });
    expect(spend).toEqual({ state: "not_forwarded", reason: "spend_tap_not_installed" });
    expect(testApp.db.select().from(calls).all().some((row) => row.slipId === "deferred-slip")).toBe(false);
    const notForwarded = testApp.db
      .select()
      .from(journal)
      .all()
      .filter((event) => event.eventType === "call.not_forwarded");
    expect(notForwarded).toHaveLength(2);
    expect(notForwarded.map((event) => event.payload).join("\n")).toContain("outbox_not_installed");
    expect(notForwarded.map((event) => event.payload).join("\n")).toContain("spend_tap_not_installed");
  });

  test("basic auth redacts the password and its base64 header form, not the username", () => {
    const header = Buffer.from("diner:eats").toString("base64");
    const redacted = redactAuthSecrets(
      { password: "eats", authorization: `Basic ${header}`, username: "diner" },
      { type: "basic", username: "diner", password: "eats" },
    );
    expect(redacted).toEqual({
      password: "[redacted]",
      authorization: "Basic [redacted]",
      username: "diner",
    });
  });

  test("a timeout fails the call, updates counters and is journaled", async () => {
    const timedApp = makeApp(testApp.db, { callTimeoutMs: 150 });
    const key = issueAgentKey(testApp.db, "user-a", "timeout test").key;
    const timedClient = await connectAgent(timedApp.base, key);
    try {
      const { slipId, capability } = await requestAndApprove(timedApp, timedClient, [
        "big__slow_result",
      ]);
      const response = await call(timedClient, slipId, capability, "big__slow_result", { ms: 1_000 });
      expect(response.result.isError).toBe(true);
      const body = errorSchema.extend({ message: z.string() }).parse(response.body);
      expect(body.error).toBe("upstream_timeout");
      expect(body.message).toContain("timed out");

      const status = z
        .object({ callsUsed: z.number() })
        .parse((await callTool(timedClient, "errand_status", { slip_id: slipId })).body);
      expect(status.callsUsed).toBe(1);

      const callRow = testApp.db.select().from(calls).all().find((row) => row.slipId === slipId);
      expect(callRow?.result).toBeNull();
      expect(callRow?.error).toContain("timed out");

      const failed = listJournalEvents(testApp.db, "user-a")
        .filter((event) => event.eventType === "call.failed")
        .map((event) => z.object({ reason: z.string() }).parse(JSON.parse(event.payload)))
        .filter((payload) => payload.reason === "upstream_timeout");
      expect(failed).toHaveLength(1);
    } finally {
      await timedClient.close();
      timedApp.server.stop(true);
    }
  });

  test("per-connector concurrency is limited", async () => {
    const limitedApp = makeApp(testApp.db, { connectorConcurrency: 2, callTimeoutMs: 2_000 });
    const key = issueAgentKey(testApp.db, "user-a", "concurrency test").key;
    const limitedClient = await connectAgent(limitedApp.base, key);
    try {
      await fetch(`${mockUrl("/mock/big/reset")}`, { method: "POST" });
      const { slipId, capability } = await requestAndApprove(limitedApp, limitedClient, [
        "big__slow_result",
      ]);
      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          call(limitedClient, slipId, capability, "big__slow_result", { ms: 120 }),
        ),
      );
      for (const response of responses) expect(response.result.isError).toBeFalsy();

      const stats = z
        .object({ maxActive: z.number().int().positive() })
        .parse(await (await fetch(mockUrl("/mock/big/stats"))).json());
      expect(stats.maxActive).toBe(2);
    } finally {
      await limitedClient.close();
      limitedApp.server.stop(true);
    }
  });
});

describe("receipts, verification and undo", () => {
  afterAll(async () => {
    await setCalendarFault("none");
  });

  test("a calendar create is verified by reading state back and offers an undo", async () => {
    await setCalendarFault("none");
    const { slipId, capability } = await requestAndApprove(testApp, client, [
      "calendar__create_event",
    ]);
    const response = await call(client, slipId, capability, "calendar__create_event", {
      title: "Dinner with Sam",
      start: "2026-12-01T19:00:00Z",
    });
    expect(response.result.isError).toBeFalsy();

    const receipt = z.object({ receipt: receiptSchema }).parse(response.body).receipt;
    expect(receipt).toMatchObject({
      slipId,
      verification: "matched",
      toolClass: "write",
      irreversible: false,
    });
    expect(receipt.undo).not.toBeNull();
    expect(receipt.undo?.appliedAt).toBeNull();
    expect(receipt.summary.toLowerCase()).toContain("read");

    const stored = await listReceipts(testApp);
    expect(stored.some((entry) => entry.id === receipt.id)).toBe(true);

    const created = listJournalEvents(testApp.db, "user-a").filter(
      (event) => event.eventType === "receipt.created",
    );
    expect(created.at(-1)?.payload).toContain(receipt.id);
  });

  test("a forced mismatch is reported as mismatched, not as success", async () => {
    await setCalendarFault("drop_write");
    try {
      const { slipId, capability } = await requestAndApprove(testApp, client, [
        "calendar__create_event",
      ]);
      const response = await call(client, slipId, capability, "calendar__create_event", {
        title: "Ghost event",
        start: "2026-12-02T09:00:00Z",
      });
      expect(response.result.isError).toBeFalsy();

      const receipt = z.object({ receipt: receiptSchema }).parse(response.body).receipt;
      expect(receipt.verification).toBe("mismatched");
      expect(receipt.summary.toLowerCase()).toContain("did not");
      expect(receipt.undo).toBeNull();
    } finally {
      await setCalendarFault("none");
    }
  });

  test("undo applies the inverse, verifies it and is journaled", async () => {
    await setCalendarFault("none");
    const created = await requestAndApprove(testApp, client, ["calendar__create_event"]);
    const response = await call(client, created.slipId, created.capability, "calendar__create_event", {
      title: "Undo me",
      start: "2026-12-03T18:00:00Z",
    });
    const receipt = z.object({ receipt: receiptSchema }).parse(response.body).receipt;

    const undoResponse = await testApp.app.request(`/api/receipts/${receipt.id}/undo`, {
      method: "POST",
    });
    expect(undoResponse.status).toBe(200);
    const undoBody = z
      .object({
        verification: z.enum(["matched", "mismatched", "unverified"]),
        receipt: receiptSchema,
      })
      .parse(await undoResponse.json());
    expect(undoBody.verification).toBe("matched");
    expect(undoBody.receipt.undo?.appliedAt).not.toBeNull();

    const read = await requestAndApprove(testApp, client, ["calendar__list_events"]);
    const listed = await call(client, read.slipId, read.capability, "calendar__list_events");
    expect(firstText(z.object({ result: z.unknown() }).parse(listed.body).result)).not.toContain(
      "Undo me",
    );

    const journaled = listJournalEvents(testApp.db, "user-a").filter(
      (event) => event.eventType === "undo.applied",
    );
    expect(journaled.at(-1)?.payload).toContain(receipt.id);

    const again = await testApp.app.request(`/api/receipts/${receipt.id}/undo`, {
      method: "POST",
    });
    expect(again.status).toBe(409);
  });

  test("an undo that does not land is recorded as mismatched and can be retried", async () => {
    await setCalendarFault("none");
    const created = await requestAndApprove(testApp, client, ["calendar__create_event"]);
    const response = await call(client, created.slipId, created.capability, "calendar__create_event", {
      title: "Stubborn event",
      start: "2026-12-05T17:00:00Z",
    });
    const receipt = z.object({ receipt: receiptSchema }).parse(response.body).receipt;

    await setCalendarFault("drop_write");
    try {
      const undoResponse = await testApp.app.request(`/api/receipts/${receipt.id}/undo`, {
        method: "POST",
      });
      expect(undoResponse.status).toBe(200);
      const undoBody = z
        .object({
          verification: z.enum(["matched", "mismatched", "unverified"]),
          receipt: receiptSchema,
        })
        .parse(await undoResponse.json());
      expect(undoBody.verification).toBe("mismatched");
      expect(undoBody.receipt.undo?.appliedAt).toBeNull();
      expect(undoBody.receipt.undo?.verification).toBe("mismatched");

      const stored = await testApp.app.request(`/api/receipts/${receipt.id}`);
      const storedReceipt = z
        .object({ receipt: receiptSchema })
        .parse(await stored.json()).receipt;
      expect(storedReceipt.undo?.verification).toBe("mismatched");
    } finally {
      await setCalendarFault("none");
    }

    const retry = await testApp.app.request(`/api/receipts/${receipt.id}/undo`, {
      method: "POST",
    });
    expect(retry.status).toBe(200);
    const retryBody = z
      .object({ verification: z.enum(["matched", "mismatched", "unverified"]), receipt: receiptSchema })
      .parse(await retry.json());
    expect(retryBody.verification).toBe("matched");
    expect(retryBody.receipt.undo?.appliedAt).not.toBeNull();
    expect(retryBody.receipt.undo?.verification).toBe("matched");
  });

  test("a delete is verified, irreversible and has no undo", async () => {
    await setCalendarFault("none");
    const created = await requestAndApprove(testApp, client, ["calendar__create_event"]);
    const write = await call(client, created.slipId, created.capability, "calendar__create_event", {
      title: "Temporary event",
      start: "2026-12-04T08:00:00Z",
    });
    const event = z
      .object({ id: z.string() })
      .parse(JSON.parse(firstText(z.object({ result: z.unknown() }).parse(write.body).result)));

    const deletion = await requestAndApprove(testApp, client, ["calendar__delete_event"]);
    const deleted = await call(
      client,
      deletion.slipId,
      deletion.capability,
      "calendar__delete_event",
      { id: event.id },
    );
    expect(deleted.result.isError).toBeFalsy();

    const receipt = z.object({ receipt: receiptSchema }).parse(deleted.body).receipt;
    expect(receipt).toMatchObject({
      verification: "matched",
      toolClass: "delete",
      irreversible: true,
      undo: null,
    });
    expect(receipt.summary.toLowerCase()).toContain("cannot be undone");
  });

  test("a connector without a verifier yields unverified and says so plainly", async () => {
    const dineOutConnectorId = await connectConnector(testApp, "Dine out", MOCK_PATHS.dineOutSse, {
      authType: "basic",
      username: MOCK_AUTH.dineOutUser,
      password: MOCK_AUTH.dineOutPassword,
    });
    const listed = await catalog(testApp);
    const reserve = listed.tools.find(
      (entry) => entry.connectorId === dineOutConnectorId && entry.name === "reserve_table",
    );
    if (reserve === undefined) throw new Error("missing dine-out reserve_table");
    expect(reserve.class).toBe("write");
    await setRequestable(testApp, reserve.id, true);

    const { slipId, capability } = await requestAndApprove(testApp, client, [reserve.agentName]);
    const response = await call(client, slipId, capability, reserve.agentName, {
      restaurant: "The Table",
      party: 2,
    });
    expect(response.result.isError).toBeFalsy();

    const receipt = z.object({ receipt: receiptSchema }).parse(response.body).receipt;
    expect(receipt).toMatchObject({
      verification: "unverified",
      toolClass: "write",
      irreversible: false,
      undo: null,
    });
    expect(receipt.summary.toLowerCase()).toContain("unverified");
    expect(receipt.summary.toLowerCase()).toContain("no verifier");
  });
});

