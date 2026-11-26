import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { journalVerifySchema } from "../packages/shared/src/index.ts";
import { callTool, connectAgent } from "../apps/gateway/tests/agent/mcp-client.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const autoApprove = Bun.argv.includes("--auto-approve");

const state = await readFile(`${root}/.demo/agent.json`, "utf8")
  .then((text) => JSON.parse(text) as { base: string; key: string })
  .catch(() => {
    throw new Error("Run `bun run demo:up` then `bun run demo:seed` first.");
  });
const passphrase = await readFile(`${root}/.demo/secrets.json`, "utf8")
  .then((text) => (JSON.parse(text) as { OWNER_PASSPHRASE: string }).OWNER_PASSPHRASE)
  .catch(() => {
    throw new Error("Run `bun run demo:up` first; .demo/secrets.json is missing.");
  });

const login = await fetch(`${state.base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ passphrase }),
});
if (!login.ok) throw new Error(`owner login failed: ${login.status}`);
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (cookie === undefined) throw new Error("owner login did not set a cookie");

const refusalSchema = z
  .object({ error: z.string(), message: z.string().optional() })
  .passthrough();
const catalogSchema = z
  .object({
    tools: z.array(
      z.object({ name: z.string(), label: z.string(), class: z.string() }).passthrough(),
    ),
    limits: z.object({ calls: z.number(), spendCents: z.number(), minutes: z.number() }),
  })
  .passthrough();
const requestSchema = z
  .object({
    slipId: z.string(),
    state: z.string(),
    tier: z.string(),
    callCap: z.number(),
    spendCapCents: z.number(),
    tools: z.array(z.object({ name: z.string(), class: z.string() }).passthrough()),
  })
  .passthrough();
const statusSchema = z
  .object({
    state: z.string(),
    goal: z.string(),
    callCap: z.number(),
    callsRemaining: z.number(),
    spendCapCents: z.number(),
    capability: z.string().nullable(),
  })
  .passthrough();
const callSchema = z
  .object({
    state: z.string(),
    tool: z.string(),
    class: z.string().optional(),
    result: z.unknown().optional(),
    reason: z.string().optional(),
    remaining: z.object({ calls: z.number(), spendCents: z.number() }).passthrough().optional(),
  })
  .passthrough();
const slipDetailSchema = z
  .object({ card: z.object({ trims: z.array(z.unknown()) }).passthrough() })
  .passthrough();

function section(title: string): void {
  console.log("");
  console.log(`== ${title}`);
}

async function human<T>(schema: z.ZodType<T>, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${state.base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...(init.headers ?? {}) },
  });
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${JSON.stringify(body)}`);
  return schema.parse(body);
}

const agent = await connectAgent(state.base, state.key);

try {
  section("1. What the agent can name");
  const catalog = catalogSchema.parse((await callTool(agent, "errand_catalog")).body);
  for (const tool of catalog.tools) {
    console.log(`   ${tool.name}  [${tool.class}]  ${tool.label}`);
  }
  console.log(
    `   hard ceilings: ${catalog.limits.calls} calls, $${(catalog.limits.spendCents / 100).toFixed(2)}, ${catalog.limits.minutes} min`,
  );

  section("2. Ask for a tool the human never exposed");
  const hidden = await callTool(agent, "request_errand", {
    goal: "Delete every calendar event",
    tools: ["calendar__delete_event"],
  });
  const hiddenBody = refusalSchema.safeParse(hidden.body);
  if (!hiddenBody.success || !("error" in hiddenBody.data)) {
    throw new Error(`expected a refusal, got ${JSON.stringify(hidden.body)}`);
  }
  console.log(`   refused: ${hiddenBody.data.error} — ${hiddenBody.data.message ?? ""}`);
  console.log("   the tool was never in the catalog, so the agent cannot route around it");

  section("3. Request one scoped job");
  const requested = requestSchema.parse(
    (
      await callTool(agent, "request_errand", {
        goal: "Summarise this week's calendar",
        tools: ["calendar__list_events"],
        limits: { calls: 4, spend_cents: 0 },
      })
    ).body,
  );
  console.log(
    `   slip ${requested.slipId}: ${requested.state}, tier=${requested.tier}, calls=${requested.callCap}, spend=$${(requested.spendCapCents / 100).toFixed(2)}`,
  );
  console.log(`   tools on it: ${requested.tools.map((tool) => tool.name).join(", ")}`);
  const visibleNames = catalog.tools.map((tool) => tool.name);
  const leftOut = visibleNames.filter(
    (name) => !requested.tools.some((tool) => tool.name === name),
  );
  console.log(
    `   requested ${requested.tools.length} of ${visibleNames.length} visible tools; left out: ${leftOut.length === 0 ? "none" : leftOut.join(", ")}`,
  );
  console.log("   every message and output is on the Trace screen after the call");

  section("4. Human approval");
  if (autoApprove) {
    const approved = await human(slipDetailSchema, `/api/slips/${requested.slipId}/approve`, {
      method: "POST",
      body: JSON.stringify({ callCap: 3 }),
    });
    console.log(`   approved with a trim: ${approved.card.trims.length} cap(s) tightened`);
  } else {
    console.log("   waiting for the tap in the Slips screen (approve or deny)…");
  }

  const deadline = Date.now() + 180_000;
  let status = statusSchema.parse(
    (await callTool(agent, "errand_status", { slip_id: requested.slipId })).body,
  );
  while (status.state === "pending" && Date.now() < deadline) {
    await Bun.sleep(2_000);
    status = statusSchema.parse(
      (await callTool(agent, "errand_status", { slip_id: requested.slipId })).body,
    );
  }
  console.log(`   state=${status.state}, calls remaining=${status.callsRemaining}`);
  if (status.state !== "approved" || status.capability === null) {
    throw new Error(`slip is ${status.state}; nothing runs without an approved slip`);
  }
  console.log("   capability issued — it admits this slip and nothing else");

  section("5. Run inside the slip");
  const allowed = callSchema.parse(
    (
      await callTool(agent, "errand_call", {
        slip_id: requested.slipId,
        tool: "calendar__list_events",
        capability: status.capability,
        arguments: {},
      })
    ).body,
  );
  console.log(`   ${allowed.tool}: state=${allowed.state}, class=${allowed.class ?? "?"}`);
  console.log(`   result: ${JSON.stringify(allowed.result)}`);
  if (allowed.remaining !== undefined) {
    console.log(`   remaining: ${allowed.remaining.calls} calls`);
  }

  section("6. Step outside the slip");
  const outside = await callTool(agent, "errand_call", {
    slip_id: requested.slipId,
    tool: "calendar__create_event",
    capability: status.capability,
    arguments: { title: "Not on the slip", start: "2026-12-01T10:00:00Z" },
  });
  const outsideBody = refusalSchema.safeParse(outside.body);
  if (!outsideBody.success) throw new Error(`expected a refusal: ${JSON.stringify(outside.body)}`);
  console.log(`   refused: ${outsideBody.data.error} — ${outsideBody.data.message ?? ""}`);
  console.log("   the signed slip is the boundary, not a prompt instruction");

  section("7. The journal");
  const verified = journalVerifySchema.parse(await human(journalVerifySchema, "/api/journal/verify", {}));
  console.log(
    verified.ok
      ? `   chain intact, ${verified.checked} events checked`
      : `   BROKEN at sequence ${verified.firstBrokenSeq}`,
  );

  console.log("");
  console.log("VERDICT: demo pass");
} finally {
  await agent.close();
}
