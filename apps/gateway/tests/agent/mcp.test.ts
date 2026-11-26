import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport, type CallToolResult } from "@modelcontextprotocol/client";
import { createGatewayApp } from "../../src/app.ts";
import type { Db } from "../../src/db/client.ts";
import { issueAgentKey } from "../../src/vault/agent-keys.ts";
import { seedConnector, seedTool, userDb } from "./support.ts";

const AGENT_TOOLS = ["errand_call", "errand_catalog", "errand_status", "request_errand"];

let db: Db;
let server: ReturnType<typeof Bun.serve>;
let key: string;
let keyId: string;

type ToolCall = { name: string; arguments?: Record<string, unknown> };

async function connect(agentKey: string): Promise<Client> {
  const client = new Client({ name: "proof-agent", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${agentKey}` } },
  });
  await client.connect(transport, { timeout: 5_000 });
  return client;
}

async function call(client: Client, call: ToolCall): Promise<{ result: CallToolResult; body: unknown }> {
  const result = await client.callTool({ name: call.name, arguments: call.arguments ?? {} }, { timeout: 5_000 });
  const block = result.content[0];
  if (block?.type !== "text") throw new Error(`No text content from ${call.name}`);
  return { result, body: JSON.parse(block.text) };
}

async function createKey(): Promise<{ key: string; id: string }> {
  const response = await app.request("/api/agent-keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "test agent" }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { key: string; agentKey: { id: string } };
  return { key: body.key, id: body.agentKey.id };
}

let app: ReturnType<typeof createGatewayApp>;

beforeAll(() => {
  db = userDb(["user-a", "user-b"]);
  seedConnector(db, "user-a", "conn-a", "Calendar");
  seedTool(db, "user-a", {
    id: "tool-a",
    connectorId: "conn-a",
    name: "list_events",
    agentName: "calendar__list_events",
    description: "List calendar events",
  });
  seedTool(db, "user-a", {
    id: "tool-a2",
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
  app = createGatewayApp(db, { userId: "user-a" });
  server = Bun.serve({ port: 0, fetch: app.fetch });
});

afterAll(() => {
  server.stop(true);
});

beforeEach(async () => {
  const issued = await createKey();
  key = issued.key;
  keyId = issued.id;
});

describe("agent MCP endpoint", () => {
  test("a real MCP client with a bearer agent key sees exactly four tools", async () => {
    const client = await connect(key);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual(AGENT_TOOLS);
    } finally {
      await client.close();
    }
  });

  test("errand_catalog lists requestable tools only and never another user's connectors", async () => {
    const client = await connect(key);
    try {
      const { body } = await call(client, { name: "errand_catalog" });
      expect(body).toMatchObject({
        tools: [
          {
            name: "calendar__list_events",
            label: "Calendar: list events",
            description: "List calendar events",
            class: "read",
            connector: "Calendar",
          },
        ],
      });
    } finally {
      await client.close();
    }

    const otherKey = issueAgentKey(db, "user-b", "friend").key;
    const otherClient = await connect(otherKey);
    try {
      const { body } = await call(otherClient, { name: "errand_catalog" });
      expect(body).toMatchObject({ tools: [{ name: "notion__search_pages" }] });
    } finally {
      await otherClient.close();
    }
  });

  test("request_errand persists a pending slip, clamps caps and returns before approval", async () => {
    const client = await connect(key);
    try {
      const requested = await call(client, {
        name: "request_errand",
        arguments: {
          goal: "Find a dinner slot",
          tools: ["calendar__list_events"],
          limits: { calls: 900, spend_cents: 12_345_678 },
        },
      });

      expect(requested.result.isError).toBeFalsy();
      expect(requested.body).toMatchObject({
        state: "pending",
        tier: "learner",
        callCap: 50,
        spendCapCents: 20_000,
        clamped: [
          { field: "calls", requested: 900, applied: 50, reason: "server_maximum" },
          {
            field: "spend_cents",
            requested: 12_345_678,
            applied: 20_000,
            reason: "server_maximum",
          },
        ],
      });

      const slipId = (requested.body as { slipId: string }).slipId;
      const status = await call(client, { name: "errand_status", arguments: { slip_id: slipId } });
      expect(status.body).toMatchObject({ slipId, state: "pending", callsUsed: 0, spendUsedCents: 0 });

      const run = await call(client, {
        name: "errand_call",
        arguments: { slip_id: slipId, tool: "calendar__list_events", arguments: {} },
      });
      expect(run.body).toMatchObject({ state: "not_forwarded", slipId });
    } finally {
      await client.close();
    }
  });

  test("request_errand refuses a decoy and a non-requestable tool", async () => {
    const client = await connect(key);
    try {
      for (const tool of ["calendar__export_all_contacts", "calendar__delete_event"]) {
        const { result, body } = await call(client, {
          name: "request_errand",
          arguments: { goal: "x", tools: [tool] },
        });
        expect(result.isError).toBe(true);
        expect(body).toMatchObject({ tool });
      }
    } finally {
      await client.close();
    }
  });

  test("a revoked key is denied and a key cannot be guessed", async () => {
    const revoked = await app.request(`/api/agent-keys/${keyId}/revoke`, { method: "POST" });
    expect(revoked.status).toBe(200);

    await expect(connect(key)).rejects.toThrow();
    await expect(connect(`${key.slice(0, -1)}A`)).rejects.toThrow();
  });
});
