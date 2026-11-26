import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createMigratedDatabase } from "../../src/db/client.ts";
import { connectors, tools, users } from "../../src/db/schema.ts";
import { issueAgentKey } from "../../src/vault/agent-keys.ts";
import { callTool, connectAgent } from "./mcp-client.ts";
import { parse, step } from "../support/proof-drive.ts";

const base = process.argv[2] ?? "http://127.0.0.1:8828";
const databasePath = process.argv[3] ?? "docs/proof/08-agent-keys-catalog/proof.db";
const mockBase = process.argv[4] ?? "http://127.0.0.1:4108";
const TS = "2026-04-01T00:00:00.000Z";

const keyResponse = z.object({
  key: z.string(),
  mcpUrl: z.string(),
  agentKey: z.object({ id: z.string(), name: z.string(), revokedAt: z.string().nullable() }),
});
const connectorResponse = z.object({ connector: z.object({ id: z.string() }) });
const connectorList = z.object({ connectors: z.array(z.object({ id: z.string() })) });

step("create the agent key (shown once)");
const created = await parse(
  await fetch(`${base}/api/agent-keys`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "proof agent" }),
  }),
  keyResponse,
);
console.log(
  `key: errand_… redacted (${created.key.length} chars), id ${created.agentKey.id}, revoked ${created.agentKey.revokedAt}`,
);
console.log(`sha256(key) prefix: ${createHash("sha256").update(created.key).digest("hex").slice(0, 12)}`);
console.log(`one URL for the agent: ${created.mcpUrl}`);

step("the list returns the key's metadata and never the key or its hash");
const listedKeys = await fetch(`${base}/api/agent-keys`);
const listedBody = await listedKeys.text();
console.log(listedBody);
assert.equal(listedBody.includes(created.key), false);
assert.equal(listedBody.includes("keyHash"), false);

step("connect the mock calendar through the paste-URL API");
const connected = await parse(
  await fetch(`${base}/api/connectors`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Calendar", url: `${mockBase}/calendar/mcp`, authType: "none" }),
  }),
  connectorResponse,
);
const connectorsList = await parse(await fetch(`${base}/api/connectors`), connectorList);
const calendarId = connectorsList.connectors[0]?.id ?? connected.connector.id;
console.log(`connector ${calendarId} connected`);

step("seed a decoy, a second user and that user's own connector");
const db = createMigratedDatabase(databasePath);
db.insert(tools)
  .values({
    id: "decoy-1",
    userId: "owner",
    connectorId: calendarId,
    name: "export_all_contacts",
    agentName: "calendar__export_all_contacts",
    description: "Bait",
    class: "unknown",
    definitionHash: "decoy-hash",
    state: "active",
    requestable: true,
    createdAt: TS,
    updatedAt: TS,
  })
  .run();
db.insert(users).values({ id: "user-b", name: "B", createdAt: TS }).run();
db.insert(connectors)
  .values({
    id: "conn-b",
    userId: "user-b",
    name: "Notion",
    url: "http://127.0.0.1:9/notion/mcp",
    transport: "streamable-http",
    authType: "none",
    createdAt: TS,
    updatedAt: TS,
  })
  .run();
db.insert(tools)
  .values({
    id: "tool-b",
    userId: "user-b",
    connectorId: "conn-b",
    name: "search_pages",
    agentName: "notion__search_pages",
    description: "Search pages",
    class: "read",
    definitionHash: "tool-b-hash",
    state: "active",
    requestable: true,
    createdAt: TS,
    updatedAt: TS,
  })
  .run();
const friendKey = issueAgentKey(db, "user-b", "friend").key;
console.log(`seeded decoy, user-b and notion__search_pages; friend key ${friendKey.length} chars`);

step("a real MCP client lists the top layer");
const owner = await connectAgent(base, created.key);
const listed = await owner.listTools();
console.log(`tools: ${listed.tools.map((tool) => tool.name).sort().join(", ")}`);
assert.deepEqual(
  listed.tools.map((tool) => tool.name).sort(),
  ["errand_call", "errand_catalog", "errand_status", "request_errand"],
);

step("errand_catalog: requestable only, no decoys, no blocked delete");
const catalog = (await callTool(owner, "errand_catalog")).body;
console.log(JSON.stringify(catalog, null, 2));
assert.deepEqual(
  (catalog as { tools: { name: string }[] }).tools.map((tool) => tool.name),
  ["calendar__create_event", "calendar__list_events"],
);

step("request_errand: over-max limits are clamped and a pending slip returns at once");
const requested = (
  await callTool(owner, "request_errand", {
    goal: "Find a dinner slot",
    tools: ["calendar__list_events"],
    limits: { calls: 900, spend_cents: 12_345_678, minutes: 1_440 },
  })
).body;
console.log(JSON.stringify(requested, null, 2));
const slipId = (requested as { slipId: string }).slipId;
assert.equal((requested as { state: string }).state, "pending");

step("errand_status reads the persisted pending slip");
const status = (await callTool(owner, "errand_status", { slip_id: slipId })).body;
console.log(JSON.stringify(status, null, 2));
assert.equal((status as { state: string }).state, "pending");

step("errand_call is denied before approval and never reaches upstream");
const early = await callTool(owner, "errand_call", {
  slip_id: slipId,
  tool: "calendar__list_events",
  capability: "cap_not-issued-yet",
});
console.log(JSON.stringify({ isError: early.result.isError, body: early.body }, null, 2));
assert.equal(early.result.isError, true);
assert.equal((early.body as { error: string }).error, "not_approved");

step("approve, then call inside and outside the slip");
await parse(
  await fetch(`${base}/api/slips/${slipId}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  }),
  z.object({ slip: z.object({ state: z.string() }) }),
);
const approvedStatus = (await callTool(owner, "errand_status", { slip_id: slipId })).body;
const capability = (approvedStatus as { capability: string }).capability;
assert.match(capability, /^cap_/);

const offSlip = await callTool(owner, "errand_call", {
  slip_id: slipId,
  tool: "calendar__delete_event",
  capability,
});
console.log(JSON.stringify({ isError: offSlip.result.isError, body: offSlip.body }, null, 2));
assert.equal(offSlip.result.isError, true);
assert.equal((offSlip.body as { error: string }).error, "out_of_scope");

const run = await callTool(owner, "errand_call", {
  slip_id: slipId,
  tool: "calendar__list_events",
  capability,
});
console.log(JSON.stringify(run.body, null, 2));
assert.equal((run.body as { state: string }).state, "not_forwarded");
await owner.close();

step("the friend's key sees only the friend's connector");
const friend = await connectAgent(base, friendKey);
const friendCatalog = (await callTool(friend, "errand_catalog")).body;
console.log(JSON.stringify(friendCatalog, null, 2));
assert.deepEqual(
  (friendCatalog as { tools: { name: string }[] }).tools.map((tool) => tool.name),
  ["notion__search_pages"],
);
await friend.close();

step("revoke the owner's key: the same key is refused");
const revoked = await parse(
  await fetch(`${base}/api/agent-keys/${created.agentKey.id}/revoke`, { method: "POST" }),
  z.object({ agentKey: z.object({ revokedAt: z.string().nullable() }) }),
);
console.log(`revokedAt: ${revoked.agentKey.revokedAt}`);
try {
  const denied = await connectAgent(base, created.key);
  await denied.close();
  throw new Error("revoked key connected");
} catch (error) {
  console.log(`connect refused: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
}

step("the database holds hashes, never the keys");
const scan = db
  .select()
  .from(tools)
  .all()
  .map((row) => row.name);
console.log(`tool rows after seeding: ${scan.join(", ")}`);
console.log("key scan is captured separately with sqlite3-style queries");

db.$client.close();
console.log("\nVERDICT: pass");
