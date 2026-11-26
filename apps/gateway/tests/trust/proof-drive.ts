import { z } from "zod";
import { MOCK_AUTH, MOCK_PATHS } from "@errand/mock-services";
import { callTool as rawCallTool, connectAgent } from "../agent/mcp-client.ts";
import { humanRequests, parse, step } from "../support/proof-drive.ts";

const BASE = process.env.GATEWAY_URL ?? "http://127.0.0.1:8887";
const MOCK = process.env.MOCK_URL ?? "http://127.0.0.1:4101";
const PASSPHRASE = process.env.OWNER_PASSPHRASE ?? "errand-proof-passphrase";
const CAPS = { callCap: 2, spendCapCents: 0, minutes: 5 };

const requestSchema = z.object({
  slipId: z.string(),
  state: z.string(),
  tier: z.string(),
  callCap: z.number(),
  spendCapCents: z.number(),
});
const statusSchema = z.object({
  capability: z.string().nullable(),
  state: z.string(),
  tier: z.string(),
  callCap: z.number(),
  spendCapCents: z.number(),
});
const trustEntrySchema = z.object({
  errandType: z.string(),
  tier: z.string(),
  cleanRuns: z.number(),
  licenseOffered: z.boolean(),
  caps: z.unknown().nullable(),
});
const trustListSchema = z.object({ trust: z.array(trustEntrySchema) });
const slipDetailSchema = z.object({ slip: z.object({ errandType: z.string() }) });
const connectorSchema = z.object({ connector: z.object({ id: z.string(), name: z.string() }) });
const sessionSchema = z.object({ authenticated: z.boolean(), user: z.unknown() });
const keySchema = z.object({ key: z.string() });
const acceptedSchema = z.object({ trust: trustEntrySchema });
const undoSchema = z.object({ verification: z.string() });
const journalSchema = z.object({ ok: z.boolean(), checked: z.number().optional() });
const callBodySchema = z.object({
  state: z.string().optional(),
  error: z.string().optional(),
  receipt: z.object({ id: z.string(), verification: z.string() }).optional(),
});

let human = humanRequests(BASE, "");
let client: Awaited<ReturnType<typeof connectAgent>> | undefined;

function show(label: string, value: unknown): void {
  console.log(`${label}: ${JSON.stringify(value, null, 2)}`);
}

function requireOk(response: Response, label: string): void {
  if (!response.ok) throw new Error(`${label} returned ${response.status}`);
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ result: { isError?: boolean | undefined }; body: unknown }> {
  if (client === undefined) throw new Error("the MCP client is not connected");
  const { result, body } = await rawCallTool(client, name, args);
  return { result, body };
}

async function trustOf(errandType: string) {
  const trust = (await parse(await human("/api/trust"), trustListSchema)).trust;
  return trust.find((entry) => entry.errandType === errandType);
}

async function approve(slipId: string): Promise<void> {
  requireOk(
    await human(`/api/slips/${slipId}/approve`, { method: "POST", body: "{}" }),
    `approve ${slipId}`,
  );
}

async function capabilityFor(slipId: string): Promise<string> {
  const status = await callTool("errand_status", { slip_id: slipId });
  const parsed = statusSchema.parse(status.body);
  if (parsed.capability === null) throw new Error(`slip ${slipId} has no capability`);
  return parsed.capability;
}

async function request(tools: string[], limits?: Record<string, number>) {
  const response = await callTool("request_errand", {
    goal: "A proof errand whose wording must not change its type",
    tools,
    ...(limits === undefined ? {} : { limits }),
  });
  if (response.result.isError === true) throw new Error(JSON.stringify(response.body));
  return requestSchema.parse(response.body);
}

async function call(slipId: string, tool: string, args: Record<string, unknown>) {
  const capability = await capabilityFor(slipId);
  const response = await callTool("errand_call", {
    slip_id: slipId,
    tool,
    capability,
    arguments: args,
  });
  return { ...response, parsed: callBodySchema.parse(response.body) };
}

async function cleanRun(tool: string, args: Record<string, unknown>) {
  const requested = await request([tool], { calls: 1, minutes: 1 });
  if (requested.state !== "pending") throw new Error(`a learner run auto-approved: ${JSON.stringify(requested)}`);
  await approve(requested.slipId);
  const response = await call(requested.slipId, tool, args);
  if (response.result.isError === true) throw new Error(JSON.stringify(response.body));
  return { slipId: requested.slipId, response };
}

async function fiveCleanRuns(tool: string, args: (run: number) => Record<string, unknown>) {
  for (let run = 1; run <= 5; run++) {
    await cleanRun(tool, args(run));
    console.log(`clean run ${run}/5 recorded for ${tool}`);
  }
}

async function errandTypeOf(tools: string[]): Promise<string> {
  const requested = await request(tools);
  return (await parse(await human(`/api/slips/${requested.slipId}`), slipDetailSchema)).slip.errandType;
}

async function main(): Promise<void> {
  step("sign in as the owner");
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passphrase: PASSPHRASE }),
  });
  requireOk(login, "login");
  const sessionCookie = (login.headers.getSetCookie()[0] ?? "").split(";")[0] ?? "";
  human = humanRequests(BASE, sessionCookie);
  show("session", await parse(await human("/api/auth/session"), sessionSchema));

  step("connect the mock calendar with a vaulted bearer credential");
  show(
    "connector",
    (
      await parse(
        await human("/api/connectors", {
          method: "POST",
          body: JSON.stringify({
            name: "Calendar",
            url: `${MOCK}${MOCK_PATHS.calendarSecure}`,
            authType: "bearer",
            token: MOCK_AUTH.calendarBearer,
          }),
        }),
        connectorSchema,
      )
    ).connector,
  );

  step("issue an agent key and attach the real MCP client");
  const key = (
    await parse(
      await human("/api/agent-keys", {
        method: "POST",
        body: JSON.stringify({ name: "proof agent" }),
      }),
      keySchema,
    )
  ).key;
  client = await connectAgent(BASE, key);

  step("a new errand type starts on a learner permit");
  const readType = await errandTypeOf(["calendar__list_events"]);
  show("trust after first request", await trustOf(readType));

  step("five consecutive clean runs earn a license offer");
  await fiveCleanRuns("calendar__list_events", () => ({}));
  const offered = await trustOf(readType);
  show("trust after five clean runs", offered);
  if (offered?.licenseOffered !== true || offered?.cleanRuns !== 5) {
    throw new Error("five clean runs did not offer a license");
  }

  step("the human accepts with caps they choose");
  show(
    "trust after accepting",
    (
      await parse(
        await human(`/api/trust/${readType}/license`, {
          method: "POST",
          body: JSON.stringify(CAPS),
        }),
        acceptedSchema,
      )
    ).trust,
  );

  step("a licensed request is auto-approved and clamped to the human's caps");
  const licensed = await request(["calendar__list_events"], {
    calls: 40,
    spend_cents: 15_000,
    minutes: 25,
  });
  show("auto-approved request", licensed);
  if (licensed.state !== "approved" || licensed.tier !== "license") {
    throw new Error("a licensed request was not auto-approved");
  }
  if (licensed.callCap !== CAPS.callCap || licensed.spendCapCents !== CAPS.spendCapCents) {
    throw new Error("licensed caps did not clamp the request");
  }
  const status = await callTool("errand_status", { slip_id: licensed.slipId });
  const statusView = statusSchema.parse(status.body);
  show("status without a human approval", {
    state: statusView.state,
    tier: statusView.tier,
    capability: statusView.capability === null ? null : "<issued>",
    callCap: statusView.callCap,
    spendCapCents: statusView.spendCapCents,
  });

  step("a call outside the licensed slip demotes the type");
  const outOfScope = await call(licensed.slipId, "calendar__create_event", {
    title: "Not on this slip",
    start: "2026-12-20T10:00:00Z",
  });
  show("out-of-scope refusal", outOfScope.parsed);
  show("trust after the scope violation", await trustOf(readType));

  step("writes run on a learner permit until they earn their own license");
  const writeType = await errandTypeOf(["calendar__create_event"]);
  await fiveCleanRuns("calendar__create_event", (run) => ({
    title: `Earned trust ${run}`,
    start: `2026-12-2${run}T18:00:00Z`,
  }));
  show("write trust after five clean runs", await trustOf(writeType));
  requireOk(
    await human(`/api/trust/${writeType}/license`, {
      method: "POST",
      body: JSON.stringify({ callCap: 3, spendCapCents: 0, minutes: 5 }),
    }),
    "accept write license",
  );

  step("an undo demotes the type and journals the reason");
  const wrote = await request(["calendar__create_event"], { calls: 1, minutes: 1 });
  const created = await call(wrote.slipId, "calendar__create_event", {
    title: "Undo this",
    start: "2026-12-19T18:00:00Z",
  });
  if (created.parsed.receipt === undefined) throw new Error("the write produced no receipt");
  show(
    "undo result",
    (
      await parse(
        await human(`/api/receipts/${created.parsed.receipt.id}/undo`, { method: "POST" }),
        undoSchema,
      )
    ).verification,
  );
  show("trust after the undo", await trustOf(writeType));

  step("re-earn the license, then a forced mismatch demotes again");
  await fiveCleanRuns("calendar__create_event", (run) => ({
    title: `Reearned trust ${run}`,
    start: `2026-12-3${run}T18:00:00Z`,
  }));
  requireOk(
    await human(`/api/trust/${writeType}/license`, {
      method: "POST",
      body: JSON.stringify({ callCap: 3, spendCapCents: 0, minutes: 5 }),
    }),
    "re-accept write license",
  );
  await fetch(`${MOCK}/mock/calendar/fault`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "drop_write" }),
  });
  const ghostSlip = await request(["calendar__create_event"], { calls: 1, minutes: 1 });
  const ghost = await call(ghostSlip.slipId, "calendar__create_event", {
    title: "Ghost event",
    start: "2026-12-29T09:00:00Z",
  });
  show("verifier verdict", ghost.parsed.receipt?.verification ?? "no receipt");
  await fetch(`${MOCK}/mock/calendar/fault`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "none" }),
  });
  show("trust after the mismatch", await trustOf(writeType));

  step("the journal is still a valid hash chain");
  const verified = await parse(await human("/api/journal/verify"), journalSchema);
  show("journal verify", verified);
  if (verified.ok !== true) throw new Error("the journal chain is broken");
  console.log("\nPROOF DRIVE COMPLETE");
}

try {
  await main();
} finally {
  await client?.close();
}
