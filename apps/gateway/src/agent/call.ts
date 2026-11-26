import type { Db } from "../db/client.ts";
import { recordEvent } from "../db/events.ts";
import { recordViolation } from "../policy/burn.ts";
import { admitCall, type CallDecision, type CallInput, type CallOptions } from "../policy/pipeline.ts";

// The decision boundary: admissions and non-violation denials journal here;
// a violation journals with its burn in recordViolation.
export function submitCall(
  db: Db,
  userId: string,
  input: CallInput,
  options: CallOptions = {},
): CallDecision {
  const decision = admitCall(db, userId, input, options);

  if (
    decision.outcome === "denied" &&
    (decision.reason === "decoy" || decision.reason === "out_of_scope")
  ) {
    const violation = recordViolation(db, {
      userId,
      slipId: input.slipId,
      tool: input.tool,
      reason: decision.reason,
      arguments: input.arguments,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    return violation.burned === null
      ? decision
      : { ...decision, burned: { reason: violation.burned, at: violation.burnedAt } };
  }

  if (decision.outcome === "admitted") {
    recordEvent(db, {
      userId,
      eventType: "call.allowed",
      payload: {
        slip_id: decision.slipId,
        tool: decision.tool,
        connector_id: decision.connectorId,
        reason: "admitted",
        arguments: input.arguments,
        amount_cents: decision.amountCents,
        calls_remaining: decision.callsRemaining,
        spend_remaining_cents: decision.spendRemainingCents,
      },
    });
  } else {
    recordEvent(db, {
      userId,
      eventType: "call.denied",
      payload: {
        slip_id: input.slipId,
        tool: input.tool,
        reason: decision.reason,
        arguments: input.arguments,
      },
    });
  }
  return decision;
}
