import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MOCK_AUTH, MOCK_PATHS, startMockServices } from "@errand/mock-services";
import { z } from "zod";
import {
  outboxItemResponseSchema,
  outboxListResponseSchema,
  type OutboxItem,
} from "@errand/shared";
import { createGatewayApp, type GatewayAppOptions } from "../../src/app.ts";
import { createForwarder } from "../../src/agent/forward.ts";
import type { Db } from "../../src/db/client.ts";
import { listJournalEvents } from "../../src/db/journal.ts";
import { calls, outbox, slips, type Tier } from "../../src/db/schema.ts";
import { getSlip } from "../../src/db/scoped-reads.ts";
import { errandTypeFor } from "../../src/policy/errand-type.ts";
import { issueCapability } from "../../src/policy/capability.ts";
import { approveSlip } from "../../src/slips/approval.ts";
import { issueAgentKey } from "../../src/vault/agent-keys.ts";
import { VaultKeyring } from "../../src/vault/keyring.ts";
import { KEK, SLIP_KEY, userDb } from "../support/fixtures.ts";
import { call, errorSchema } from "../agent/forward-support.ts";
import { connectAgent } from "../agent/mcp-client.ts";
import { openSse, readSseUntil } from "../support/sse.ts";

const pendingSchema = z.object({
  state: z.enum(["held", "needs_human"]),
  slipId: z.string(),
  tool: z.string(),
  outboxId: z.string(),
  releaseAt: z.string().nullable().optional(),
  expiresAt: z.string(),
  amountCents: z.number().int().nonnegative().optional(),
});

let mockServer: ReturnType<typeof startMockServices>;
let db: Db;
let testApp: {
  app: ReturnType<typeof createGatewayApp>;
  base: string;
  server: ReturnType<typeof Bun.serve>;
};
let client: Awaited<ReturnType<typeof connectAgent>>;
let payConnectorId: string;

function mockUrl(path: string): string {
  return `http://127.0.0.1:${mockServer.port}${path}`;
}

function makeApp(overrides: Partial<GatewayAppOptions> = {}) {
  const app = createGatewayApp(db, {
    userId: "user-a",
    auth: "disabled",
    hmacKey: SLIP_KEY,
    keyring: new VaultKeyring(KEK),
    discoverOptions: { allowLocalhostDev: true, timeoutMs: 5_000 },
    outboxReleaseIntervalMs: 0,
    ...overrides,
  });
  const server = Bun.serve({ port: 0, fetch: app.fetch });
  return { app, base: `http://127.0.0.1:${server.port}`, server };
}

function testOutbox() {
  return createForwarder({
    db,
    keyring: new VaultKeyring(KEK),
    discoverOptions: { allowLocalhostDev: true, timeoutMs: 5_000 },
    redirectUri: "http://127.0.0.1:8787/api/oauth/callback",
    hmacKey: SLIP_KEY,
  }).outbox;
}

function seedSlip(options: {
  tools: Array<{ name: string; connectorId: string; class: "send" | "spend" }>;
  constraints?: Record<string, unknown>;
  tier?: Tier;
  callCap?: number;
  spendCapCents?: number;
}): { slipId: string; capability: string } {
  const id = randomUUID();
  const now = new Date();
  const constraints = options.constraints ?? {};
  db.insert(slips)
    .values({
      id,
      userId: "user-a",
      errandType: errandTypeFor(
        options.tools.map((tool) => tool.name),
        Object.keys(constraints),
      ),
      goal: "Outbox test errand",
      state: "pending",
      tier: options.tier ?? "learner",
      tools: JSON.stringify(options.tools),
      constraints: JSON.stringify(constraints),
      callCap: options.callCap ?? 10,
      spendCapCents: options.spendCapCents ?? 10_000,
      expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    .run();
  approveSlip(db, "user-a", id, {}, { hmacKey: SLIP_KEY, now });
  const row = getSlip(db, "user-a", id);
  if (row === undefined) throw new Error("seeded slip vanished");
  return { slipId: id, capability: issueCapability(row, SLIP_KEY) };
}

function sendSlip(): { slipId: string; capability: string } {
  return seedSlip({
    tools: [{ name: "pay__send_receipt", connectorId: payConnectorId, class: "send" }],
    constraints: { pay__send_receipt: { id: ["rcpt-1"] } },
  });
}

function spendSlip(tier: Tier = "learner"): { slipId: string; capability: string } {
  return seedSlip({
    tools: [{ name: "pay__charge_card", connectorId: payConnectorId, class: "spend" }],
    tier,
    spendCapCents: 10_000,
  });
}

function callsFor(slipId: string) {
  return db.select().from(calls).all().filter((row) => row.slipId === slipId);
}

function outboxRows(slipId: string) {
  return db.select().from(outbox).all().filter((row) => row.slipId === slipId);
}

function events(type: string) {
  return listJournalEvents(db, "user-a").filter((event) => event.eventType === type);
}

async function listOutbox(): Promise<OutboxItem[]> {
  const response = await testApp.app.request("/api/outbox");
  expect(response.status).toBe(200);
  return outboxListResponseSchema.parse(await response.json()).items;
}

async function cancel(id: string) {
  const response = await testApp.app.request(`/api/outbox/${id}/cancel`, { method: "POST" });
  return {
    status: response.status,
    body: response.status === 200 ? outboxItemResponseSchema.parse(await response.json()).item : null,
    raw: response.status === 200 ? null : await response.json(),
  };
}

async function confirm(id: string) {
  const response = await testApp.app.request(`/api/outbox/${id}/confirm`, { method: "POST" });
  return {
    status: response.status,
    body: response.status === 200 ? outboxItemResponseSchema.parse(await response.json()).item : null,
    raw: response.status === 200 ? null : await response.json(),
  };
}

beforeAll(async () => {
  mockServer = startMockServices({ port: 0 });
  db = userDb(["user-a"]);
  testApp = makeApp();
  const connected = await testApp.app.request("/api/connectors", {
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
  expect(connected.status).toBe(201);
  payConnectorId = z
    .object({ connector: z.object({ id: z.string() }) })
    .parse(await connected.json()).connector.id;

  const catalog = z
    .object({
      tools: z.array(z.object({ id: z.string(), agentName: z.string() })),
    })
    .parse(await (await testApp.app.request("/api/catalog")).json());
  for (const name of ["pay__send_receipt", "pay__charge_card"]) {
    const tool = catalog.tools.find((entry) => entry.agentName === name);
    if (tool === undefined) throw new Error(`missing ${name}`);
    const response = await testApp.app.request(`/api/catalog/${tool.id}/requestable`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestable: true }),
    });
    expect(response.status).toBe(200);
  }

  const key = issueAgentKey(db, "user-a", "outbox test").key;
  client = await connectAgent(testApp.base, key);
});

afterAll(async () => {
  await client.close();
  testApp.server.stop(true);
  mockServer.stop(true);
});

describe("the outbox", () => {
  test("holds a send for 30 seconds, reserving the call without forwarding", async () => {
    const slip = sendSlip();
    const response = await call(client, slip.slipId, slip.capability, "pay__send_receipt", {
      id: "rcpt-1",
    });
    expect(response.result.isError).toBeFalsy();
    const body = pendingSchema.parse(response.body);
    expect(body.state).toBe("held");
    expect(body.tool).toBe("pay__send_receipt");
    expect(Date.parse(body.releaseAt ?? "") - Date.now()).toBeGreaterThan(28_000);
    expect(Date.parse(body.releaseAt ?? "") - Date.now()).toBeLessThanOrEqual(30_100);

    expect(callsFor(slip.slipId)).toHaveLength(0);
    expect(getSlip(db, "user-a", slip.slipId)?.callsUsed).toBe(1);
    const held = events("outbox.held").at(-1);
    expect(held?.payload).toContain(slip.slipId);
    expect(held?.payload).toContain(body.outboxId);

    const listed = (await listOutbox()).find((item) => item.id === body.outboxId);
    expect(listed).toMatchObject({
      state: "held",
      toolClass: "send",
      slipId: slip.slipId,
      goal: "Outbox test errand",
    });
  });

  test("releases a due send once, forwarding it and journaling the release", async () => {
    const slip = sendSlip();
    const response = await call(client, slip.slipId, slip.capability, "pay__send_receipt", {
      id: "rcpt-1",
    });
    const pending = pendingSchema.parse(response.body);
    const outboxService = testOutbox();

    const fired = await outboxService.releaseDue(
      new Date(Date.parse(pending.releaseAt ?? "") + 1_000),
    );
    expect(fired).toBeGreaterThanOrEqual(1);

    const rows = callsFor(slip.slipId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.result).toContain("rcpt-1");
    const item = outboxRows(slip.slipId)[0];
    expect(item?.state).toBe("released");
    expect(item?.callId).toBe(rows[0]?.id);
    expect(events("outbox.released").some((event) => event.payload.includes(pending.outboxId))).toBe(true);
    expect(events("call.succeeded").some((event) => event.payload.includes(slip.slipId))).toBe(true);

    const second = await outboxService.releaseDue(
      new Date(Date.parse(pending.releaseAt ?? "") + 2_000),
    );
    expect(second).toBe(0);
    expect(callsFor(slip.slipId)).toHaveLength(1);
  });

  test("cancels a held send, refunds the reservation and never forwards", async () => {
    const slip = sendSlip();
    const response = await call(client, slip.slipId, slip.capability, "pay__send_receipt", {
      id: "rcpt-1",
    });
    const pending = pendingSchema.parse(response.body);

    const cancelled = await cancel(pending.outboxId);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ state: "cancelled", reason: "human_cancelled" });
    expect(events("outbox.cancelled").some((event) => event.payload.includes(pending.outboxId))).toBe(true);
    expect(getSlip(db, "user-a", slip.slipId)?.callsUsed).toBe(0);

    const fired = await testOutbox().releaseDue(
      new Date(Date.parse(pending.releaseAt ?? "") + 1_000),
    );
    expect(fired).toBe(0);
    expect(callsFor(slip.slipId)).toHaveLength(0);
    expect(outboxRows(slip.slipId)[0]?.state).toBe("cancelled");

    const again = await cancel(pending.outboxId);
    expect(again.status).toBe(409);
  });

  test("an expired outbox item never fires and refunds the call", async () => {
    const slip = sendSlip();
    const response = await call(client, slip.slipId, slip.capability, "pay__send_receipt", {
      id: "rcpt-1",
    });
    const pending = pendingSchema.parse(response.body);
    db.update(outbox)
      .set({ releaseAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:00:01.000Z" })
      .where(eq(outbox.id, pending.outboxId))
      .run();

    const fired = await testOutbox().releaseDue(new Date("2026-01-01T00:00:02.000Z"));
    expect(fired).toBe(0);
    expect(callsFor(slip.slipId)).toHaveLength(0);
    expect(outboxRows(slip.slipId)[0]?.state).toBe("expired");
    expect(events("outbox.expired").some((event) => event.payload.includes(pending.outboxId))).toBe(true);
    expect(getSlip(db, "user-a", slip.slipId)?.callsUsed).toBe(0);
  });

  test("a held send whose slip was burned during the window never fires", async () => {
    const slip = sendSlip();
    const response = await call(client, slip.slipId, slip.capability, "pay__send_receipt", {
      id: "rcpt-1",
    });
    const pending = pendingSchema.parse(response.body);
    db.update(slips)
      .set({ state: "burned", capabilityHash: null, burnedReason: "decoy", burnedAt: new Date().toISOString() })
      .where(eq(slips.id, slip.slipId))
      .run();

    const fired = await testOutbox().releaseDue(
      new Date(Date.parse(pending.releaseAt ?? "") + 1_000),
    );
    expect(fired).toBe(0);
    expect(callsFor(slip.slipId)).toHaveLength(0);
    expect(outboxRows(slip.slipId)[0]?.state).toBe("expired");
    expect(events("outbox.expired").at(-1)?.payload).toContain("burned");
  });

  test("a spend returns needs_human on both tiers and moves nothing", async () => {
    for (const tier of ["learner", "license"] as const) {
      const slip = spendSlip(tier);
      const response = await call(client, slip.slipId, slip.capability, "pay__charge_card", {
        cents: 500,
      });
      expect(response.result.isError).toBeFalsy();
      const body = pendingSchema.parse(response.body);
      expect(body.state).toBe("needs_human");
      expect(body.amountCents).toBe(500);
      expect(callsFor(slip.slipId)).toHaveLength(0);
      expect(getSlip(db, "user-a", slip.slipId)?.spendUsedCents).toBe(500);
      expect(
        events("outbox.needs_human").some(
          (event) => event.payload.includes(body.outboxId) && event.payload.includes('"class":"spend"'),
        ),
      ).toBe(true);

      const listed = (await listOutbox()).find((item) => item.id === body.outboxId);
      expect(listed).toMatchObject({ state: "needs_human", toolClass: "spend", amountCents: 500 });
    }
  });

  test("a separate confirm forwards the spend and journals the tap; deny refunds it", async () => {
    const confirmedSlip = spendSlip();
    const confirmedResponse = await call(
      client,
      confirmedSlip.slipId,
      confirmedSlip.capability,
      "pay__charge_card",
      { cents: 700 },
    );
    const confirmedPending = pendingSchema.parse(confirmedResponse.body);
    const confirmed = await confirm(confirmedPending.outboxId);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body?.state).toBe("confirmed");
    expect(callsFor(confirmedSlip.slipId)).toHaveLength(1);
    expect(callsFor(confirmedSlip.slipId)[0]?.result).toContain("ch-1");
    expect(
      events("outbox.confirmed").some((event) => event.payload.includes(confirmedPending.outboxId)),
    ).toBe(true);

    const deniedSlip = spendSlip();
    const deniedResponse = await call(client, deniedSlip.slipId, deniedSlip.capability, "pay__charge_card", {
      cents: 900,
    });
    const deniedPending = pendingSchema.parse(deniedResponse.body);
    const denied = await cancel(deniedPending.outboxId);
    expect(denied.status).toBe(200);
    expect(denied.body?.state).toBe("cancelled");
    expect(callsFor(deniedSlip.slipId)).toHaveLength(0);
    expect(getSlip(db, "user-a", deniedSlip.slipId)?.spendUsedCents).toBe(0);
    const spendRow = getSlip(db, "user-a", deniedSlip.slipId);
    expect(spendRow?.callsUsed).toBe(0);
  });

  test("a spend cannot be confirmed after its tap window expires", async () => {
    const slip = spendSlip();
    const response = await call(client, slip.slipId, slip.capability, "pay__charge_card", {
      cents: 300,
    });
    const pending = pendingSchema.parse(response.body);
    db.update(outbox)
      .set({ expiresAt: "2026-01-01T00:00:00.000Z" })
      .where(eq(outbox.id, pending.outboxId))
      .run();

    const late = await confirm(pending.outboxId);
    expect(late.status).toBe(409);
    expect(errorSchema.parse(late.raw).error).toBe("expired");
    expect(callsFor(slip.slipId)).toHaveLength(0);
    expect(outboxRows(slip.slipId)[0]?.state).toBe("expired");
    expect(getSlip(db, "user-a", slip.slipId)?.spendUsedCents).toBe(0);
  });

  test("held, confirmed and cancelled moments reach the live feed", async () => {
    const response = await testApp.app.request("/api/events");
    const sse = openSse(response);
    try {
      await readSseUntil(sse, (text) => text.includes("event: ready"));

      const send = sendSlip();
      const held = await call(client, send.slipId, send.capability, "pay__send_receipt", {
        id: "rcpt-1",
      });
      const pending = pendingSchema.parse(held.body);
      const heldFrames = await readSseUntil(sse, (text) =>
        text.includes(`"outbox_id":"${pending.outboxId}"`),
      );
      expect(heldFrames).toContain("outbox.held");

      await cancel(pending.outboxId);
      const cancelledFrames = await readSseUntil(
        sse,
        (text) =>
          text.includes(`"outbox_id":"${pending.outboxId}"`) && text.includes("outbox.cancelled"),
      );
      expect(cancelledFrames).toContain("outbox.cancelled");

      const spend = spendSlip();
      const tapped = await call(client, spend.slipId, spend.capability, "pay__charge_card", {
        cents: 200,
      });
      const spendPending = pendingSchema.parse(tapped.body);
      await confirm(spendPending.outboxId);
      const confirmedFrames = await readSseUntil(sse, (text) =>
        text.includes(`"outbox_id":"${spendPending.outboxId}"`) && text.includes("outbox.confirmed"),
      );
      expect(confirmedFrames).toContain("outbox.confirmed");
    } finally {
      await sse.cancel();
    }
  });

  test("cancel is not a spend confirmation and confirm is not a send release", async () => {
    const send = sendSlip();
    const sendResponse = await call(client, send.slipId, send.capability, "pay__send_receipt", {
      id: "rcpt-1",
    });
    const sendPending = pendingSchema.parse(sendResponse.body);
    const wrong = await confirm(sendPending.outboxId);
    expect(wrong.status).toBe(409);
    expect(errorSchema.parse(wrong.raw).error).toBe("not_confirmable");

    const spend = spendSlip();
    const spendResponse = await call(client, spend.slipId, spend.capability, "pay__charge_card", {
      cents: 100,
    });
    const spendPending = pendingSchema.parse(spendResponse.body);
    const cancelled = await cancel(spendPending.outboxId);
    expect(cancelled.body?.state).toBe("cancelled");
  });
});
