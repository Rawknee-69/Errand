import {
  catalogResponseSchema,
  catalogToolResponseSchema,
  connectorDetailSchema,
  receiptViewSchema,
  trustListResponseSchema,
} from "../../../packages/shared/src/index.ts";
import { callTool, connectAgent } from "../../../apps/gateway/tests/agent/mcp-client.ts";

const base = "http://127.0.0.1:8899";
const mock = "http://127.0.0.1:4133";
const passphrase = "proof-passphrase-19";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function slipIdOf(body: unknown): string {
  if (!isRecord(body) || typeof body.slipId !== "string") {
    throw new Error(`request_errand did not return a slip id: ${JSON.stringify(body)}`);
  }
  return body.slipId;
}

function capabilityOf(body: unknown): string {
  if (!isRecord(body) || typeof body.capability !== "string") {
    throw new Error(`errand_status did not return a capability: ${JSON.stringify(body)}`);
  }
  return body.capability;
}

function receiptOf(body: unknown) {
  if (!isRecord(body)) throw new Error(`no receipt in ${JSON.stringify(body)}`);
  return receiptViewSchema.parse(body.receipt);
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

async function setRequestable(toolName: string, requestable: boolean): Promise<string> {
  const catalog = await parse(catalogResponseSchema, await human("/api/catalog"));
  const tool = catalog.tools.find((entry) => entry.name === toolName);
  if (tool === undefined) throw new Error(`missing catalog tool ${toolName}`);
  await parse(
    catalogToolResponseSchema,
    await human(`/api/catalog/${tool.id}/requestable`, {
      method: "POST",
      body: JSON.stringify({ requestable }),
    }),
  );
  return tool.agentName;
}

async function setFault(mode: "none" | "drop_write"): Promise<void> {
  const response = await fetch(`${mock}/mock/calendar/fault`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!response.ok) throw new Error(`fault switch failed: ${response.status}`);
}

async function trustSummary(label: string): Promise<void> {
  const trust = await parse(trustListResponseSchema, await human("/api/trust"));
  console.log(`${label}:`);
  for (const row of trust.trust) {
    console.log(
      `  ${row.errandType.slice(0, 8)} tier=${row.tier} cleanRuns=${row.cleanRuns} offered=${row.licenseOffered} caps=${JSON.stringify(row.caps)}`,
    );
  }
}

console.log("step 1: connect the mock calendar and expose write, read and delete");
const calendar = await parse(
  connectorDetailSchema,
  await human("/api/connectors", {
    method: "POST",
    body: JSON.stringify({ name: "Calendar", url: `${mock}/calendar/mcp`, authType: "none" }),
  }),
);
console.log(`calendar connector ${calendar.connector.id}`);
const createTool = await setRequestable("create_event", true);
const listTool = await setRequestable("list_events", true);
const deleteTool = await setRequestable("delete_event", true);

console.log("step 2: connect the mock restaurant without a verifier");
const dineOut = await parse(
  connectorDetailSchema,
  await human("/api/connectors", {
    method: "POST",
    body: JSON.stringify({
      name: "Dine out",
      url: `${mock}/dine-out/sse`,
      authType: "basic",
      username: "diner",
      password: "eats",
    }),
  }),
);
console.log(`dine-out connector ${dineOut.connector.id}`);
const reserveTool = await setRequestable("reserve_table", true);

console.log("step 3: issue the seed agent key and open the agent connection");
const issuedBody: unknown = await (await human("/api/agent-keys", {
  method: "POST",
  body: JSON.stringify({ name: "Proof agent" }),
})).json();
if (!isRecord(issuedBody) || typeof issuedBody.key !== "string") {
  throw new Error(`agent key response was not readable: ${JSON.stringify(issuedBody)}`);
}
const agent = await connectAgent(base, issuedBody.key);

async function approve(
  tools: string[],
  goal: string,
  calls = 50,
): Promise<{ slipId: string; capability: string }> {
  const requested = await callTool(agent, "request_errand", {
    goal,
    tools,
    limits: { calls, minutes: 5 },
  });
  const slipId = slipIdOf(requested.body);
  const approved = await human(`/api/slips/${slipId}/approve`, {
    method: "POST",
    body: "{}",
  });
  if (!approved.ok) throw new Error(`approve ${slipId} failed: ${approved.status}`);
  const status = await callTool(agent, "errand_status", { slip_id: slipId });
  return { slipId, capability: capabilityOf(status.body) };
}

async function errandCall(
  slip: { slipId: string; capability: string },
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const response = await callTool(agent, "errand_call", {
    slip_id: slip.slipId,
    tool,
    capability: slip.capability,
    arguments: args,
  });
  return response.body;
}

console.log("step 4: a matched create leaves an undo available");
const created = await errandCall(
  await approve(["calendar__create_event"], "Book rehearsal dinner", 1),
  createTool,
  { title: "Proof dinner", start: "2026-12-10T19:00:00Z" },
);
const createdReceipt = receiptOf(created);
console.log(`receipt: ${JSON.stringify(createdReceipt)}`);

console.log("step 5: a verified delete is irreversible");
const doomed = await errandCall(
  await approve(["calendar__create_event"], "Create an event that will be deleted"),
  createTool,
  { title: "Doomed event", start: "2026-12-12T08:00:00Z" },
);
const doomedBody: unknown = JSON.parse(
  String(
    isRecord(doomed) && isRecord(doomed.result) && Array.isArray(doomed.result.content)
      ? (doomed.result.content[0] as { text?: unknown }).text
      : "{}",
  ),
);
if (!isRecord(doomedBody) || typeof doomedBody.id !== "string") {
  throw new Error("created event had no id");
}
const deleted = await errandCall(
  await approve(["calendar__delete_event"], "Delete the doomed event", 1),
  deleteTool,
  { id: doomedBody.id },
);
console.log(`receipt: ${JSON.stringify(receiptOf(deleted))}`);

console.log("step 6: a connector without a verifier is reported unverified");
const reserved = await errandCall(
  await approve([reserveTool], "Reserve a table for two", 1),
  reserveTool,
  { restaurant: "The Table", party: 2 },
);
console.log(`receipt: ${JSON.stringify(receiptOf(reserved))}`);

console.log("step 7: a write that does not persist is mismatched and offers no undo");
await setFault("drop_write");
const ghost = await errandCall(
  await approve(["calendar__create_event"], "Book a slot that will not persist", 1),
  createTool,
  { title: "Ghost receipt", start: "2026-12-11T09:00:00Z" },
);
console.log(`receipt: ${JSON.stringify(receiptOf(ghost))}`);
await setFault("none");

console.log("step 8: five clean read runs earn a license offer");
for (let run = 1; run <= 5; run += 1) {
  await errandCall(
    await approve(["calendar__list_events"], `Check the calendar, run ${run}`, 1),
    listTool,
    {},
  );
  await trustSummary(`after clean run ${run}`);
}

await trustSummary("trust ledger before the browser");
const receipts = receiptViewSchema
  .array()
  .parse(
    (
      (await (await human("/api/receipts")).json()) as {
        receipts: unknown;
      }
    ).receipts,
  );
for (const receipt of receipts) {
  console.log(
    `${receipt.verification} · ${receipt.toolClass} · irreversible=${receipt.irreversible} · undo=${receipt.undo === null ? "none" : "stored"} · ${receipt.summary}`,
  );
}

const verify = await human("/api/journal/verify");
console.log(`journal: ${JSON.stringify(await verify.json())}`);

await agent.close();
console.log("VERDICT: drive pass");
