import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.ts";
import { appendJournalEvent } from "../db/journal.ts";
import { slips, type Tier } from "../db/schema.ts";
import { listCatalog } from "../connectors/catalog.ts";
import { isRequestableTool } from "./catalog.ts";
import { isDecoyToolName } from "../policy/decoys.ts";
import { errandTypeFor } from "../policy/errand-type.ts";
import { AGENT_LIMITS, resolveLimits, type ClampedLimit, type RequestedLimits } from "./limits.ts";
import type { SlipTool } from "./slip-tools.ts";

export type RequestErrandInput = {
  goal: string;
  tools: string[];
  limits?: RequestedLimits;
};

export type RequestErrandResult = {
  slipId: string;
  state: "pending";
  tier: Tier;
  tools: SlipTool[];
  callCap: number;
  spendCapCents: number;
  expiresAt: string;
  clamped: ClampedLimit[];
};

export type ErrandRequestErrorCode = "invalid_goal" | "unknown_tool" | "decoy";

export class ErrandRequestError extends Error {
  constructor(
    readonly code: ErrandRequestErrorCode,
    message: string,
    readonly tool?: string,
  ) {
    super(message);
    this.name = "ErrandRequestError";
  }
}

export function requestErrand(
  db: Db,
  userId: string,
  input: RequestErrandInput,
  now = new Date(),
): RequestErrandResult {
  const goal = input.goal.trim();
  if (goal === "") {
    throw new ErrandRequestError("invalid_goal", "An errand needs a goal");
  }

  const catalog = new Map(listCatalog(db, userId).map((tool) => [tool.agentName, tool]));
  const tools: SlipTool[] = input.tools.map((name) => {
    if (isDecoyToolName(name)) {
      throw new ErrandRequestError("decoy", `${name} is bait and can never be requested`, name);
    }
    const tool = catalog.get(name);
    if (tool === undefined || !isRequestableTool(tool)) {
      throw new ErrandRequestError("unknown_tool", `${name} is not requestable`, name);
    }
    return { name: tool.agentName, connectorId: tool.connectorId, class: tool.class };
  });

  const limits = resolveLimits(input.limits ?? {});
  const expiresAt = new Date(now.getTime() + limits.minutes * 60_000).toISOString();
  const id = randomUUID();
  const errandType = errandTypeFor(
    tools.map((tool) => tool.name),
    [],
  );

  db.insert(slips)
    .values({
      id,
      userId,
      errandType,
      goal,
      state: "pending",
      tier: "learner",
      tools: JSON.stringify(tools),
      constraints: "{}",
      callCap: limits.callCap,
      rateCap: AGENT_LIMITS.callsPerMinute,
      spendCapCents: limits.spendCapCents,
      expiresAt,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    .run();

  appendJournalEvent(db, {
    userId,
    eventType: "slip.requested",
    payload: {
      slip_id: id,
      errand_type: errandType,
      goal,
      tools: tools.map((tool) => tool.name),
      call_cap: limits.callCap,
      spend_cap_cents: limits.spendCapCents,
      expires_at: expiresAt,
      tier: "learner",
      clamped: limits.clamped,
    },
  });

  return {
    slipId: id,
    state: "pending",
    tier: "learner",
    tools,
    callCap: limits.callCap,
    spendCapCents: limits.spendCapCents,
    expiresAt,
    clamped: limits.clamped,
  };
}
