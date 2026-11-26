import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createMigratedDatabase } from "../../src/db/client.ts";
import { calls, outbox, slips } from "../../src/db/schema.ts";
import { getSlip } from "../../src/db/scoped-reads.ts";
import { errandTypeFor } from "../../src/policy/errand-type.ts";
import { approveSlip } from "../../src/slips/approval.ts";
import { callTool, connectAgent } from "../agent/mcp-client.ts";
import { humanRequests, parse, step } from "../support/proof-drive.ts";

const base = process.argv[2] ?? "http://127.0.0.1:8842";
const databasePath = process.argv[3] ?? "docs/proof/12-outbox-spend/proof.db";
const mockBase = process.argv[4] ?? "http://127.0.0.1:4122";
const passphrase = process.env.OWNER_PASSPHRASE ?? "proof-passphrase";
const hmacKey = process.env.HMAC_KEY ?? "";
const OWNER = "owner";

const sessionSchema = z.object({ authenticated: z.boolean() });
const keySchema = z.object({
  key: z.string(),
  mcpUrl: z.string(),
  agentKey: z.object({ id: z.string() }),
});
const connectorSchema = z.object({ connector: z.object({ id: z.string() }) });
const catalogSchema = z.object({
  tools: z.array(z.object({ id: z.string(), agentName: z.string(), class: z.string() })),
});
const statusSchema = z.object({ state: z.string(), capability: z.string().nullable() });
const pendingSchema = z.object({
  state: z.enum(["held", "needs_human"]),
  outboxId: z.string(),
  releaseAt: z.string().nullable().optional(),
  expiresAt: z.string(),
  amountCents: z.number().int().nonnegative().optional(),
});
const outboxItemSchema = z.object({
  item: z.object({ id: z.string(), state: z.string(), reason: z.string().nullable() }),
});
const outboxListSchema = z.object({
  items: z.array(
    z.object({ id: z.string(), state: z.string(), toolClass: z.string(), amountCents: z.number() }),
  ),
});


assert.ok(hmacKey.length >= 32, "HMAC_KEY must be set for the proof driver");

step("log in as the owner");
const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ passphrase }),
});
const cookie = login.headers.get("set-cookie")?.split(";")[0];
assert.ok(cookie, "login did not set a session cookie");
console.log(JSON.stringify(await parse(login, sessionSchema)));
const human = humanRequests(base, cookie);

step("create the agent key and connect the Pay mock");
const created = await parse(
  await human("/api/agent-keys", { method: "POST", body: JSON.stringify({ name: "outbox proof agent" }) }),
  keySchema,
);
console.log(`agent key ${created.agentKey.id}; one URL ${created.mcpUrl}`);
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
console.log(`pay connector ${pay.connector.id}`);
const catalog = await parse(await human("/api/catalog"), catalogSchema);
const sendTool = catalog.tools.find((tool) => tool.agentName === "pay__send_receipt");
const spendTool = catalog.tools.find((tool) => tool.agentName === "pay__charge_card");
assert.ok(sendTool !== undefined, "send_receipt was not discovered");
assert.ok(spendTool !== undefined, "charge_card was not discovered");
assert.equal(sendTool.class, "send");
assert.equal(spendTool.class, "spend");
for (const tool of [sendTool, spendTool]) {
  await parse(
    await human(`/api/catalog/${tool.id}/requestable`, {
      method: "POST",
      body: JSON.stringify({ requestable: true }),
    }),
    z.object({ tool: z.object({ id: z.string() }) }),
  );
}

const db = createMigratedDatabase(databasePath);
const agent = await connectAgent(base, created.key);

function seedSlip(options: {
  tools: Array<{ name: string; connectorId: string; class: "send" | "spend" }>;
  constraints?: Record<string, unknown>;
  tier: "learner" | "license";
  spendCapCents?: number;
}): string {
  const id = randomUUID();
  const now = new Date();
  const constraints = options.constraints ?? {};
  db.insert(slips)
    .values({
      id,
      userId: OWNER,
      errandType: errandTypeFor(
        options.tools.map((tool) => tool.name),
        Object.keys(constraints),
      ),
      goal: options.tools[0]?.class === "spend" ? "Pay the invoice" : "Send the receipt",
      state: "pending",
      tier: options.tier,
      tools: JSON.stringify(options.tools),
      constraints: JSON.stringify(constraints),
      callCap: 10,
      spendCapCents: options.spendCapCents ?? 10_000,
      expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    .run();
  approveSlip(db, OWNER, id, {}, { hmacKey, now });
  return id;
}

async function capabilityFor(slipId: string): Promise<string> {
  const status = await callTool(agent, "errand_status", { slip_id: slipId });
  const capability = statusSchema.parse(status.body).capability;
  assert.ok(capability !== null, `slip ${slipId} has no capability`);
  return capability;
}

function sendSlip(): Promise<{ slipId: string; capability: string }> {
  const slipId = seedSlip({
    tools: [{ name: "pay__send_receipt", connectorId: pay.connector.id, class: "send" }],
    constraints: { pay__send_receipt: { id: ["rcpt-proof"] } },
    tier: "learner",
  });
  return capabilityFor(slipId).then((capability) => ({ slipId, capability }));
}

function spendSlip(tier: "learner" | "license"): Promise<{ slipId: string; capability: string }> {
  const slipId = seedSlip({
    tools: [{ name: "pay__charge_card", connectorId: pay.connector.id, class: "spend" }],
    tier,
  });
  return capabilityFor(slipId).then((capability) => ({ slipId, capability }));
}

async function agentCall(
  slip: { slipId: string; capability: string },
  tool: string,
  args: Record<string, unknown>,
) {
  const response = await callTool(agent, "errand_call", {
    slip_id: slip.slipId,
    capability: slip.capability,
    tool,
    arguments: args,
  });
  assert.notEqual(response.result.isError, true, `agent call was refused: ${JSON.stringify(response.body)}`);
  return response.body;
}

function callsFor(slipId: string) {
  return db.select().from(calls).all().filter((row) => row.slipId === slipId);
}

function outboxFor(slipId: string) {
  return db.select().from(outbox).all().filter((row) => row.slipId === slipId);
}

async function waitFor<T>(check: () => T | undefined, label: string, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value !== undefined) return value;
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

step("stream the live feed from the start of the journal");
const feedController = new AbortController();
const feedResponse = await fetch(`${base}/api/events?since=0`, {
  headers: { cookie },
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
    // Aborted by the driver once the proof frames are present.
  }
})();

step("a send is held, then the real 30-second window closes and the worker releases it");
const send = await sendSlip();
const held = pendingSchema.parse(
  await agentCall(send, "pay__send_receipt", { id: "rcpt-proof" }),
);
assert.equal(held.state, "held");
assert.equal(callsFor(send.slipId).length, 0);
console.log(
  `held ${held.outboxId}; releaseAt ${held.releaseAt}; no calls row; callsUsed ${getSlip(db, OWNER, send.slipId)?.callsUsed}`,
);
const released = await waitFor(
  () => {
    const row = outboxFor(send.slipId)[0];
    return row?.state === "released" ? row : undefined;
  },
  "the send to release",
  35_000,
);
console.log(
  `released after the hold; state ${released.state}; call rows ${callsFor(send.slipId).length}; result ${callsFor(send.slipId)[0]?.result}`,
);

step("a second send is cancelled inside the window and never fires");
const cancelSend = await sendSlip();
const cancelHeld = pendingSchema.parse(
  await agentCall(cancelSend, "pay__send_receipt", { id: "rcpt-proof" }),
);
const cancelled = await parse(
  await human(`/api/outbox/${cancelHeld.outboxId}/cancel`, { method: "POST" }),
  outboxItemSchema,
);
assert.equal(cancelled.item.state, "cancelled");
await Bun.sleep(32_000);
const cancelledRow = outboxFor(cancelSend.slipId)[0];
assert.equal(cancelledRow?.state, "cancelled");
assert.equal(callsFor(cancelSend.slipId).length, 0);
console.log(
  `cancelled ${cancelled.item.id}; state ${cancelledRow?.state}; call rows ${callsFor(cancelSend.slipId).length}; callsUsed ${getSlip(db, OWNER, cancelSend.slipId)?.callsUsed}`,
);

step("a spend returns needs_human until a separate human tap, on both tiers");
const learnerSpend = await spendSlip("learner");
const learnerPending = pendingSchema.parse(
  await agentCall(learnerSpend, "pay__charge_card", { cents: 1250 }),
);
assert.equal(learnerPending.state, "needs_human");
assert.equal(learnerPending.amountCents, 1250);
assert.equal(callsFor(learnerSpend.slipId).length, 0);
console.log(`learner spend ${learnerPending.outboxId}: needs_human, nothing moved`);
const confirmed = await parse(
  await human(`/api/outbox/${learnerPending.outboxId}/confirm`, { method: "POST" }),
  outboxItemSchema,
);
assert.equal(confirmed.item.state, "confirmed");
console.log(
  `learner spend confirmed; state ${confirmed.item.state}; call rows ${callsFor(learnerSpend.slipId).length}; result ${callsFor(learnerSpend.slipId)[0]?.result}`,
);

const licenseSpend = await spendSlip("license");
const licensePending = pendingSchema.parse(
  await agentCall(licenseSpend, "pay__charge_card", { cents: 4400 }),
);
assert.equal(licensePending.state, "needs_human");
console.log(`license spend ${licensePending.outboxId}: needs_human even on the license tier`);
const denied = await parse(
  await human(`/api/outbox/${licensePending.outboxId}/cancel`, { method: "POST" }),
  outboxItemSchema,
);
assert.equal(denied.item.state, "cancelled");
assert.equal(callsFor(licenseSpend.slipId).length, 0);
console.log(
  `license spend denied; state ${denied.item.state}; call rows 0; spendUsed ${getSlip(db, OWNER, licenseSpend.slipId)?.spendUsedCents}`,
);

step("an outbox item past its expiry never fires");
const expiredSend = await sendSlip();
const expiredHeld = pendingSchema.parse(
  await agentCall(expiredSend, "pay__send_receipt", { id: "rcpt-proof" }),
);
db.update(outbox)
  .set({ releaseAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:00:01.000Z" })
  .where(eq(outbox.id, expiredHeld.outboxId))
  .run();
const expired = await waitFor(
  () => {
    const row = outboxFor(expiredSend.slipId)[0];
    return row?.state === "expired" ? row : undefined;
  },
  "the expired item to be swept",
  3_000,
);
await Bun.sleep(32_000);
assert.equal(expired.state, "expired");
assert.equal(callsFor(expiredSend.slipId).length, 0);
console.log(
  `expired ${expired.id}; state ${expired.state}; call rows 0 after 32s; callsUsed ${getSlip(db, OWNER, expiredSend.slipId)?.callsUsed}`,
);

step("the outbox list and the live feed");
const list = await parse(await human("/api/outbox"), outboxListSchema);
console.log(`outbox list: ${JSON.stringify(list.items)}`);
await Bun.sleep(1_000);
for (const eventType of [
  "outbox.held",
  "outbox.released",
  "outbox.cancelled",
  "outbox.needs_human",
  "outbox.confirmed",
  "outbox.expired",
]) {
  assert.ok(feedText.includes(eventType), `live feed never showed ${eventType}`);
}
console.log("live feed carried held, released, cancelled, needs_human, confirmed and expired frames");

step("verify the journal chain");
const verify = await parse(await human("/api/journal/verify"), z.object({ ok: z.boolean(), checked: z.number() }));
assert.equal(verify.ok, true);
console.log(JSON.stringify(verify));

writeFileSync("docs/proof/12-outbox-spend/logs/sse.txt", feedText);
feedController.abort();
await agent.close();
console.log("\nproof drive complete");
