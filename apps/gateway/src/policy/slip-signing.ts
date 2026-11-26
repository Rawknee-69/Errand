import { createHmac, timingSafeEqual } from "node:crypto";
import type { SlipState, Tier } from "@errand/shared";
import { canonicalJson } from "../db/journal.ts";
import { parseSlipTools, type SlipTool } from "../agent/slip-tools.ts";

export type SlipRecord = {
  id: string;
  userId: string;
  errandType: string;
  goal: string;
  state: SlipState;
  tier: Tier;
  tools: string;
  constraints: string;
  callCap: number;
  spendCapCents: number;
  expiresAt: string;
  approvedAt: string | null;
  signature: string | null;
  capabilityHash: string | null;
};

export type SlipDocument = {
  slip_id: string;
  user_id: string;
  errand_type: string;
  goal: string;
  tools: SlipTool[];
  constraints: unknown;
  call_cap: number;
  spend_cap_cents: number;
  tier: Tier;
  expires_at: string;
  approved_at: string;
};

const SLIP_PURPOSE = "errand/slip-signing/v1";

// One key derivation per purpose keeps slip signatures and capabilities from
// validating as each other while both stay separate from the vault key.
export function purposeKey(master: string, purpose: string): Buffer {
  return createHmac("sha256", master).update(purpose).digest();
}

export function slipDocument(slip: SlipRecord): SlipDocument {
  if (slip.approvedAt === null) throw new Error("A slip is only signed once approved");
  return {
    slip_id: slip.id,
    user_id: slip.userId,
    errand_type: slip.errandType,
    goal: slip.goal,
    tools: parseSlipTools(slip.tools),
    constraints: JSON.parse(slip.constraints),
    call_cap: slip.callCap,
    spend_cap_cents: slip.spendCapCents,
    tier: slip.tier,
    expires_at: slip.expiresAt,
    approved_at: slip.approvedAt,
  };
}

export function signSlip(slip: SlipRecord, master: string): string {
  return createHmac("sha256", purposeKey(master, SLIP_PURPOSE))
    .update(canonicalJson(slipDocument(slip)))
    .digest("hex");
}

export function verifySlipSignature(slip: SlipRecord, master: string): boolean {
  if (slip.signature === null || slip.approvedAt === null) return false;
  const expected = Buffer.from(signSlip(slip, master), "hex");
  const presented = Buffer.from(slip.signature, "hex");
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}
