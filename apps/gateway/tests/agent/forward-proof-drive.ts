import assert from "node:assert/strict";
import { MOCK_AUTH, MOCK_PATHS } from "@errand/mock-services";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createMigratedDatabase } from "../../src/db/client.ts";
import { calls, journal, tools } from "../../src/db/schema.ts";
import { callTool, connectAgent } from "./mcp-client.ts";
import {
  bytes,
  call as callAgent,
  errorSchema,
  forwardedSchema,
  requestedSchema,
  statusSchema,
} from "./forward-support.ts";
import { humanRequests, parse, step } from "../support/proof-drive.ts";

const base = process.argv[2] ?? "http://127.0.0.1:8841";
const databasePath = process.argv[3] ?? "docs/proof/11-forwarder/proof.db";
const mockBase = process.argv[4] ?? "http://127.0.0.1:4121";
const passphrase = process.env.OWNER_PASSPHRASE ?? "proof-passphrase";

const sessionSchema = z.object({ authenticated: z.boolean() });
const keySchema = z.object({ key: z.string(), mcpUrl: z.string(), agentKey: z.object({ id: z.string() }) });
const connectorSchema = z.object({ connector: z.object({ id: z.string() }) });

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

step("create the agent key and connect secure mock services through the paste-URL API");
const created = await parse(
  await human("/api/agent-keys", { method: "POST", body: JSON.stringify({ name: "forward agent" }) }),
  keySchema,
);
console.log(`agent key ${created.agentKey.id}; one URL ${created.mcpUrl}`);
const calendar = await parse(
  await human("/api/connectors", {
    method: "POST",
    body: JSON.stringify({
      name: "Calendar",
      url: `${mockBase}${MOCK_PATHS.calendarSecure}`,
      authType: "bearer",
      token: MOCK_AUTH.calendarBearer,
    }),
  }),
  connectorSchema,
);
const big = await parse(
  await human("/api/connectors", {
    method: "POST",
    body: JSON.stringify({
      name: "Big",
      url: `${mockBase}${MOCK_PATHS.big}`,
      authType: "bearer",
      token: MOCK_AUTH.bigBearer,
    }),
  }),
  connectorSchema,
);
const pay = await parse(
  await human("/api/connectors", {
    method: "POST",
    body: JSON.stringify({
      name: "Pay",
      url: `${mockBase}${MOCK_PATHS.pay}`,
      authType: "header",
      headerName: MOCK_AUTH.payHeaderName,
      headerValue: MOCK_AUTH.payHeaderValue,
    }),
  }),
  connectorSchema,
);
console.log(`calendar ${calendar.connector.id}, big ${big.connector.id}, pay ${pay.connector.id}`);

const db = createMigratedDatabase(databasePath);
db.update(tools).set({ requestable: true }).where(eq(tools.agentName, "calendar__delete_event")).run();

const agent = await connectAgent(base, created.key);

async function request(toolNames: string[], limits: Record<string, number> = {}): Promise<string> {
  const { result, body } = await callTool(agent, "request_errand", {
    goal: "forward proof errand",
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
  const status = statusSchema.parse(body);
  assert.ok(status.capability !== null, "approved slip has no capability");
  return status.capability;
}

async function call(slipId: string, capability: string, tool: string, args: Record<string, unknown> = {}) {
  return callAgent(agent, slipId, capability, tool, args);
}

step("the top layer still lists exactly four tools");
const listed = await agent.listTools();
console.log(`tools: ${listed.tools.map((tool) => tool.name).sort().join(", ")}`);
assert.deepEqual(
  listed.tools.map((tool) => tool.name).sort(),
  ["errand_call", "errand_catalog", "errand_status", "request_errand"],
);

step("a read call forwards with the vault-held bearer credential");
const readSlip = await request(["calendar__list_events"]);
const readCapability = await approve(readSlip);
const readResponse = await call(readSlip, readCapability, "calendar__list_events");
const read = forwardedSchema.parse(readResponse.body);
console.log(JSON.stringify(readResponse.body, null, 2).slice(0, 1200));
assert.equal(read.state, "forwarded");

step("a write call forwards immediately");
const writeSlip = await request(["calendar__create_event"]);
const writeCapability = await approve(writeSlip);
const write = await call(writeSlip, writeCapability, "calendar__create_event", {
  title: "Dinner with Sam",
  start: "2026-12-01T19:00:00Z",
});
console.log(JSON.stringify(write.body, null, 2));
assert.equal(forwardedSchema.parse(write.body).state, "forwarded");
assert.match(JSON.stringify(write.body), /evt-new/);

step("a delete call forwards only when the slip explicitly includes it");
const deleteSlip = await request(["calendar__delete_event"]);
const deleteCapability = await approve(deleteSlip);
const deleted = await call(deleteSlip, deleteCapability, "calendar__delete_event", { id: "evt-1" });
console.log(JSON.stringify(deleted.body, null, 2));
assert.equal(forwardedSchema.parse(deleted.body).state, "forwarded");
const offSlip = await call(readSlip, readCapability, "calendar__delete_event", { id: "evt-1" });
console.log(JSON.stringify({ isError: offSlip.result.isError, body: offSlip.body }, null, 2));
assert.equal(errorSchema.parse(offSlip.body).error, "out_of_scope");

step("a result over 256 KB is truncated and flagged");
const largeSlip = await request(["big__large_result"]);
const largeCapability = await approve(largeSlip);
const large = forwardedSchema.parse(
  (await call(largeSlip, largeCapability, "big__large_result", { bytes: 300 * 1024 })).body,
);
const largeResult = z
  .object({ truncated: z.boolean(), originalBytes: z.number() })
  .parse(large.result);
console.log(
  JSON.stringify(
    {
      state: large.state,
      truncated: largeResult.truncated,
      originalBytes: largeResult.originalBytes,
      returnedBytes: bytes(large.result),
    },
    null,
    2,
  ),
);
assert.equal(largeResult.truncated, true);
assert.ok(largeResult.originalBytes > 256 * 1024);
assert.ok(bytes(large.result) <= 256 * 1024);
const largeRow = db.select().from(calls).all().find((row) => row.slipId === largeSlip);
if (largeRow === undefined || largeRow.result === null) throw new Error("large result row missing");
assert.ok(Buffer.byteLength(largeRow.result, "utf8") <= 256 * 1024);

step("the upstream cannot echo the credential back to the agent");
const echoSlip = await request(["big__echo_token"]);
const echoCapability = await approve(echoSlip);
const echo = await call(echoSlip, echoCapability, "big__echo_token");
console.log(JSON.stringify(echo.body, null, 2));
assert.doesNotMatch(JSON.stringify(echo.body), new RegExp(MOCK_AUTH.bigBearer));

step("a per-call timeout fails the call, consumes its counter and is journaled");
const slowSlip = await request(["big__slow_result"]);
const slowCapability = await approve(slowSlip);
const slow = await call(slowSlip, slowCapability, "big__slow_result", { ms: 1_500 });
console.log(JSON.stringify({ isError: slow.result.isError, body: slow.body }, null, 2));
assert.equal(errorSchema.parse(slow.body).error, "upstream_timeout");
const slowStatus = statusSchema.parse((await callTool(agent, "errand_status", { slip_id: slowSlip })).body);
console.log(JSON.stringify({ callsUsed: slowStatus.callsUsed }));
assert.equal(slowStatus.callsUsed, 1);
const timeoutEvent = db
  .select()
  .from(journal)
  .all()
  .filter((event) => event.eventType === "call.failed")
  .at(-1);
const timeoutRow = db.select().from(calls).all().find((row) => row.slipId === slowSlip);
console.log(
  JSON.stringify(
    {
      journal: timeoutEvent?.payload,
      call: timeoutRow === undefined ? null : { result: timeoutRow.result, error: timeoutRow.error },
    },
    null,
    2,
  ),
);
assert.match(timeoutEvent?.payload ?? "", /upstream_timeout/);
assert.equal(timeoutRow?.result, null);

step("per-connector concurrency holds at two");
await fetch(`${mockBase}/mock/big/reset`, { method: "POST" });
const concurrentSlip = await request(["big__slow_result"], { calls: 10 });
const concurrentCapability = await approve(concurrentSlip);
const concurrent = await Promise.all(
  Array.from({ length: 6 }, () =>
    call(concurrentSlip, concurrentCapability, "big__slow_result", { ms: 100 }),
  ),
);
assert.ok(concurrent.every((response) => response.result.isError === undefined));
const stats = z
  .object({ maxActive: z.number().int().positive() })
  .parse(await (await fetch(`${mockBase}/mock/big/stats`)).json());
console.log(`max concurrent upstream calls: ${stats.maxActive}`);
assert.equal(stats.maxActive, 2);

step("the journal and calls table stay secret-free and the chain verifies");
const callRows = db.select().from(calls).all();
const events = db.select().from(journal).all();
for (const secret of [MOCK_AUTH.calendarBearer, MOCK_AUTH.bigBearer, MOCK_AUTH.payHeaderValue]) {
  const inCalls = callRows.filter((row) =>
    `${row.result ?? ""}${row.error ?? ""}${row.arguments}`.includes(secret),
  );
  const inJournal = events.filter((event) => event.payload.includes(secret));
  assert.equal(inCalls.length, 0, `credential found in calls: ${secret}`);
  assert.equal(inJournal.length, 0, `credential found in journal: ${secret}`);
}
console.log(`calls rows: ${callRows.length}`);
console.log(
  callRows
    .slice(-4)
    .map(
      (row) =>
        `${row.tool}: result=${row.result === null ? "null" : `${row.result.length} chars`} error=${row.error ?? "null"}`,
    )
    .join("\n"),
);
console.log(
  events
    .filter((event) => event.eventType.startsWith("call."))
    .slice(-8)
    .map((event) => `${event.seq} ${event.eventType} ${event.payload}`)
    .join("\n"),
);
const failed = events.filter(
  (event) => event.eventType === "call.failed" && event.payload.includes("upstream_timeout"),
);
assert.ok(failed.length > 0);
const verified = await parse(await human("/api/journal/verify"), z.object({ ok: z.boolean(), checked: z.number() }));
console.log(JSON.stringify(verified));

await agent.close();
db.$client.close();
console.log("\nVERDICT: pass");
