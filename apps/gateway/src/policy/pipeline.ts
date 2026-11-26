import type { ToolClass } from "@errand/shared";
import type { Db } from "../db/client.ts";
import { getConnector, getSlip } from "../db/scoped-reads.ts";
import { listCatalog } from "../connectors/catalog.ts";
import { parseSlipTools, type SlipTool } from "../agent/slip-tools.ts";
import { isDecoyToolName } from "./decoys.ts";
import { checkArguments } from "./arguments.ts";
import { checkConstraints } from "./constraints.ts";
import { checkCapability, type CapabilityFailure } from "./capability.ts";
import { verifySlipSignature } from "./slip-signing.ts";
import { reserveCall, type ReservationFailure } from "./reservation.ts";
import { spendRequestCents } from "./spend.ts";

export type CallDenialReason =
  | CapabilityFailure
  | "not_found"
  | "signing_unavailable"
  | "signature_invalid"
  | "decoy"
  | "out_of_scope"
  | "tool_unavailable"
  | "connector_unhealthy"
  | "unknown_class"
  | "class_mismatch"
  | "invalid_arguments"
  | "invalid_constraints"
  | "missing_allowlist"
  | "constraint_denied"
  | "invalid_spend_amount"
  | "call_cap_reached"
  | "spend_cap_exceeded"
  | "rate_limited";

export type CallInput = {
  slipId: string;
  tool: string;
  capability: string;
  arguments: Record<string, unknown>;
};

// `unknown` is denied before admission, so an admitted call always has a class
// the forwarder can route.
export type ForwardableClass = Exclude<ToolClass, "unknown">;

export type CallDecision =
  | {
      outcome: "admitted";
      slipId: string;
      tool: string;
      connectorId: string;
      upstreamTool: string;
      class: ForwardableClass;
      amountCents: number;
      callsRemaining: number;
      spendRemainingCents: number;
    }
  | { outcome: "denied"; reason: CallDenialReason; message: string };

export type CallOptions = {
  now?: Date;
  hmacKey?: string | undefined;
};

function deny(reason: CallDenialReason, message: string): CallDecision {
  return { outcome: "denied", reason, message };
}

function capabilityMessage(reason: CapabilityFailure, slipId: string): string {
  if (reason === "not_approved") return `Slip ${slipId} is not approved yet`;
  if (reason === "slip_denied") return `Slip ${slipId} was denied`;
  if (reason === "expired") return `Slip ${slipId} has expired`;
  if (reason === "burned") return `Slip ${slipId} has been burned`;
  return "The capability does not admit this call";
}

// The ordered deny table from the brief, steps 1-11. Nothing here forwards;
// admission ends at the atomic cap reservation.
export function admitCall(
  db: Db,
  userId: string,
  input: CallInput,
  options: CallOptions = {},
): CallDecision {
  const now = options.now ?? new Date();

  const slip = getSlip(db, userId, input.slipId);
  if (slip === undefined) return deny("not_found", `No slip ${input.slipId} for this agent key`);
  if (options.hmacKey === undefined) {
    return deny("signing_unavailable", "Slip signing is not configured on this gateway");
  }

  const capability = checkCapability(slip, input.capability, options.hmacKey, now);
  if (!capability.ok) return deny(capability.reason, capabilityMessage(capability.reason, slip.id));

  if (!verifySlipSignature(slip, options.hmacKey)) {
    return deny("signature_invalid", `Slip ${slip.id} does not match its signature`);
  }

  if (isDecoyToolName(input.tool)) {
    return deny("decoy", `${input.tool} is bait and was refused`);
  }

  const slipTool: SlipTool | undefined = parseSlipTools(slip.tools).find(
    (entry) => entry.name === input.tool,
  );
  if (slipTool === undefined) {
    return deny("out_of_scope", `${input.tool} is not in slip ${slip.id}`);
  }

  const tool = listCatalog(db, userId).find(
    (entry) => entry.agentName === input.tool && entry.connectorId === slipTool.connectorId,
  );
  if (tool === undefined || tool.state === "changed" || tool.state === "removed") {
    return deny("tool_unavailable", `${input.tool} is not available to call`);
  }

  const connector = getConnector(db, userId, slipTool.connectorId);
  if (connector === undefined || connector.authStatus !== "active") {
    return deny("connector_unhealthy", `The connector for ${input.tool} is not healthy`);
  }

  if (slipTool.class === "unknown" || tool.class === "unknown") {
    return deny("unknown_class", `${input.tool} has no usable class`);
  }
  if (slipTool.class !== tool.class) {
    return deny("class_mismatch", `${input.tool} is no longer class ${slipTool.class}`);
  }

  const argumentsCheck = checkArguments(tool.inputSchema, input.arguments);
  if (!argumentsCheck.ok) return deny("invalid_arguments", argumentsCheck.message);

  const constraintsCheck = checkConstraints(
    slip.constraints,
    input.tool,
    slipTool.class,
    input.arguments,
  );
  if (!constraintsCheck.ok) return deny(constraintsCheck.reason, constraintsCheck.message);

  const amountCents =
    slipTool.class === "spend" ? spendRequestCents(input.arguments) : 0;
  if (amountCents === undefined) {
    return deny("invalid_spend_amount", "A spend call needs an integer cents amount");
  }

  const reservation = reserveCall(db, {
    userId,
    slipId: slip.id,
    amountCents,
    now,
  });
  if (!reservation.ok) {
    const messages: Record<ReservationFailure, string> = {
      call_cap_reached: `Slip ${slip.id} has used all ${slip.callCap} calls`,
      spend_cap_exceeded: `Slip ${slip.id} cannot spend ${amountCents} more cents`,
      rate_limited: `Slip ${slip.id} is calling faster than ${slip.rateCap} calls per minute`,
      not_approved: `Slip ${slip.id} is no longer approved`,
    };
    return deny(reservation.reason, messages[reservation.reason]);
  }

  return {
    outcome: "admitted",
    slipId: slip.id,
    tool: input.tool,
    connectorId: tool.connectorId,
    upstreamTool: tool.name,
    class: slipTool.class,
    amountCents,
    callsRemaining: reservation.callsRemaining,
    spendRemainingCents: reservation.spendRemainingCents,
  };
}
