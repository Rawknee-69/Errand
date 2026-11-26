import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.ts";
import { recordEvent } from "../db/events.ts";
import { slips, type Tier } from "../db/schema.ts";
import { listCatalog } from "../connectors/catalog.ts";
import { isRequestableTool } from "./catalog.ts";
import { isDecoyToolName } from "../policy/decoys.ts";
import { errandTypeFor } from "../policy/errand-type.ts";
import { ensureLearnerTrust, parseTrustCaps, settleRuns } from "../policy/trust.ts";
import { approveSlip } from "../slips/approval.ts";
import { AGENT_LIMITS, type LimitClamp } from "@errand/shared";
import {
  clampToCeiling,
  tighten,
  type RequestedLimits,
  type SlipCaps,
} from "../slips/caps.ts";
import type { SlipTool } from "./slip-tools.ts";

export type RequestErrandInput = {
  goal: string;
  tools: string[];
  limits?: RequestedLimits;
};

export type RequestErrandResult = {
  slipId: string;
  state: "pending" | "approved";
  tier: Tier;
  tools: SlipTool[];
  callCap: number;
  spendCapCents: number;
  expiresAt: string;
  clamped: LimitClamp[];
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
  hmacKey?: string,
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

  const limits = clampToCeiling(input.limits ?? {});
  const id = randomUUID();
  const errandType = errandTypeFor(
    tools.map((tool) => tool.name),
    [],
  );
  settleRuns(db, userId, now);
  const trustRow = ensureLearnerTrust(db, userId, errandType, now);
  const licenseCaps = trustRow.tier === "license" ? parseTrustCaps(trustRow.caps) : null;
  // A license needs a signing key; without one the slip waits for a human.
  const autoApproved = licenseCaps !== null && hmacKey !== undefined;
  const applied: SlipCaps =
    autoApproved && licenseCaps !== null ? tighten(limits, licenseCaps) : limits;
  const tier: Tier = autoApproved ? "license" : "learner";
  const expiresAt = new Date(now.getTime() + applied.minutes * 60_000).toISOString();

  db.insert(slips)
    .values({
      id,
      userId,
      errandType,
      goal,
      state: "pending",
      tier,
      tools: JSON.stringify(tools),
      constraints: "{}",
      callCap: applied.callCap,
      rateCap: AGENT_LIMITS.callsPerMinute,
      spendCapCents: applied.spendCapCents,
      expiresAt,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    .run();

  recordEvent(db, {
    userId,
    eventType: "slip.requested",
    payload: {
      slip_id: id,
      errand_type: errandType,
      goal,
      tools: tools.map((tool) => tool.name),
      call_cap: applied.callCap,
      spend_cap_cents: applied.spendCapCents,
      expires_at: expiresAt,
      tier,
      auto_approved: autoApproved,
      clamped: limits.clamped,
    },
  });

  if (autoApproved && licenseCaps !== null) {
    approveSlip(db, userId, id, {}, { now, hmacKey });
    recordEvent(db, {
      userId,
      eventType: "trust.license_used",
      payload: {
        slip_id: id,
        errand_type: errandType,
        caps: licenseCaps,
        call_cap: applied.callCap,
        spend_cap_cents: applied.spendCapCents,
      },
    });
  }

  return {
    slipId: id,
    state: autoApproved ? "approved" : "pending",
    tier,
    tools,
    callCap: applied.callCap,
    spendCapCents: applied.spendCapCents,
    expiresAt,
    clamped: limits.clamped,
  };
}
