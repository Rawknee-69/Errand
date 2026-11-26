import {
  agentKeyCreatedSchema,
  catalogResponseSchema,
  catalogToolResponseSchema,
  connectorDetailSchema,
  slipDetailSchema,
} from "../../../packages/shared/src/index.ts";
import { callTool, connectAgent } from "../../../apps/gateway/tests/agent/mcp-client.ts";

const base = "http://127.0.0.1:8831";
const mock = "http://127.0.0.1:4111";
const passphrase = "proof-passphrase-18";
const statePath = "C:/Users/Rem/AppData/Local/Temp/opencode/errand-18-state.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function slipIdOf(body: unknown): string {
  if (!isRecord(body) || typeof body.slipId !== "string") {
    throw new Error(`request_errand did not return a slip id: ${JSON.stringify(body)}`);
  }
  return body.slipId;
}

const loginResponse = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ passphrase }),
});
if (!loginResponse.ok) throw new Error(`login failed: ${loginResponse.status}`);
const cookie = loginResponse.headers.get("set-cookie")?.split(";")[0];
if (cookie === undefined) throw new Error("login did not set a cookie");

async function human(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...(init.headers ?? {}) },
  });
}

async function parse<T>(schema: { parse(value: unknown): T }, response: Response): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return schema.parse(body);
}

console.log("step: connect the mock calendar");
const connected = await parse(
  connectorDetailSchema,
  await human("/api/connectors", {
    method: "POST",
    body: JSON.stringify({ name: "Calendar", url: `${mock}/calendar/mcp`, authType: "none" }),
  }),
);
console.log(`connector ${connected.connector.id}: ${connected.tools.map((tool) => tool.agentName).join(", ")}`);

console.log("step: expose the two tools the demo needs");
const catalog = await parse(catalogResponseSchema, await human("/api/catalog"));
for (const tool of catalog.tools) {
  const requestable = tool.name === "list_events" || tool.name === "create_event";
  const updated = await parse(
    catalogToolResponseSchema,
    await human(`/api/catalog/${tool.id}/requestable`, {
      method: "POST",
      body: JSON.stringify({ requestable }),
    }),
  );
  console.log(`${tool.agentName}: requestable=${updated.tool.requestable}`);
}

console.log("step: issue an agent key");
const issued = await parse(
  agentKeyCreatedSchema,
  await human("/api/agent-keys", { method: "POST", body: JSON.stringify({ name: "ticket-18 proof agent" }) }),
);

const agent = await connectAgent(base, issued.key);

console.log("step: request three slips");
const slips: Record<string, string> = {};
for (const request of [
  {
    name: "search",
    goal: "Find a dinner slot for Friday",
    tools: ["calendar__list_events"],
    limits: { calls: 9, spend_cents: 5_000 },
  },
  {
    name: "create",
    goal: "Create a planning event for Monday",
    tools: ["calendar__create_event"],
    limits: { calls: 6, spend_cents: 0 },
  },
  {
    name: "deny",
    goal: "Tidy up next week's calendar",
    tools: ["calendar__list_events"],
    limits: { calls: 4, spend_cents: 0 },
  },
  {
    name: "clamped",
    goal: "Export the whole calendar",
    tools: ["calendar__list_events"],
    limits: { calls: 900, spend_cents: 100_000 },
  },
] as const) {
  const result = await callTool(agent, "request_errand", {
    goal: request.goal,
    tools: request.tools,
    limits: request.limits,
  });
  const slipId = slipIdOf(result.body);
  slips[request.name] = slipId;
  console.log(`${request.name}: ${slipId} (pending) — ${request.goal}`);
}

const details = await Promise.all(
  Object.values(slips).map(async (id) => {
    const response = await human(`/api/slips/${id}`);
    return parse(slipDetailSchema, response);
  }),
);
for (const detail of details) {
  console.log(`card ${detail.slip.slipId}: can=${detail.card.can.map((row) => row.label).join(" | ")}`);
  console.log(`  cannot=${detail.card.cannot.join(" | ")}`);
}

await Bun.write(
  statePath,
  JSON.stringify({ key: issued.key, slips, cookie }, null, 2),
);
console.log(`state written to ${statePath} (outside the repository)`);
await agent.close();
console.log("VERDICT: setup pass");
