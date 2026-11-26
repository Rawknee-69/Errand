import type { Db } from "../db/client.ts";
import { getSlip } from "../db/scoped-reads.ts";

export type ErrandCallResult =
  | {
      state: "not_forwarded";
      slipId: string;
      tool: string;
      reason: "awaiting_approval" | "policy_pipeline_not_installed";
    }
  | undefined;

// The reachable surface stops at requesting in this phase. A call that names a
// slip this user owns is acknowledged and journaled by the policy pipeline
// ticket; nothing is ever sent upstream from here.
export function callErrand(
  db: Db,
  userId: string,
  slipId: string,
  tool: string,
): ErrandCallResult {
  const slip = getSlip(db, userId, slipId);
  if (slip === undefined) return undefined;
  return {
    state: "not_forwarded",
    slipId,
    tool,
    reason: slip.state === "pending" ? "awaiting_approval" : "policy_pipeline_not_installed",
  };
}
