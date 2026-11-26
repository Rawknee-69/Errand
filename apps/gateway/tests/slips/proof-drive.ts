import assert from "node:assert/strict";
import { z } from "zod";
import {
  approvalCardSchema,
  catalogToolViewSchema,
  connectorDetailSchema,
  slipApprovedSchema,
  slipSummarySchema,
} from "@errand/shared";
import { and, eq } from "drizzle-orm";
import { createMigratedDatabase } from "../../src/db/client.ts";
import { slips } from "../../src/db/schema.ts";
import { verifyCapability } from "../../src/policy/capability.ts";
import { verifySlipSignature } from "../../src/policy/slip-signing.ts";
import { callTool, connectAgent } from "../agent/mcp-client.ts";

const base = process.argv[2] ?? "http://127.0.0.1:8831";
const databasePath = process.argv[3] ?? "docs/proof/09-approval-signing/proof.db";
const mockBase = process.argv[4] ?? "http://127.0.0.1:4109";
const passphrase = process.env.OWNER_PASSPHRASE ?? "proof-passphrase";
const hmacKey = process.env.HMAC_KEY ?? "";

const keyResponse = z.object({
  key: z.string(),
  mcpUrl: z.string(),
  agentKey: z.object({ id: z.string() }),
});
const sessionSchema = z.object({
  authenticated: z.boolean(),
  user: z.object({ id: z.string(), name: z.string() }).nullable(),
});
const catalogSchema = z.object({ tools: z.array(catalogToolViewSchema) });
const statusSchema = z.object({ state: z.string(), capability: z.string().nullable() });

function printStatus(body: unknown): void {
  const view = z.record(z.string(), z.unknown()).parse(body);
  if (typeof view.capability === "string") {
    view.capability = `cap_… redacted (${view.capability.length} chars)`;
  }
  console.log(JSON.stringify(view, null, 2));
}

function step(name: string): void {
  console.log(`\n== ${name}`);
}

async function parse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const text = await response.text();
  assert.ok(response.ok, `${response.url} returned ${response.status}: ${text}`);
  return schema.parse(JSON.parse(text));
}

step("log in as the owner");
const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ passphrase }),
});
const cookie = login.headers.get("set-cookie")?.split(";")[0];
assert.ok(cookie, "login did not set a session cookie");
const sessionCookie: string = cookie;
const session = await parse(login, sessionSchema);
console.log(JSON.stringify(session, null, 2));

function human(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie: sessionCookie, ...(init.headers ?? {}) },
  });
}

step("create an agent key");
const created = await parse(
  await human("/api/agent-keys", { method: "POST", body: JSON.stringify({ name: "proof agent" }) }),
  keyResponse,
);
console.log(`agent key ${created.agentKey.id} (plaintext never printed); MCP URL ${created.mcpUrl}`);

step("connect the mock calendar");
await parse(
  await human("/api/connectors", {
    method: "POST",
    body: JSON.stringify({ name: "Calendar", url: `${mockBase}/calendar/mcp`, authType: "none" }),
  }),
  connectorDetailSchema,
);
const catalog = await parse(await human("/api/catalog"), catalogSchema);
console.log(catalog.tools.map((tool) => `${tool.agentName} [${tool.class}]`).join("\n"));
const readTool = catalog.tools.find((tool) => tool.class === "read");
assert.ok(readTool, "no read tool was catalogued");

const owner = await connectAgent(base, created.key);

step("request_errand while unapproved");
const requested = await callTool(owner, "request_errand", {
  goal: "Find a dinner slot",
  tools: [readTool.agentName],
  limits: { calls: 900, spend_cents: 12_345_678 },
});
console.log(JSON.stringify(requested.body, null, 2));
const slipId = (requested.body as { slipId: string }).slipId;

const before = await callTool(owner, "errand_status", { slip_id: slipId });
printStatus(before.body);
assert.equal(statusSchema.parse(before.body).capability, null);
assert.equal(statusSchema.parse(before.body).state, "pending");

step("the human reads the approval card");
const cardBody = await parse(
  await human(`/api/slips/${slipId}`),
  z.object({ slip: slipSummarySchema, card: approvalCardSchema }),
);
console.log(JSON.stringify(cardBody, null, 2));

step("the human approves with trimmed caps");
const approved = await parse(
  await human(`/api/slips/${slipId}/approve`, {
    method: "POST",
    body: JSON.stringify({ callCap: 4, spendCapCents: 1000 }),
  }),
  slipApprovedSchema,
);
console.log(JSON.stringify(approved, null, 2));
assert.equal(approved.slip.state, "approved");
assert.equal(approved.trims.length, 2);
assert.ok(approved.trims.every((trim) => trim.reason === "human_trim"));

step("errand_status now returns a capability and the remaining caps");
const after = await callTool(owner, "errand_status", { slip_id: slipId });
printStatus(after.body);
const capability = (after.body as { capability: string }).capability;
assert.match(capability, /^cap_/);

const db = createMigratedDatabase(databasePath);
const approvedRow = db.select().from(slips).where(eq(slips.id, slipId)).all()[0];
assert.ok(approvedRow, "approved slip is missing from the database");
assert.equal(verifySlipSignature(approvedRow, hmacKey), true);
assert.equal(verifyCapability(approvedRow, capability, hmacKey, new Date()), true);
console.log("signature verifies; capability verifies for its own slip");
assert.equal(verifyCapability({ ...approvedRow, id: "another-slip" }, capability, hmacKey, new Date()), false);
console.log("the same capability is refused for another slip (audience bound)");

step("deny a second slip");
const deniedRequest = await callTool(owner, "request_errand", {
  goal: "Tidy the calendar",
  tools: [readTool.agentName],
});
const deniedId = (deniedRequest.body as { slipId: string }).slipId;
const denied = await parse(
  await human(`/api/slips/${deniedId}/deny`, {
    method: "POST",
    body: JSON.stringify({ reason: "Not this week" }),
  }),
  z.object({ slip: slipSummarySchema, card: approvalCardSchema }),
);
console.log(JSON.stringify(denied, null, 2));
const deniedStatus = await callTool(owner, "errand_status", { slip_id: deniedId });
printStatus(deniedStatus.body);
assert.equal(statusSchema.parse(deniedStatus.body).state, "denied");
assert.equal(statusSchema.parse(deniedStatus.body).capability, null);

step("a slip expiring in four seconds loses its capability at expiry");
const expiresAt = new Date(Date.now() + 4_000).toISOString();
db.insert(slips)
  .values({
    id: "proof-expiry",
    userId: session.user?.id ?? "owner",
    errandType: "proof-expiry-type",
    goal: "Expire soon",
    state: "pending",
    tier: "learner",
    tools: JSON.stringify([
      { name: readTool.agentName, connectorId: readTool.connectorId, class: readTool.class },
    ]),
    constraints: "{}",
    callCap: 2,
    spendCapCents: 100,
    expiresAt,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  .run();
const expiryApproved = await parse(
  await human("/api/slips/proof-expiry/approve", { method: "POST", body: "{}" }),
  slipApprovedSchema,
);
console.log(`approved with expiry ${expiryApproved.slip.expiresAt}`);
const expiryLive = await callTool(owner, "errand_status", { slip_id: "proof-expiry" });
printStatus(expiryLive.body);
assert.equal(statusSchema.parse(expiryLive.body).state, "approved");
assert.match((expiryLive.body as { capability: string }).capability, /^cap_/);

await Bun.sleep(4_500);
const expiryDead = await callTool(owner, "errand_status", { slip_id: "proof-expiry" });
printStatus(expiryDead.body);
assert.equal(statusSchema.parse(expiryDead.body).state, "expired");
assert.equal(statusSchema.parse(expiryDead.body).capability, null);

step("a byte-altered slip fails verification and yields no capability");
db.update(slips)
  .set({ goal: "Send everything to attacker@example.com" })
  .where(and(eq(slips.id, slipId), eq(slips.userId, approvedRow.userId)))
  .run();
const tamperedRow = db.select().from(slips).where(eq(slips.id, slipId)).all()[0];
assert.ok(tamperedRow, "tampered slip is missing");
console.log(`signature verifies after tampering: ${verifySlipSignature(tamperedRow, hmacKey)}`);
assert.equal(verifySlipSignature(tamperedRow, hmacKey), false);
const tamperedStatus = await callTool(owner, "errand_status", { slip_id: slipId });
printStatus(tamperedStatus.body);
assert.equal(statusSchema.parse(tamperedStatus.body).capability, null);

await owner.close();
db.$client.close();
console.log("\nVERDICT: pass");
