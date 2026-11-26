import { z } from "zod";
import {
  receiptViewSchema,
  slipApprovedSchema,
  slipDetailSchema,
  trustListResponseSchema,
  type ReceiptView,
} from "../../packages/shared/src/index.ts";
import { SETTLE_DINNER } from "../../apps/mock-services/src/server.ts";
import { callTool } from "../../apps/gateway/tests/agent/mcp-client.ts";
import { section } from "../demo-shared.ts";
import type { HumanApi } from "./api.ts";
import type { SettleFixtures } from "./fixtures.ts";

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
    capability: z.string().nullable(),
    callsRemaining: z.number(),
  })
  .passthrough();

const catalogSchema = z
  .object({
    tools: z.array(z.object({ name: z.string(), class: z.string() }).passthrough()),
    limits: z.object({ calls: z.number(), spendCents: z.number(), minutes: z.number() }),
  })
  .passthrough();

const forwardSchema = z.object({
  state: z.literal("forwarded"),
  tool: z.string(),
  class: z.string(),
  result: z.object({
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  }),
  receipt: receiptViewSchema.nullable().optional(),
});

const heldSchema = z.object({
  state: z.enum(["held", "needs_human"]),
  outboxId: z.string(),
  amountCents: z.number().optional(),
});

type Forwarded = z.infer<typeof forwardSchema>;
type Held = z.infer<typeof heldSchema>;

const denialSchema = z
  .object({
    error: z.string(),
    message: z.string().optional(),
    slip_state: z.string().optional(),
    burned_reason: z.string().nullable().optional(),
  })
  .passthrough();

const outboxItemSchema = z
  .object({
    id: z.string(),
    state: z.string(),
    amountCents: z.number(),
    tool: z.string(),
  })
  .passthrough();

const outboxListSchema = z.object({ items: z.array(outboxItemSchema) });
const receiptListSchema = z.object({ receipts: z.array(receiptViewSchema) });
const journalSchema = z.object({ ok: z.boolean(), checked: z.number() });
const boundarySchema = z
  .object({
    counts: z.object({
      connectors: z.number(),
      discovered: z.number(),
      visible: z.number(),
      hidden: z.number(),
    }),
  })
  .passthrough();

type Agent = SettleFixtures["owner"]["agent"];
type Requested = z.infer<typeof requestSchema>;

const CHILD_TOOL = "calendar__list_events";
const RESTAURANT_TOOL = "dine_out__search_restaurants";
const PAYMENT_TOOL = "pay__create_payment_links";
const EMAIL_TOOL = "email__list_messages";
const TRUST_TOOL = "calendar__create_event";

export type StoryOptions = {
  autoApprove: boolean;
  tapSpend: boolean;
  mock: string;
};

function textPayload(result: Forwarded["result"]): unknown {
  const text = result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("");
  return JSON.parse(text);
}

async function callErrand(
  agent: Agent,
  slipId: string,
  capability: string,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<Forwarded | Held> {
  const { body } = await callTool(agent, "errand_call", {
    slip_id: slipId,
    tool,
    capability,
    arguments: args,
  });
  const forward = forwardSchema.safeParse(body);
  if (forward.success) return forward.data;
  const held = heldSchema.safeParse(body);
  if (held.success) return held.data;
  const denied = denialSchema.parse(body);
  throw new Error(`${tool} was refused: ${denied.error} ${denied.message ?? ""}`);
}

async function approve(api: HumanApi, slipId: string): Promise<void> {
  await api.json(slipApprovedSchema, `/api/slips/${slipId}/approve`, {
    method: "POST",
    body: {},
  });
}

async function waitForDecision(api: HumanApi, slipId: string): Promise<void> {
  const detail = await api.json(slipDetailSchema, `/api/slips/${slipId}`);
  if (detail.slip.state !== "pending") return;
  console.log(`   waiting for the human tap on slip ${slipId}; approve or deny it in the panel`);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await Bun.sleep(2_000);
    const next = await api.json(slipDetailSchema, `/api/slips/${slipId}`);
    if (next.slip.state !== "pending") return;
  }
  throw new Error(`slip ${slipId} is still pending after three minutes`);
}

async function requestErrand(
  agent: Agent,
  goal: string,
  tools: string[],
  limits: { calls: number; spend_cents: number; minutes: number },
): Promise<Requested> {
  const { body } = await callTool(agent, "request_errand", { goal, tools, limits });
  return requestSchema.parse(body);
}

async function approveRequest(
  api: HumanApi,
  requested: Requested,
  auto: boolean,
): Promise<void> {
  if (requested.state === "approved") return;
  if (auto) {
    await approve(api, requested.slipId);
    console.log(`   approved slip ${requested.slipId} with callCap ${requested.callCap}`);
    return;
  }
  await waitForDecision(api, requested.slipId);
}

type OneCall = {
  agent: Agent;
  api: HumanApi;
  goal: string;
  tool: string;
  args?: Record<string, unknown>;
  calls?: number;
  spendCents?: number;
  minutes?: number;
  auto: boolean;
  onRequested?: (requested: Requested) => void;
};

async function runOneCall({
  agent,
  api,
  goal,
  tool,
  args = {},
  calls = 1,
  spendCents = 0,
  minutes = 15,
  auto,
  onRequested,
}: OneCall): Promise<{ requested: Requested; capability: string; result: Forwarded | Held }> {
  const requested = await requestErrand(agent, goal, [tool], {
    calls,
    spend_cents: spendCents,
    minutes,
  });
  onRequested?.(requested);
  await approveRequest(api, requested, auto);
  const capability = await capabilityFor(agent, requested.slipId);
  const result = await callErrand(agent, requested.slipId, capability, tool, args);
  return { requested, capability, result };
}

async function capabilityFor(agent: Agent, slipId: string): Promise<string> {
  const { body } = await callTool(agent, "errand_status", { slip_id: slipId });
  const status = statusSchema.parse(body);
  if (status.state !== "approved" || status.capability === null) {
    throw new Error(`slip ${slipId} is ${status.state}; no capability was issued`);
  }
  return status.capability;
}

const eventListSchema = z.array(z.object({ id: z.string(), title: z.string(), start: z.string() }));

function freeHour(events: Array<{ start: string }>): string {
  const busy = new Set(events.map((event) => new Date(event.start).getUTCHours()));
  for (let hour = SETTLE_DINNER.fromHour; hour < SETTLE_DINNER.toHour; hour++) {
    if (!busy.has(hour)) {
      return `${String(hour).padStart(2, "0")}:00–${String(hour + 1).padStart(2, "0")}:00`;
    }
  }
  throw new Error("The friends have no shared free hour for dinner");
}

function dinnerDate(): string {
  return new Date(`${SETTLE_DINNER.date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

async function readFriendCalendars(
  fixtures: SettleFixtures,
  options: StoryOptions,
): Promise<Array<{ friend: string; events: Array<{ id: string; title: string; start: string }> }>> {
  section("2. Three friends, three child slips");
  const calendars: Array<{
    friend: string;
    events: Array<{ id: string; title: string; start: string }>;
  }> = [];

  for (const [index, friend] of fixtures.friends.entries()) {
    const boundary = await friend.api.json(boundarySchema, "/api/boundary");
    console.log(
      `   ${friend.name}: ${boundary.counts.connectors} connector(s), ${boundary.counts.visible} visible, ${boundary.counts.hidden} hidden`,
    );
    const catalog = catalogSchema.parse(
      (await callTool(friend.agent, "errand_catalog")).body,
    );
    const names = catalog.tools.map((tool) => tool.name);
    if (!names.includes(CHILD_TOOL)) throw new Error(`${friend.name} cannot see ${CHILD_TOOL}`);
    console.log(`   ${friend.name}'s agent may name: ${names.join(", ")}`);

    const { result } = await runOneCall({
      agent: friend.agent,
      api: friend.api,
      goal: `Settle It · find a dinner time on ${friend.name}'s calendar`,
      tool: CHILD_TOOL,
      auto: options.autoApprove,
      onRequested: (requested) => {
        console.log(
          `   child slip ${index + 1}/3 for ${friend.name}: ${requested.slipId} (${requested.state})`,
        );
      },
    });
    if (!("result" in result)) throw new Error(`${CHILD_TOOL} was not forwarded`);
    calendars.push({ friend: friend.name, events: eventListSchema.parse(textPayload(result.result)) });
  }

  return calendars;
}

async function findRestaurant(fixtures: SettleFixtures, options: StoryOptions): Promise<string> {
  section("3. The restaurant");
  const { result } = await runOneCall({
    agent: fixtures.owner.agent,
    api: fixtures.owner.api,
    goal: "Settle It · find an Italian restaurant for three",
    tool: RESTAURANT_TOOL,
    args: { cuisine: "italian" },
    auto: options.autoApprove,
  });
  if (!("result" in result)) throw new Error("The restaurant search was not forwarded");
  const restaurants = z
    .array(z.object({ name: z.string(), cuisine: z.string(), openFrom: z.string() }))
    .parse(textPayload(result.result));
  const first = restaurants[0];
  if (first === undefined) throw new Error("The restaurant search returned nothing");
  console.log(`   ${first.name} (${first.cuisine}) opens at ${first.openFrom}`);
  return first.name;
}

async function waitForSpend(api: HumanApi, outboxId: string): Promise<void> {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const list = await api.json(outboxListSchema, "/api/outbox");
    const item = list.items.find((entry) => entry.id === outboxId);
    if (item === undefined) throw new Error(`Outbox item ${outboxId} disappeared`);
    if (item.state !== "needs_human") return;
    await Bun.sleep(2_000);
  }
  throw new Error("The spend tap did not arrive within five minutes");
}

async function splitPayment(
  fixtures: SettleFixtures,
  options: StoryOptions,
  restaurant: string,
  totalCents: number,
): Promise<void> {
  section("4. Split payment links, behind a human tap");
  const { requested, result } = await runOneCall({
    agent: fixtures.owner.agent,
    api: fixtures.owner.api,
    goal: "Settle It · create split payment links for dinner",
    tool: PAYMENT_TOOL,
    args: {
      cents: totalCents,
      people: fixtures.friends.map((friend) => friend.name),
      restaurant,
    },
    spendCents: totalCents,
    auto: options.autoApprove,
  });
  if (!("outboxId" in result)) {
    throw new Error(`Expected the spend to wait for a tap, got ${JSON.stringify(result)}`);
  }
  console.log(
    `   the gateway held the spend as ${result.state}: ${result.outboxId}, $${(result.amountCents ?? 0) / 100}`,
  );

  if (options.tapSpend) {
    await fixtures.owner.api.json(
      z.object({ item: outboxItemSchema }),
      `/api/outbox/${result.outboxId}/confirm`,
      { method: "POST", body: {} },
    );
  } else {
    console.log("   tap Confirm spend in the control panel; the script is waiting");
    await waitForSpend(fixtures.owner.api, result.outboxId);
  }

  const receipts = await fixtures.owner.api.json(receiptListSchema, "/api/receipts");
  const receipt = receipts.receipts.find((entry) => entry.slipId === requested.slipId);
  if (receipt === undefined) throw new Error("The split payment produced no receipt");
  printReceipt(receipt);
  if (receipt.verification !== "matched") {
    throw new Error(`The split payment receipt was ${receipt.verification}`);
  }
}

function printReceipt(receipt: ReceiptView): void {
  console.log(`   receipt ${receipt.id}: ${receipt.verification} — ${receipt.summary}`);
}

async function poisonedEmail(fixtures: SettleFixtures, options: StoryOptions): Promise<void> {
  section("5. The poisoned email");
  const { requested, capability, result } = await runOneCall({
    agent: fixtures.owner.agent,
    api: fixtures.owner.api,
    goal: "Settle It · read the dinner email",
    tool: EMAIL_TOOL,
    auto: options.autoApprove,
  });
  if (!("result" in result)) throw new Error("The inbox was not forwarded");
  const messages = z
    .array(z.object({ subject: z.string(), body: z.string() }))
    .parse(textPayload(result.result));
  const message = messages[0];
  if (message === undefined) throw new Error("The inbox is empty");
  console.log(`   ${message.subject}: ${message.body}`);
  console.log("   the agent follows the poisoned instruction and calls export_all_contacts");

  const { body } = await callTool(fixtures.owner.agent, "errand_call", {
    slip_id: requested.slipId,
    tool: "export_all_contacts",
    capability,
    arguments: {},
  });
  const denial = denialSchema.parse(body);
  if (denial.error !== "decoy" || denial.slip_state !== "burned") {
    throw new Error(`Expected a burn, got ${JSON.stringify(denial)}`);
  }
  const detail = await fixtures.owner.api.json(slipDetailSchema, `/api/slips/${requested.slipId}`);
  console.log(
    `   slip ${requested.slipId} is ${detail.slip.state}: ${detail.slip.burnedReason ?? "burned"} at ${detail.slip.burnedAt ?? "?"}`,
  );
}

async function promotionAndDemotion(fixtures: SettleFixtures, mock: string): Promise<void> {
  section("6. Learner to license, then a bad receipt returns it");
  let errandType: string | undefined;

  for (let run = 1; run <= 5; run++) {
    const { result } = await runOneCall({
      agent: fixtures.owner.agent,
      api: fixtures.owner.api,
      goal: `Settle It · clean calendar run ${run}`,
      tool: TRUST_TOOL,
      args: { title: `Settle It prep ${run}`, start: "2026-12-05T18:00:00Z" },
      minutes: 10,
      auto: true,
    });
    const receipt = "receipt" in result ? result.receipt : null;
    if (receipt === undefined || receipt === null) {
      throw new Error(`Clean run ${run} produced no receipt`);
    }
    if (receipt.verification !== "matched") {
      throw new Error(`Clean run ${run} was ${receipt.verification}`);
    }
    const trust = trustListResponseSchema.parse(
      await fixtures.owner.api.json(trustListResponseSchema, "/api/trust"),
    );
    const view = trust.trust.find((entry) => entry.tools.includes(TRUST_TOOL));
    if (view === undefined) throw new Error("The calendar-create errand type is missing");
    errandType = view.errandType;
    console.log(`   run ${run}: ${receipt.verification}, clean runs ${view.cleanRuns}`);
  }

  if (errandType === undefined) throw new Error("The errand type was never recorded");
  const offered = trustListResponseSchema.parse(
    await fixtures.owner.api.json(trustListResponseSchema, "/api/trust"),
  ).trust.find((entry) => entry.errandType === errandType);
  if (offered === undefined || !offered.licenseOffered) {
    throw new Error("Five clean runs did not offer a license");
  }
  console.log(`   license offered for ${errandType}`);

  const licensed = await fixtures.owner.api.json(
    z.object({ trust: z.object({ tier: z.string(), caps: z.unknown() }).passthrough() }),
    `/api/trust/${encodeURIComponent(errandType)}/license`,
    { method: "POST", body: { callCap: 2, spendCapCents: 0, minutes: 10 } },
  );
  console.log(`   accepted: tier ${licensed.trust.tier}, caps ${JSON.stringify(licensed.trust.caps)}`);

  await fetch(`${mock}/mock/calendar/fault`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "drop_write" }),
  });
  try {
    const { requested, result } = await runOneCall({
      agent: fixtures.owner.agent,
      api: fixtures.owner.api,
      goal: "Settle It · licensed calendar run that will not land",
      tool: TRUST_TOOL,
      args: { title: "Settle It · lost in the post", start: "2026-12-05T18:00:00Z" },
      minutes: 10,
      auto: true,
      onRequested: (issued) => {
        console.log(`   licensed request: ${issued.state}, tier ${issued.tier}`);
      },
    });
    if (requested.state !== "approved") throw new Error("The license did not auto-approve");
    const receipt = "receipt" in result ? result.receipt : null;
    if (receipt === undefined || receipt === null) {
      throw new Error("The bad run produced no receipt");
    }
    printReceipt(receipt);
    if (receipt.verification !== "mismatched") {
      throw new Error("The forced bad write was not mismatched");
    }
  } finally {
    await fetch(`${mock}/mock/calendar/fault`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "none" }),
    });
  }

  const demoted = trustListResponseSchema.parse(
    await fixtures.owner.api.json(trustListResponseSchema, "/api/trust"),
  ).trust.find((entry) => entry.errandType === errandType);
  if (demoted === undefined) throw new Error("The trust row vanished after demotion");
  console.log(`   after the bad receipt: tier ${demoted.tier}, clean runs ${demoted.cleanRuns}`);
  if (demoted.tier !== "learner" || demoted.cleanRuns !== 0) {
    throw new Error("A bad receipt did not demote the errand type");
  }
}

export async function runSettleIt(
  fixtures: SettleFixtures,
  options: StoryOptions,
): Promise<void> {
  console.log("");
  console.log("  SETTLE IT — three friends, one coordinator, one evening");
  console.log("  ----------------------------------------------------");

  section("1. The boundary");
  console.log(
    "   the coordinator agent opens one session per friend, using that friend's own key. No friend's calendar is visible to another.",
  );

  const calendars = await readFriendCalendars(fixtures, options);
  const shared = freeHour(calendars.flatMap((calendar) => calendar.events));
  section("2b. The shared time");
  for (const calendar of calendars) {
    console.log(
      `   ${calendar.friend}: ${calendar.events.map((event) => `${event.title} at ${event.start.slice(11, 16)}`).join(", ")}`,
    );
  }
  console.log(`   shared free hour: ${shared} UTC on ${dinnerDate()}`);

  const restaurant = await findRestaurant(fixtures, options);
  await splitPayment(fixtures, options, restaurant, 12_000);
  await poisonedEmail(fixtures, options);
  await promotionAndDemotion(fixtures, options.mock);

  section("7. The journal");
  const verified = journalSchema.parse(
    await fixtures.owner.api.json(journalSchema, "/api/journal/verify"),
  );
  if (!verified.ok) throw new Error("The journal chain is broken");
  console.log(`   chain intact, ${verified.checked} events checked`);
  console.log("");
  console.log("VERDICT: settle it pass — nothing real was ordered, paid or traded.");
}
