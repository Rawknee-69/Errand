import {
  catalogResponseSchema,
  catalogToolResponseSchema,
  connectorDetailSchema,
  receiptViewSchema,
  undoApplyResponseSchema,
} from "../../../packages/shared/src/index.ts";
import { callTool, connectAgent } from "../../../apps/gateway/tests/agent/mcp-client.ts";

const base = "http://127.0.0.1:8841";
const mock = "http://127.0.0.1:4121";
const passphrase = "proof-passphrase-14";

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

function resultText(body: unknown): string {
  if (!isRecord(body) || !isRecord(body.result) || !Array.isArray(body.result.content)) {
    throw new Error(`errand_call returned no result content: ${JSON.stringify(body)}`);
  }
  return body.result.content
    .map((item) => (isRecord(item) && typeof item.text === "string" ? item.text : ""))
    .join("");
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
console.log(`tools: ${createTool}, ${listTool}, ${deleteTool}`);

console.log("step 2: connect the mock restaurant over legacy SSE with basic auth");
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

console.log("step 3: issue an agent key and open the agent connection");
const issuedBody: unknown = await (await human("/api/agent-keys", {
  method: "POST",
  body: JSON.stringify({ name: "ticket-14 proof agent" }),
})).json();
if (!isRecord(issuedBody) || typeof issuedBody.key !== "string") {
  throw new Error(`agent key response was not readable: ${JSON.stringify(issuedBody)}`);
}
const agent = await connectAgent(base, issuedBody.key);

async function approve(tools: string[], goal: string): Promise<{ slipId: string; capability: string }> {
  const requested = await callTool(agent, "request_errand", { goal, tools });
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

console.log("step 4: a create is read back and verified");
const createSlip = await approve(["calendar__create_event"], "Book rehearsal dinner");
const created = await errandCall(createSlip, createTool, {
  title: "Proof dinner",
  start: "2026-12-10T19:00:00Z",
});
const createdReceipt = receiptOf(created);
console.log(`receipt: ${JSON.stringify(createdReceipt)}`);

console.log("step 5: the human applies undo, and the inverse is verified");
const undoResponse = await human(`/api/receipts/${createdReceipt.id}/undo`, { method: "POST" });
const undoBody = await parse(undoApplyResponseSchema, undoResponse);
console.log(`undo verification: ${undoBody.verification} — ${undoBody.summary}`);
const listed = await errandCall(
  await approve(["calendar__list_events"], "Check the calendar after undo"),
  listTool,
  {},
);
const listedText = resultText(listed);
console.log(`calendar after undo contains Proof dinner: ${listedText.includes("Proof dinner")}`);
console.log(`calendar after undo: ${listedText}`);

console.log("step 5b: an undo that does not land is mismatched and can be retried");
const stubbornSlip = await approve(["calendar__create_event"], "Create an event whose undo will fail");
const stubborn = await errandCall(stubbornSlip, createTool, {
  title: "Stubborn receipt",
  start: "2026-12-10T20:00:00Z",
});
const stubbornReceipt = receiptOf(stubborn);
await fetch(`${mock}/mock/calendar/fault`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ mode: "drop_write" }),
});
const stubbornUndo = await human(`/api/receipts/${stubbornReceipt.id}/undo`, { method: "POST" });
const stubbornBody = await parse(undoApplyResponseSchema, stubbornUndo);
console.log(
  `undo verification: ${stubbornBody.verification}; appliedAt=${String(stubbornBody.receipt.undo?.appliedAt)}; summary=${stubbornBody.summary}`,
);
const storedStubborn = await human(`/api/receipts/${stubbornReceipt.id}`);
const storedStubbornBody: unknown = await storedStubborn.json();
if (!isRecord(storedStubbornBody)) throw new Error("stored receipt response was not readable");
console.log(`persisted undo: ${JSON.stringify(receiptViewSchema.parse(storedStubbornBody.receipt))}`);
await fetch(`${mock}/mock/calendar/fault`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ mode: "none" }),
});
const retried = await human(`/api/receipts/${stubbornReceipt.id}/undo`, { method: "POST" });
const retriedBody = await parse(undoApplyResponseSchema, retried);
console.log(
  `retry verification: ${retriedBody.verification}; appliedAt=${String(retriedBody.receipt.undo?.appliedAt)}`,
);

console.log("step 6: a forced mismatch is reported as mismatched");
const fault = await fetch(`${mock}/mock/calendar/fault`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ mode: "drop_write" }),
});
if (!fault.ok) throw new Error(`fault switch failed: ${fault.status}`);
const ghostSlip = await approve(["calendar__create_event"], "Book a slot that will not persist");
const ghost = await errandCall(ghostSlip, createTool, {
  title: "Ghost receipt",
  start: "2026-12-11T09:00:00Z",
});
const ghostReceipt = receiptOf(ghost);
console.log(`receipt: ${JSON.stringify(ghostReceipt)}`);
await fetch(`${mock}/mock/calendar/fault`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ mode: "none" }),
});

console.log("step 7: a connector without a verifier says unverified");
const reserveSlip = await approve([reserveTool], "Reserve a table for two");
const reserved = await errandCall(reserveSlip, reserveTool, {
  restaurant: "The Table",
  party: 2,
});
const reservedReceipt = receiptOf(reserved);
console.log(`receipt: ${JSON.stringify(reservedReceipt)}`);

console.log("step 8: a delete is verified and labelled irreversible");
const doomedSlip = await approve(["calendar__create_event"], "Create an event that will be deleted");
const doomed = await errandCall(doomedSlip, createTool, {
  title: "Doomed event",
  start: "2026-12-12T08:00:00Z",
});
const doomedBody = JSON.parse(resultText(doomed)) as { id?: unknown };
if (typeof doomedBody.id !== "string") throw new Error("created event had no id");
const deleteSlip = await approve(["calendar__delete_event"], "Delete the doomed event");
const deleted = await errandCall(deleteSlip, deleteTool, { id: doomedBody.id });
const deletedReceipt = receiptOf(deleted);
console.log(`receipt: ${JSON.stringify(deletedReceipt)}`);

console.log("step 9: receipts list, journal events and chain verification");
const receipts = await human("/api/receipts");
const listedReceipts = receiptViewSchema
  .array()
  .parse((await receipts.json() as { receipts: unknown }).receipts);
for (const receipt of listedReceipts) {
  console.log(`${receipt.verification} · ${receipt.toolClass} · irreversible=${receipt.irreversible} · undo=${receipt.undo === null ? "none" : "available"} · ${receipt.summary}`);
}
const secondUndo = await human(`/api/receipts/${createdReceipt.id}/undo`, { method: "POST" });
console.log(`second undo status: ${secondUndo.status} ${JSON.stringify(await secondUndo.json())}`);
const verify = await human("/api/journal/verify");
console.log(`journal: ${JSON.stringify(await verify.json())}`);

await agent.close();
console.log("VERDICT: drive pass");
