import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createMigratedDatabase } from "../../src/db/client.ts";
import { slips } from "../../src/db/schema.ts";
import { errandTypeFor } from "../../src/policy/errand-type.ts";
import { approveSlip } from "../../src/slips/approval.ts";
import { callTool, connectAgent } from "../agent/mcp-client.ts";
import { humanRequests, parse, step } from "../support/proof-drive.ts";

const base = process.argv[2] ?? "http://127.0.0.1:8842";
const databasePath = process.argv[3] ?? "docs/proof/12-outbox-spend/proof.db";
const hmacKey = process.env.HMAC_KEY ?? "";
const passphrase = process.env.OWNER_PASSPHRASE ?? "proof-passphrase";
const OWNER = "owner";
assert.ok(hmacKey.length >= 32, "HMAC_KEY must be set");

const keySchema = z.object({ key: z.string() });
const connectorListSchema = z.object({
  connectors: z.array(z.object({ id: z.string(), name: z.string() })),
});
const statusSchema = z.object({ capability: z.string().nullable() });
const pendingSchema = z.object({ outboxId: z.string(), state: z.string() });

step("log in and create a browser-proof agent key");
const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ passphrase }),
});
const cookie = login.headers.get("set-cookie")?.split(";")[0];
assert.ok(cookie, "login did not set a session cookie");
const created = await parse(
  await humanRequests(base, cookie)("/api/agent-keys", {
    method: "POST",
    body: JSON.stringify({ name: "browser proof agent" }),
  }),
  keySchema,
);
const pay = (await parse(await humanRequests(base, cookie)("/api/connectors"), connectorListSchema))
  .connectors.find((connector) => connector.name === "Pay");
assert.ok(pay !== undefined, "the Pay connector is not connected");
const payConnectorId = pay.id;

const db = createMigratedDatabase(databasePath);
const agent = await connectAgent(base, created.key);

function seedSlip(options: {
  goal: string;
  tool: string;
  class: "send" | "spend";
  constraints?: Record<string, unknown>;
}): string {
  const id = randomUUID();
  const now = new Date();
  const constraints = options.constraints ?? {};
  db.insert(slips)
    .values({
      id,
      userId: OWNER,
      errandType: errandTypeFor([options.tool], Object.keys(constraints)),
      goal: options.goal,
      state: "pending",
      tier: "learner",
      tools: JSON.stringify([
        { name: options.tool, connectorId: payConnectorId, class: options.class },
      ]),
      constraints: JSON.stringify(constraints),
      callCap: 5,
      spendCapCents: 10_000,
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
  assert.ok(capability !== null, "the seeded slip has no capability");
  return capability;
}

step("create one held send and one spend waiting for the tap");
const sendSlipId = seedSlip({
  goal: "Send the receipt",
  tool: "pay__send_receipt",
  class: "send",
  constraints: { pay__send_receipt: { id: ["rcpt-browser"] } },
});
const sendHeld = pendingSchema.parse(
  (
    await callTool(agent, "errand_call", {
      slip_id: sendSlipId,
      capability: await capabilityFor(sendSlipId),
      tool: "pay__send_receipt",
      arguments: { id: "rcpt-browser" },
    })
  ).body,
);

const spendSlipId = seedSlip({
  goal: "Pay the invoice",
  tool: "pay__charge_card",
  class: "spend",
});
const spendWaiting = pendingSchema.parse(
  (
    await callTool(agent, "errand_call", {
      slip_id: spendSlipId,
      capability: await capabilityFor(spendSlipId),
      tool: "pay__charge_card",
      arguments: { cents: 2500 },
    })
  ).body,
);

console.log(
  JSON.stringify({
    send: { outboxId: sendHeld.outboxId, slipId: sendSlipId, state: sendHeld.state },
    spend: { outboxId: spendWaiting.outboxId, slipId: spendSlipId, state: spendWaiting.state },
  }),
);

await agent.close();
