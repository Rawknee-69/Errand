import { beforeEach, describe, expect, test } from "bun:test";
import { createGatewayApp } from "../../src/app.ts";
import type { Db } from "../../src/db/client.ts";
import { listJournalEvents } from "../../src/db/journal.ts";
import { userDb } from "./support.ts";

let db: Db;
let app: ReturnType<typeof createGatewayApp>;

beforeEach(() => {
  db = userDb();
  app = createGatewayApp(db, { userId: "user-a" });
});

async function create(name = "laptop"): Promise<Response> {
  return app.request("/api/agent-keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

describe("agent key API", () => {
  test("a new key is returned once and never in the list", async () => {
    const response = await create();
    expect(response.status).toBe(201);
    const created = (await response.json()) as {
      key: string;
      mcpUrl: string;
      agentKey: { id: string; name: string; createdAt: string; revokedAt: string | null };
    };

    expect(created.key).toMatch(/^errand_[A-Za-z0-9_-]{43}$/);
    expect(created.mcpUrl).toMatch(/\/mcp$/);
    expect(created.agentKey).toMatchObject({ name: "laptop", revokedAt: null });

    const listed = (await (await app.request("/api/agent-keys")).json()) as {
      agentKeys: { id: string }[];
    };
    expect(listed.agentKeys).toHaveLength(1);
    const serialised = JSON.stringify(listed);
    expect(serialised).not.toContain(created.key);
    expect(serialised).not.toContain("keyHash");
  });

  test("revoking is scoped, idempotent and journaled without the key", async () => {
    const created = (await (await create()).json()) as { key: string; agentKey: { id: string } };
    const revoke = (id: string) => app.request(`/api/agent-keys/${id}/revoke`, { method: "POST" });

    const first = await revoke(created.agentKey.id);
    expect(first.status).toBe(200);
    const revokedAt = ((await first.json()) as { agentKey: { revokedAt: string } }).agentKey.revokedAt;
    expect(revokedAt).not.toBeNull();

    const second = await revoke(created.agentKey.id);
    expect(
      ((await second.json()) as { agentKey: { revokedAt: string } }).agentKey.revokedAt,
    ).toBe(revokedAt);

    expect((await revoke("not-a-key")).status).toBe(404);

    const events = listJournalEvents(db, "user-a");
    expect(events.map((event) => event.eventType)).toEqual([
      "agent_key.created",
      "agent_key.revoked",
    ]);
    expect(JSON.stringify(events)).not.toContain(created.key);
  });

  test("a blank key name is rejected", async () => {
    expect((await create("   ")).status).toBe(400);
  });
});
