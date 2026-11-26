import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { createMigratedDatabase } from "../../src/db/client.ts";
import { journal, trust } from "../../src/db/schema.ts";
import { getSlip } from "../../src/db/scoped-reads.ts";
import { DECOY_NAMES } from "@errand/shared";
import { callTool, connectAgent } from "../agent/mcp-client.ts";
import { humanRequests, parse, step } from "../support/proof-drive.ts";

const base = process.argv[2] ?? "http://127.0.0.1:8843";
const databasePath = process.argv[3] ?? "docs/proof/13-decoys-burns/proof.db";
const mockBase = process.argv[4] ?? "http://127.0.0.1:4123";
const passphrase = process.env.OWNER_PASSPHRASE ?? "proof-passphrase";
const OWNER = "owner";

const sessionSchema = z.object({ authenticated: z.boolean() });
const keySchema = z.object({ key: z.string(), mcpUrl: z.string(), agentKey: z.object({ id: z.string() }) });
const connectorSchema = z.object({ connector: z.object({ id: z.string() }) });
const requestedSchema = z.object({ slipId: z.string(), state: z.string() });
const statusSchema = z.object({
  state: z.string(),
  capability: z.string().nullable(),
  burnedReason: z.string().nullable(),
});
const errorSchema = z.object({
  error: z.string(),
  tool: z.string().optional(),
  slip_state: z.string().optional(),
  burned_reason: z.string().nullable().optional(),
});

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

step("create the agent key and connect the Calendar mock");
const created = await parse(
  await human("/api/agent-keys", { method: "POST", body: JSON.stringify({ name: "burn proof agent" }) }),
  keySchema,
);
console.log(`agent key ${created.agentKey.id}; one URL ${created.mcpUrl}`);
const calendar = await parse(
  await human("/api/connectors", {
    method: "POST",
    body: JSON.stringify({ name: "Calendar", url: `${mockBase}/calendar/mcp`, authType: "none" }),
  }),
  connectorSchema,
);
console.log(`calendar connector ${calendar.connector.id}`);

const db = createMigratedDatabase(databasePath);
const agent = await connectAgent(base, created.key);

async function requestAndApprove(): Promise<{ slipId: string; capability: string; errandType: string }> {
  const requested = await callTool(agent, "request_errand", {
    goal: "burn proof errand",
    tools: ["calendar__list_events"],
  });
  assert.equal(requested.result.isError, undefined);
  const slipId = requestedSchema.parse(requested.body).slipId;
  await parse(
    await human(`/api/slips/${slipId}/approve`, { method: "POST", body: "{}" }),
    z.object({ slip: z.object({ state: z.string() }) }),
  );
  const status = await callTool(agent, "errand_status", { slip_id: slipId });
  const capability = statusSchema.parse(status.body).capability;
  assert.ok(capability !== null, "approved slip has no capability");
  const row = getSlip(db, OWNER, slipId);
  assert.ok(row !== undefined, "approved slip vanished");
  return { slipId, capability, errandType: row.errandType };
}

function seedLicense(errandType: string): void {
  db.delete(trust).where(and(eq(trust.userId, OWNER), eq(trust.errandType, errandType))).run();
  db.insert(trust)
    .values({
      userId: OWNER,
      errandType,
      tier: "license",
      cleanRuns: 4,
      caps: "{}",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .run();
}

async function call(slipId: string, capability: string, tool: string) {
  return callTool(agent, "errand_call", { slip_id: slipId, capability, tool, arguments: {} });
}

step("stream the live feed from the start of the journal");
const feedController = new AbortController();
const feedResponse = await fetch(`${base}/api/events?since=0`, {
  headers: { cookie: sessionCookie },
  signal: feedController.signal,
});
assert.ok(feedResponse.body !== null, "feed has no body");
const feedReader = feedResponse.body.getReader();
const decoder = new TextDecoder();
let feedText = "";
void (async () => {
  try {
    while (true) {
      const chunk = await feedReader.read();
      if (chunk.done) break;
      feedText += decoder.decode(chunk.value, { stream: true });
    }
  } catch {
    // Aborted by the driver once the burn frames are present.
  }
})();

step("each decoy is inert, burns its slip, revokes its capability and demotes the type");
for (const decoy of DECOY_NAMES) {
  const { slipId, capability, errandType } = await requestAndApprove();
  seedLicense(errandType);
  const tool = `calendar__${decoy}`;
  const hit = await call(slipId, capability, tool);
  const hitBody = errorSchema.parse(hit.body);
  console.log(`\n${tool} -> ${JSON.stringify({ isError: hit.result.isError, ...hitBody })}`);
  assert.equal(hit.result.isError, true);
  assert.equal(hitBody.error, "decoy");
  assert.equal(hitBody.slip_state, "burned");
  assert.equal(hitBody.burned_reason, "decoy");

  const burned = getSlip(db, OWNER, slipId);
  assert.ok(burned !== undefined, "slip vanished after the decoy");
  const demoted = db
    .select()
    .from(trust)
    .where(and(eq(trust.userId, OWNER), eq(trust.errandType, errandType)))
    .all()[0];
  console.log(
    JSON.stringify(
      {
        slip: {
          state: burned.state,
          burnedReason: burned.burnedReason,
          burnedAt: burned.burnedAt,
          capabilityRevoked: burned.capabilityHash === null,
        },
        trust: { tier: demoted?.tier, cleanRuns: demoted?.cleanRuns },
      },
      null,
      2,
    ),
  );
  assert.equal(burned.state, "burned");
  assert.equal(burned.burnedReason, "decoy");
  assert.equal(burned.capabilityHash, null);
  assert.equal(demoted?.tier, "learner");
  assert.equal(demoted?.cleanRuns, 0);
  assert.equal(demoted?.caps, "{}");

  const afterwards = await call(slipId, capability, "calendar__list_events");
  const afterwardsBody = errorSchema.parse(afterwards.body);
  console.log(`afterwards -> ${JSON.stringify(afterwardsBody)}`);
  assert.equal(afterwardsBody.error, "burned");
  assert.equal(afterwardsBody.slip_state, "burned");
  assert.equal(afterwardsBody.burned_reason, "decoy");

  const status = statusSchema.parse((await callTool(agent, "errand_status", { slip_id: slipId })).body);
  console.log(`status -> ${JSON.stringify(status)}`);
  assert.deepEqual(status, { state: "burned", capability: null, burnedReason: "decoy" });
}

step("the first scope violation is denied and journaled; the second burns");
const scope = await requestAndApprove();
seedLicense(scope.errandType);
const first = await call(scope.slipId, scope.capability, "calendar__delete_event");
const firstBody = errorSchema.parse(first.body);
console.log(`first out-of-scope -> ${JSON.stringify(firstBody)}`);
assert.equal(firstBody.error, "out_of_scope");
const afterFirst = getSlip(db, OWNER, scope.slipId);
console.log(
  JSON.stringify({
    state: afterFirst?.state,
    scopeViolations: afterFirst?.scopeViolations,
    capabilityStillLive: afterFirst?.capabilityHash !== null,
  }),
);
assert.equal(afterFirst?.state, "approved");
assert.equal(afterFirst?.scopeViolations, 1);

const second = await call(scope.slipId, scope.capability, "calendar__delete_event");
const secondBody = errorSchema.parse(second.body);
console.log(`second out-of-scope -> ${JSON.stringify(secondBody)}`);
assert.equal(secondBody.error, "out_of_scope");
assert.equal(secondBody.slip_state, "burned");
assert.equal(secondBody.burned_reason, "second_scope_violation");
const afterSecond = getSlip(db, OWNER, scope.slipId);
const demotedScope = db
  .select()
  .from(trust)
  .where(and(eq(trust.userId, OWNER), eq(trust.errandType, scope.errandType)))
  .all()[0];
console.log(
  JSON.stringify(
    {
      slip: {
        state: afterSecond?.state,
        burnedReason: afterSecond?.burnedReason,
        scopeViolations: afterSecond?.scopeViolations,
        capabilityRevoked: afterSecond?.capabilityHash === null,
      },
      trust: { tier: demotedScope?.tier, cleanRuns: demotedScope?.cleanRuns },
    },
    null,
    2,
  ),
);
assert.equal(afterSecond?.state, "burned");
assert.equal(afterSecond?.burnedReason, "second_scope_violation");
assert.equal(afterSecond?.scopeViolations, 2);
assert.equal(afterSecond?.capabilityHash, null);
assert.equal(demotedScope?.tier, "learner");

const third = await call(scope.slipId, scope.capability, "calendar__list_events");
const thirdBody = errorSchema.parse(third.body);
console.log(`after the second violation -> ${JSON.stringify(thirdBody)}`);
assert.equal(thirdBody.error, "burned");
assert.equal(thirdBody.slip_state, "burned");
assert.equal(thirdBody.burned_reason, "second_scope_violation");

step("the live feed carries every burn and scope frame");
await new Promise((resolve) => setTimeout(resolve, 1_200));
feedController.abort();
const feedFrames = feedText
  .split("\n")
  .filter((line) => line.startsWith("data: ") && line.includes("slip.burned"));
console.log(
  feedFrames
    .map((line) => JSON.parse(line.slice(6)))
    .map((event) => `${event.seq} ${event.eventType} ${JSON.stringify(event.payload)}`)
    .join("\n"),
);
assert.equal(feedFrames.length, 4);

step("the journal records each reason and still verifies");
const events = db.select().from(journal).all();
const burns = events.filter((event) => event.eventType === "slip.burned");
const violations = events.filter((event) => event.eventType === "call.scope_violation");
console.log(
  burns
    .map((event) => `${event.seq} ${event.eventType} ${event.payload}`)
    .join("\n"),
);
assert.equal(burns.length, 4);
assert.equal(violations.length, 2);
const verified = await parse(
  await human("/api/journal/verify"),
  z.object({ ok: z.boolean(), checked: z.number() }),
);
console.log(JSON.stringify(verified));
assert.equal(verified.ok, true);

await agent.close();
db.$client.close();
console.log("\nVERDICT: pass");
