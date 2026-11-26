import type { Db } from "../db/client.ts";
import { getSlip } from "../db/scoped-reads.ts";
import { parseSlipTools } from "./slip-tools.ts";

export type AcknowledgedCall =
  | {
      state: "not_forwarded";
      slipId: string;
      tool: string;
      reason: "awaiting_approval" | "policy_pipeline_not_installed";
    }
  | { state: "out_of_scope"; slipId: string; tool: string }
  | undefined;

// The reachable surface stops at requesting in this phase. A call naming a
// tool inside a slip this user owns is acknowledged; nothing is ever sent
// upstream from here.
export function acknowledgeCall(
  db: Db,
  userId: string,
  slipId: string,
  tool: string,
): AcknowledgedCall {
  const slip = getSlip(db, userId, slipId);
  if (slip === undefined) return undefined;
  if (!parseSlipTools(slip.tools).some((entry) => entry.name === tool)) {
    return { state: "out_of_scope", slipId, tool };
  }
  return {
    state: "not_forwarded",
    slipId,
    tool,
    reason: slip.state === "pending" ? "awaiting_approval" : "policy_pipeline_not_installed",
  };
}
