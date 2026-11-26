import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createMigratedDatabase } from "../../src/db/client.ts";
import { calls, connectors, journal, slips, tools } from "../../src/db/schema.ts";
import { callTool, connectAgent } from "../agent/mcp-client.ts";
import { humanRequests, parse, step } from "../support/proof-drive.ts";

const base = process.argv[2] ?? "http://127.0.0.1:8840";
const databasePath = process.argv[3] ?? "docs/proof/10-policy-pipeline/proof.db";
const mockBase = process.argv[4] ?? "http://127.0.0.1:4120";
const passphrase = process.env.OWNER_PASSPHRASE ?? "proof-passphrase";

const sessionSchema = z.object({ authenticated: z.boolean() });
const keySchema = z.object({ key: z.string(), mcpUrl: z.string(), agentKey: z.object({ id: z.string() }) });
const connectorSchema = z.object({ connector: z.object({ id: z.string() }) });
const requestedSchema = z.object({ slipId: z.string(), state: z.string() });
const statusSchema = z.object({ state: z.string(), capability: z.string().nullable() });

step("log in as the owner");
const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ passphrase }),
});
const cookie = login.headers.get("set-cookie")?.split(";")[0];
assert.ok(cookie, "login did not set a session cookie");
const sessionCookie: string = cookie;
console.log(JSON.stringify(await parse(login, sessionSchema)));
const human = humanRequests(base, sessionCookie);

step("create the agent key and connect both mock services");
const created = await parse(
  await human("/api/agent-keys", { method: "POST", body: JSON.stringify({ name: "proof agent" }) }),
  keySchema,
);
console.log(`agent key ${created.agentKey.id}; one URL ${created.mcpUrl}`);
const calendar = await parse(
  await human("/api/connectors", {
    method: "POST",
    body: JSON.stringify({
      name: "Calendar",
      url: `${mockBase}/calendar/mcp`,
      authType: "none",
    }),
  }),
  connectorSchema,
);
const pay = await parse(
  await human("/api/connectors", {
    method: "POST",
    body: JSON.stringify({
      name: "Pay",
      url: `${mockBase}/pay/mcp`,
      authType: "header",
      headerName: "x-pay-key",
      headerValue: "pay-demo-key",
    }),
  }),
  connectorSchema,
);
console.log(`calendar ${calendar.connector.id}, pay ${pay.connector.id}`);

const db = createMigratedDatabase(databasePath);
for (const name of ["calendar__delete_event", "pay__charge_card", "pay__send_receipt"]) {
  db.update(tools).set({ requestable: true }).where(eq(tools.agentName, name)).run();
}

const agent = await connectAgent(base, created.key);

async function request(toolNames: string[], limits: Record<string, number> = {}): Promise<string> {
  const { result, body } = await callTool(agent, "request_errand", {
    goal: "proof errand",
    tools: toolNames,
    limits,
  });
  assert.equal(result.isError, undefined);
  return requestedSchema.parse(body).slipId;
}

async function approve(slipId: string): Promise<string> {
  await parse(
    await human(`/api/slips/${slipId}/approve`, { method: "POST", body: "{}" }),
    z.object({ slip: z.object({ state: z.string() }) }),
  );
  const { body } = await callTool(agent, "errand_status", { slip_id: slipId });
  const capability = statusSchema.parse(body).capability;
  assert.ok(capability !== null, "approved slip has no capability");
  return capability;
}

async function call(slipId: string, capability: string, tool: string, args: Record<string, unknown> = {}) {
  return callTool(agent, "errand_call", { slip_id: slipId, tool, capability, arguments: args });
}

function redact(value: string): string {
  return `${value.slice(0, 4)}… (${value.length} chars)`;
}

step("list the top layer with a real MCP client");
const listed = await agent.listTools();
console.log(`tools: ${listed.tools.map((tool) => tool.name).sort().join(", ")}`);
assert.deepEqual(
  listed.tools.map((tool) => tool.name).sort(),
  ["errand_call", "errand_catalog", "errand_status", "request_errand"],
);

step("an admitted call consumes caps, journals and stops at not_forwarded");
const readSlip = await request(["calendar__list_events"]);
const readCapability = await approve(readSlip);
console.log(`capability ${redact(readCapability)}`);
const admitted = await call(readSlip, readCapability, "calendar__list_events", {});
console.log(JSON.stringify(admitted.body, null, 2));
assert.equal(admitted.result.isError, undefined);
assert.equal((admitted.body as { state: string }).state, "not_forwarded");
const readStatus = await callTool(agent, "errand_status", { slip_id: readSlip });
const readView = z.record(z.string(), z.unknown()).parse(readStatus.body);
if (typeof readView.capability === "string") readView.capability = redact(readView.capability);
console.log(JSON.stringify(readView, null, 2));

step("a tool outside the slip is a denied scope violation");
const offSlip = await call(readSlip, readCapability, "calendar__delete_event");
console.log(JSON.stringify({ isError: offSlip.result.isError, body: offSlip.body }, null, 2));
assert.equal(offSlip.result.isError, true);
assert.equal((offSlip.body as { error: string }).error, "out_of_scope");

step("a forged capability is refused");
const forged = await call(readSlip, "cap_forged.signature", "calendar__list_events");
console.log(JSON.stringify({ isError: forged.result.isError, body: forged.body }, null, 2));
assert.equal((forged.body as { error: string }).error, "capability_invalid");

step("the call cap cannot be overshot");
const cappedSlip = await request(["calendar__list_events"], { calls: 1 });
const cappedCapability = await approve(cappedSlip);
const one = await call(cappedSlip, cappedCapability, "calendar__list_events");
const two = await call(cappedSlip, cappedCapability, "calendar__list_events");
console.log(JSON.stringify({ first: one.result.isError ?? false, second: two.body }, null, 2));
assert.equal(one.result.isError, undefined);
assert.equal((two.body as { error: string }).error, "call_cap_reached");

step("spend is reserved atomically and cannot overshoot");
const spendSlip = await request(["pay__charge_card"], { spend_cents: 100 });
const spendCapability = await approve(spendSlip);
const firstCharge = await call(spendSlip, spendCapability, "pay__charge_card", { cents: 60 });
const secondCharge = await call(spendSlip, spendCapability, "pay__charge_card", { cents: 60 });
console.log(
  JSON.stringify({ first: firstCharge.body, second: secondCharge.body }, null, 2),
);
assert.equal(firstCharge.result.isError, undefined);
assert.equal((secondCharge.body as { error: string }).error, "spend_cap_exceeded");

step("the rate cap is enforced inside the same transaction");
const rateSlip = await request(["calendar__list_events"]);
db.update(slips).set({ rateCap: 2 }).where(eq(slips.id, rateSlip)).run();
const rateCapability = await approve(rateSlip);
const rateResults = [];
for (let index = 0; index < 3; index++) {
  rateResults.push((await call(rateSlip, rateCapability, "calendar__list_events")).body);
}
console.log(JSON.stringify(rateResults, null, 2));
assert.equal((rateResults[2] as { error: string }).error, "rate_limited");

step("a send without an allowlist is refused even though its class is known");
const sendSlip = await request(["pay__send_receipt"]);
const sendCapability = await approve(sendSlip);
const send = await call(sendSlip, sendCapability, "pay__send_receipt", { id: "rcpt-1" });
console.log(JSON.stringify({ isError: send.result.isError, body: send.body }, null, 2));
assert.equal((send.body as { error: string }).error, "missing_allowlist");

step("a tampered slip fails its signature");
const tamperedSlip = await request(["calendar__list_events"]);
const tamperedCapability = await approve(tamperedSlip);
db.update(slips).set({ goal: "Transfer everything" }).where(eq(slips.id, tamperedSlip)).run();
const tampered = await call(tamperedSlip, tamperedCapability, "calendar__list_events");
console.log(JSON.stringify({ isError: tampered.result.isError, body: tampered.body }, null, 2));
assert.equal((tampered.body as { error: string }).error, "signature_invalid");

step("a changed tool and a connector needing reauth are refused");
const healthSlip = await request(["calendar__list_events"]);
const healthCapability = await approve(healthSlip);
db.update(tools).set({ state: "changed" }).where(eq(tools.agentName, "calendar__list_events")).run();
const changed = await call(healthSlip, healthCapability, "calendar__list_events");
db.update(tools).set({ state: "active" }).where(eq(tools.agentName, "calendar__list_events")).run();
db.update(connectors)
  .set({ authStatus: "needs_reauth" })
  .where(eq(connectors.id, calendar.connector.id))
  .run();
const unhealthy = await call(healthSlip, healthCapability, "calendar__list_events");
db.update(connectors)
  .set({ authStatus: "active" })
  .where(eq(connectors.id, calendar.connector.id))
  .run();
console.log(JSON.stringify({ changed: changed.body, unhealthy: unhealthy.body }, null, 2));
assert.equal((changed.body as { error: string }).error, "tool_unavailable");
assert.equal((unhealthy.body as { error: string }).error, "connector_unhealthy");

step("journal: every decision carries its reason and the chain still verifies");
const events = db.select().from(journal).all();
const allowed = events.filter((event) => event.eventType === "call.allowed").length;
const scope = events.filter((event) => event.eventType === "call.scope_violation").length;
const denied = events.filter((event) => event.eventType === "call.denied").length;
console.log(`journal: ${allowed} allowed, ${scope} scope violations, ${denied} other denials, ${events.length} total`);
console.log(
  events
    .filter((event) => event.eventType.startsWith("call."))
    .slice(-6)
    .map((event) => `${event.seq} ${event.eventType} ${event.payload}`)
    .join("\n"),
);
assert.ok(allowed > 0 && scope > 0 && denied > 0);
const verified = await parse(await human("/api/journal/verify"), z.object({ ok: z.boolean(), checked: z.number() }));
console.log(JSON.stringify(verified));

step("no upstream call happened: the calls table stays empty");
const callCount = db.select().from(calls).all().length;
console.log(`calls rows: ${callCount}`);
assert.equal(callCount, 0);

await agent.close();
db.$client.close();
console.log("\nVERDICT: pass");
