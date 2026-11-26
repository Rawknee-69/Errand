import type { Db } from "../db/client.ts";
import { appendJournalEvent } from "../db/journal.ts";
import { admitCall, type CallDecision, type CallInput, type CallOptions } from "../policy/pipeline.ts";

// The decision boundary: every admission and every denial reaches the journal
// with its reason, in one place.
export function submitCall(
  db: Db,
  userId: string,
  input: CallInput,
  options: CallOptions = {},
): CallDecision {
  const decision = admitCall(db, userId, input, options);
  appendJournalEvent(db, {
    userId,
    eventType:
      decision.outcome === "admitted"
        ? "call.allowed"
        : decision.reason === "out_of_scope"
          ? "call.scope_violation"
          : "call.denied",
    payload:
      decision.outcome === "admitted"
        ? {
            slip_id: decision.slipId,
            tool: decision.tool,
            connector_id: decision.connectorId,
            reason: "admitted",
            amount_cents: decision.amountCents,
            calls_remaining: decision.callsRemaining,
            spend_remaining_cents: decision.spendRemainingCents,
          }
        : {
            slip_id: input.slipId,
            tool: input.tool,
            reason: decision.reason,
          },
  });
  return decision;
}
