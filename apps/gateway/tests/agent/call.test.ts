import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { SlipTool } from "@errand/shared";
import { z } from "zod";
import { createGatewayApp } from "../../src/app.ts";
import { createMigratedDatabase, type Db } from "../../src/db/client.ts";
import { listJournalEvents } from "../../src/db/journal.ts";
import { connectors, slips, tools, users } from "../../src/db/schema.ts";
import { getSlip } from "../../src/db/scoped-reads.ts";
import { errandTypeFor } from "../../src/policy/errand-type.ts";
import { SPEND_AMOUNT_ARGUMENT } from "../../src/policy/spend.ts";
import { hashCapability, issueCapability, issueValidCapability } from "../../src/policy/capability.ts";
import { signSlip } from "../../src/policy/slip-signing.ts";
import { approveSlip } from "../../src/slips/approval.ts";
import { issueAgentKey } from "../../src/vault/agent-keys.ts";
import { callTool, connectAgent } from "./mcp-client.ts";
import { seedConnector, seedTool, userDb } from "./support.ts";
import { SLIP_KEY, TS } from "../support/fixtures.ts";

const NOW = new Date();
const LATER = new Date(NOW.getTime() + 30 * 60_000).toISOString();
const querySchema = JSON.stringify({
  type: "object",
  properties: { query: { type: "string" } },
  required: ["query"],
  additionalProperties: false,
});
const sendSchema = JSON.stringify({
  type: "object",
  properties: { to: { type: "string" }, note: { type: "string" } },
  required: ["to"],
  additionalProperties: false,
});
const paySchema = JSON.stringify({
  type: "object",
  properties: { [SPEND_AMOUNT_ARGUMENT]: { type: "integer", minimum: 0 } },
  required: [SPEND_AMOUNT_ARGUMENT],
  additionalProperties: false,
});

let db: Db;
let server: ReturnType<typeof Bun.serve>;
let app: ReturnType<typeof createGatewayApp>;
let key: string;
let friendKey: string;

const READ: SlipTool = { name: "calendar__list_events", connectorId: "conn-a", class: "read" };
const SEARCH: SlipTool = { name: "calendar__search_events", connectorId: "conn-a", class: "read" };
const SEND: SlipTool = { name: "calendar__send_invite", connectorId: "conn-a", class: "send" };
const SPEND: SlipTool = { name: "pay__charge_card", connectorId: "conn-pay", class: "spend" };
const UNKNOWN: SlipTool = { name: "calendar__mystery", connectorId: "conn-a", class: "unknown" };

type SlipOptions = {
  userId?: string;
  tools?: SlipTool[];
  constraints?: Record<string, unknown>;
  callCap?: number;
  spendCapCents?: number;
  rateCap?: number;
};

function seedSlip(options: SlipOptions = {}): { slipId: string; capability: string } {
  const userId = options.userId ?? "user-a";
  const chosen = options.tools ?? [READ];
  const constraints = options.constraints ?? {};
  const id = randomUUID();
  db.insert(slips)
    .values({
      id,
      userId,
      errandType: errandTypeFor(
        chosen.map((tool) => tool.name),
        Object.keys(constraints),
      ),
      goal: "Test errand",
      state: "pending",
      tier: "learner",
      tools: JSON.stringify(chosen),
      constraints: JSON.stringify(constraints),
      callCap: options.callCap ?? 10,
      spendCapCents: options.spendCapCents ?? 10_000,
      rateCap: options.rateCap ?? 20,
      expiresAt: LATER,
      createdAt: TS,
      updatedAt: TS,
    })
    .run();
  approveSlip(db, userId, id, {}, { hmacKey: SLIP_KEY });
  const row = getSlip(db, userId, id);
  if (row === undefined) throw new Error("seeded slip vanished");
  const capability = issueValidCapability(row, SLIP_KEY, NOW);
  if (capability === null) throw new Error("seeded slip did not produce a capability");
  return { slipId: id, capability };
}

// Re-signing models a slip approved earlier whose expiry has since passed, so
// the capability and signature are both genuine and only expiry can deny it.
function expireSlip(slipId: string): string {
  const row = getSlip(db, "user-a", slipId);
  if (row === undefined) throw new Error("seeded slip vanished");
  const expiresAt = new Date(Date.now() - 60_000).toISOString();
  const draft = { ...row, expiresAt };
  const capability = issueCapability(draft, SLIP_KEY);
  db.update(slips)
    .set({
      expiresAt,
      signature: signSlip(draft, SLIP_KEY),
      capabilityHash: hashCapability(capability),
    })
    .where(eq(slips.id, slipId))
    .run();
  return capability;
}

async function connect(agentKey: string) {
  return connectAgent(`http://127.0.0.1:${server.port}`, agentKey);
}

async function call(
  client: Awaited<ReturnType<typeof connect>>,
  slipId: string,
  capability: string,
  tool: string,
  args: Record<string, unknown> = {},
) {
  return callTool(client, "errand_call", {
    slip_id: slipId,
    tool,
    capability,
    arguments: args,
  });
}

function denial(body: unknown): { error: string; message: string; tool?: string | undefined } {
  return z
    .object({ error: z.string(), message: z.string(), tool: z.string().optional() })
    .parse(body);
}

type CallResponse = { result: { isError?: boolean | undefined }; body: unknown };

function expectDenied(response: CallResponse, reason: string, userId = "user-a"): void {
  expect(response.result.isError).toBe(true);
  expect(denial(response.body).error).toBe(reason);
  const last = listJournalEvents(db, userId).at(-1);
  expect(last?.eventType).toBe(reason === "out_of_scope" ? "call.scope_violation" : "call.denied");
  const payload = z
    .object({ reason: z.string(), slip_id: z.string(), tool: z.string() })
    .parse(JSON.parse(last?.payload ?? "{}"));
  expect(payload.reason).toBe(reason);
}

beforeAll(() => {
  db = userDb(["user-a", "user-b"]);
  seedConnector(db, "user-a", "conn-a", "Calendar");
  seedConnector(db, "user-a", "conn-pay", "Pay");
  seedTool(db, "user-a", {
    id: "tool-list",
    connectorId: "conn-a",
    name: "list_events",
    agentName: "calendar__list_events",
  });
  seedTool(db, "user-a", {
    id: "tool-search",
    connectorId: "conn-a",
    name: "search_events",
    agentName: "calendar__search_events",
    inputSchema: querySchema,
  });
  seedTool(db, "user-a", {
    id: "tool-send",
    connectorId: "conn-a",
    name: "send_invite",
    agentName: "calendar__send_invite",
    class: "send",
    requestable: false,
    inputSchema: sendSchema,
  });
  seedTool(db, "user-a", {
    id: "tool-pay",
    connectorId: "conn-pay",
    name: "charge_card",
    agentName: "pay__charge_card",
    class: "spend",
    requestable: false,
    inputSchema: paySchema,
  });
  seedTool(db, "user-a", {
    id: "tool-mystery",
    connectorId: "conn-a",
    name: "mystery",
    agentName: "calendar__mystery",
    class: "unknown",
    requestable: false,
  });
  seedTool(db, "user-a", {
    id: "tool-delete",
    connectorId: "conn-a",
    name: "delete_event",
    agentName: "calendar__delete_event",
    class: "delete",
    requestable: false,
  });
  seedConnector(db, "user-b", "conn-b", "Notion");
  seedTool(db, "user-b", {
    id: "tool-b",
    connectorId: "conn-b",
    name: "search_pages",
    agentName: "notion__search_pages",
  });
  app = createGatewayApp(db, { userId: "user-a", auth: "disabled", hmacKey: SLIP_KEY });
  server = Bun.serve({ port: 0, fetch: app.fetch });
});

afterAll(() => {
  server.stop(true);
});

beforeEach(() => {
  key = issueAgentKey(db, "user-a", "test agent").key;
  friendKey = issueAgentKey(db, "user-b", "friend").key;
});

describe("errand_call policy pipeline", () => {
  test("an admitted call returns not_forwarded, consumes its caps and is journaled", async () => {
    const { slipId, capability } = seedSlip();
    const client = await connect(key);
    try {
      const { result, body } = await call(client, slipId, capability, READ.name);
      expect(result.isError).toBeFalsy();
      expect(body).toMatchObject({
        state: "not_forwarded",
        slipId,
        tool: READ.name,
        reason: "forwarder_not_installed",
      });
      const status = z
        .object({ callsUsed: z.number(), spendUsedCents: z.number() })
        .parse((await callTool(client, "errand_status", { slip_id: slipId })).body);
      expect(status).toMatchObject({ callsUsed: 1, spendUsedCents: 0 });
      const last = listJournalEvents(db, "user-a").at(-1);
      expect(last?.eventType).toBe("call.allowed");
      const payload = z
        .object({ reason: z.string(), slip_id: z.string() })
        .parse(JSON.parse(last?.payload ?? "{}"));
      expect(payload).toMatchObject({ reason: "admitted", slip_id: slipId });
    } finally {
      await client.close();
    }
  });

  test("a call for another user's slip reports not_found and never leaks it", async () => {
    const { slipId, capability } = seedSlip();
    const other = await connect(friendKey);
    try {
      expectDenied(await call(other, slipId, capability, READ.name), "not_found", "user-b");
    } finally {
      await other.close();
    }
  });

  test("a missing or wrong capability is refused", async () => {
    const { slipId } = seedSlip();
    const other = seedSlip();
    const client = await connect(key);
    try {
      for (const capability of ["cap_not-a-token", other.capability]) {
        expectDenied(await call(client, slipId, capability, READ.name), "capability_invalid");
      }
    } finally {
      await client.close();
    }
  });

  test("the slip must be approved, unexpired and not denied or burned", async () => {
    const pending = seedSlip();
    db.update(slips).set({ state: "pending" }).where(eq(slips.id, pending.slipId)).run();
    const deniedSlip = seedSlip();
    db.update(slips).set({ state: "denied" }).where(eq(slips.id, deniedSlip.slipId)).run();
    const burned = seedSlip();
    db.update(slips).set({ state: "burned" }).where(eq(slips.id, burned.slipId)).run();
    const expired = seedSlip();
    const expiredCapability = expireSlip(expired.slipId);

    const client = await connect(key);
    try {
      expectDenied(await call(client, pending.slipId, pending.capability, READ.name), "not_approved");
      expectDenied(await call(client, deniedSlip.slipId, deniedSlip.capability, READ.name), "slip_denied");
      expectDenied(await call(client, burned.slipId, burned.capability, READ.name), "burned");
      expectDenied(await call(client, expired.slipId, expiredCapability, READ.name), "expired");
    } finally {
      await client.close();
    }
  });

  test("a tampered slip field fails its signature after the other checks pass", async () => {
    const { slipId, capability } = seedSlip();
    db.update(slips).set({ goal: "Transfer everything" }).where(eq(slips.id, slipId)).run();
    const client = await connect(key);
    try {
      expectDenied(await call(client, slipId, capability, READ.name), "signature_invalid");
    } finally {
      await client.close();
    }
  });

  test("a decoy is refused by name", async () => {
    const { slipId, capability } = seedSlip();
    const client = await connect(key);
    try {
      expectDenied(
        await call(client, slipId, capability, "calendar__export_all_contacts"),
        "decoy",
      );
    } finally {
      await client.close();
    }
  });

  test("a tool outside the slip is a journaled scope violation", async () => {
    const { slipId, capability } = seedSlip();
    const client = await connect(key);
    try {
      expectDenied(
        await call(client, slipId, capability, "calendar__delete_event"),
        "out_of_scope",
      );
      const last = listJournalEvents(db, "user-a").at(-1);
      expect(last?.eventType).toBe("call.scope_violation");
      expect(last?.payload).toContain(slipId);
      const status = z
        .object({ callsUsed: z.number() })
        .parse((await callTool(client, "errand_status", { slip_id: slipId })).body);
      expect(status).toMatchObject({ callsUsed: 0 });
    } finally {
      await client.close();
    }
  });

  test("a changed or removed tool and an unhealthy connector are refused", async () => {
    const changed = seedSlip();
    db.update(tools).set({ state: "changed" }).where(eq(tools.id, "tool-list")).run();
    const client = await connect(key);
    try {
      expectDenied(
        await call(client, changed.slipId, changed.capability, READ.name),
        "tool_unavailable",
      );
    } finally {
      await client.close();
    }

    db.update(tools).set({ state: "active" }).where(eq(tools.id, "tool-list")).run();
    const unhealthy = seedSlip();
    db.update(connectors)
      .set({ authStatus: "needs_reauth" })
      .where(eq(connectors.id, "conn-a"))
      .run();
    const second = await connect(key);
    try {
      expectDenied(
        await call(second, unhealthy.slipId, unhealthy.capability, READ.name),
        "connector_unhealthy",
      );
    } finally {
      await second.close();
      db.update(connectors).set({ authStatus: "active" }).where(eq(connectors.id, "conn-a")).run();
    }
  });

  test("an unknown class or a class changed after approval is refused", async () => {
    const unknown = seedSlip({ tools: [UNKNOWN] });
    const client = await connect(key);
    try {
      expectDenied(
        await call(client, unknown.slipId, unknown.capability, UNKNOWN.name),
        "unknown_class",
      );
    } finally {
      await client.close();
    }

    const mismatch = seedSlip();
    db.update(tools)
      .set({ class: "write" })
      .where(eq(tools.id, "tool-list"))
      .run();
    const second = await connect(key);
    try {
      expectDenied(
        await call(second, mismatch.slipId, mismatch.capability, READ.name),
        "class_mismatch",
      );
    } finally {
      await second.close();
      db.update(tools).set({ class: "read" }).where(eq(tools.id, "tool-list")).run();
    }
  });

  test("arguments are validated against the pinned input schema", async () => {
    const { slipId, capability } = seedSlip({ tools: [SEARCH] });
    const client = await connect(key);
    try {
      expectDenied(await call(client, slipId, capability, SEARCH.name, {}), "invalid_arguments");

      expectDenied(
        await call(client, slipId, capability, SEARCH.name, { query: "lunch", admin: true }),
        "invalid_arguments",
      );

      const ok = await call(client, slipId, capability, SEARCH.name, { query: "lunch" });
      expect(ok.result.isError).toBeFalsy();
    } finally {
      await client.close();
    }
  });

  test("a send without an allowlist is refused; a constrained send is limited to it", async () => {
    const bare = seedSlip({ tools: [SEND] });
    const client = await connect(key);
    try {
      const refused = await call(client, bare.slipId, bare.capability, SEND.name, {
        to: "alice@example.com",
      });
      expectDenied(refused, "missing_allowlist");
    } finally {
      await client.close();
    }

    const constrained = seedSlip({
      tools: [SEND],
      constraints: { [SEND.name]: { to: ["alice@example.com"], note: ["hello"] } },
    });
    const second = await connect(key);
    try {
      const wrong = await call(second, constrained.slipId, constrained.capability, SEND.name, {
        to: "mallory@example.com",
      });
      expectDenied(wrong, "constraint_denied");

      const omittedOptional = await call(
        second,
        constrained.slipId,
        constrained.capability,
        SEND.name,
        { to: "alice@example.com" },
      );
      expect(omittedOptional.result.isError).toBeFalsy();
      expect(omittedOptional.body).toMatchObject({ state: "not_forwarded" });
    } finally {
      await second.close();
    }
  });

  test("calls are capped and every excess attempt is refused and journaled", async () => {
    const { slipId, capability } = seedSlip({ callCap: 3 });
    const client = await connect(key);
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, () => call(client, slipId, capability, READ.name)),
      );
      const admitted = results.filter((result) => !result.result.isError);
      const refused = results.filter((result) => result.result.isError);
      expect(admitted).toHaveLength(3);
      expect(refused).toHaveLength(5);
      for (const result of refused) {
        expect(denial(result.body).error).toBe("call_cap_reached");
      }
      const status = z
        .object({ callsUsed: z.number() })
        .parse((await callTool(client, "errand_status", { slip_id: slipId })).body);
      expect(status).toMatchObject({ callsUsed: 3 });

      const events = listJournalEvents(db, "user-a").filter(
        (event) => z.object({ slip_id: z.string() }).parse(JSON.parse(event.payload)).slip_id === slipId,
      );
      expect(events.filter((event) => event.eventType === "call.allowed")).toHaveLength(3);
      const denialReasons = events
        .filter((event) => event.eventType === "call.denied")
        .map((event) => z.object({ reason: z.string() }).parse(JSON.parse(event.payload)).reason);
      expect(denialReasons.filter((reason) => reason === "call_cap_reached")).toHaveLength(5);
    } finally {
      await client.close();
    }
  });

  test("two processes cannot overshoot the call cap", async () => {
    const dir = mkdtempSync(join(tmpdir(), "errand-reserve-"));
    const databasePath = join(dir, "reserve.db");
    const slipId = "race-slip";
    try {
      const fileDb = createMigratedDatabase(databasePath);
      fileDb.insert(users).values({ id: "user-a", name: "A", createdAt: TS }).run();
      seedConnector(fileDb, "user-a", "conn-a", "Calendar");
      seedTool(fileDb, "user-a", {
        id: "tool-list",
        connectorId: "conn-a",
        name: "list_events",
        agentName: "calendar__list_events",
      });
      fileDb
        .insert(slips)
        .values({
          id: slipId,
          userId: "user-a",
          errandType: "race",
          goal: "race",
          state: "approved",
          tier: "learner",
          tools: JSON.stringify([READ]),
          constraints: "{}",
          callCap: 3,
          rateCap: 20,
          spendCapCents: 0,
          expiresAt: LATER,
          createdAt: TS,
          updatedAt: TS,
          approvedAt: TS,
        })
        .run();
      fileDb.$client.close();

      const worker = join(import.meta.dir, "..", "policy", "reserve-worker.ts");
      const runs = [0, 1].map(() =>
        Bun.spawn([process.execPath, worker, databasePath, slipId, "5"], {
          stdout: "pipe",
          stderr: "pipe",
        }),
      );
      const outputs = await Promise.all(
        runs.map(async (run) => {
          const text = await new Response(run.stdout).text();
          await run.exited;
          return text;
        }),
      );
      const results = outputs.flatMap((text) =>
        z.array(z.object({ ok: z.boolean() })).parse(JSON.parse(text)),
      );
      expect(results.filter((result) => result.ok)).toHaveLength(3);

      const check = createMigratedDatabase(databasePath);
      expect(getSlip(check, "user-a", slipId)?.callsUsed).toBe(3);
      check.$client.close();
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows can hold a just-closed SQLite file; the OS temp dir is the fallback home.
      }
    }
  });

  test("a spend call reserves its amount and cannot overshoot the spend cap", async () => {
    const { slipId, capability } = seedSlip({ tools: [SPEND], spendCapCents: 100 });
    const client = await connect(key);
    try {
      const first = await call(client, slipId, capability, SPEND.name, {
        [SPEND_AMOUNT_ARGUMENT]: 60,
      });
      expect(first.result.isError).toBeFalsy();
      const second = await call(client, slipId, capability, SPEND.name, {
        [SPEND_AMOUNT_ARGUMENT]: 60,
      });
      expectDenied(second, "spend_cap_exceeded");
      const status = z
        .object({ spendUsedCents: z.number() })
        .parse((await callTool(client, "errand_status", { slip_id: slipId })).body);
      expect(status).toMatchObject({ spendUsedCents: 60 });
    } finally {
      await client.close();
    }
  });

  test("a spend call without a readable amount is refused", async () => {
    const { slipId, capability } = seedSlip({ tools: [SPEND] });
    db.update(tools).set({ inputSchema: "{}" }).where(eq(tools.id, "tool-pay")).run();
    const client = await connect(key);
    try {
      expectDenied(await call(client, slipId, capability, SPEND.name, {}), "invalid_spend_amount");
    } finally {
      await client.close();
      db.update(tools).set({ inputSchema: paySchema }).where(eq(tools.id, "tool-pay")).run();
    }
  });

  test("the call rate is capped inside the same transaction", async () => {
    const { slipId, capability } = seedSlip({ rateCap: 2, callCap: 10 });
    const client = await connect(key);
    try {
      const first = await call(client, slipId, capability, READ.name);
      const second = await call(client, slipId, capability, READ.name);
      const third = await call(client, slipId, capability, READ.name);
      expect(first.result.isError).toBeFalsy();
      expect(second.result.isError).toBeFalsy();
      expectDenied(third, "rate_limited");
    } finally {
      await client.close();
    }
  });
});
