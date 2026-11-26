import { z } from "zod";
import type { Db } from "../db/client.ts";
import { getSlip } from "../db/scoped-reads.ts";
import type { SlipState, Tier, ToolClass } from "../db/schema.ts";

export const slipToolsSchema = z.array(
  z.object({
    name: z.string(),
    connectorId: z.string(),
    class: z.enum(["read", "write", "send", "delete", "spend", "unknown"]),
  }),
);

export function parseSlipTools(raw: string): { name: string; connectorId: string; class: ToolClass }[] {
  return slipToolsSchema.parse(JSON.parse(raw));
}

export type ErrandStatusResult = {
  slipId: string;
  state: SlipState;
  tier: Tier;
  goal: string;
  tools: { name: string; connectorId: string; class: ToolClass }[];
  callCap: number;
  callsUsed: number;
  spendCapCents: number;
  spendUsedCents: number;
  expiresAt: string;
  createdAt: string;
};

export function errandStatus(
  db: Db,
  userId: string,
  slipId: string,
  now = new Date(),
): ErrandStatusResult | undefined {
  const slip = getSlip(db, userId, slipId);
  if (slip === undefined) return undefined;
  const expired = Date.parse(slip.expiresAt) <= now.getTime();
  return {
    slipId: slip.id,
    state: slip.state === "pending" && expired ? "expired" : slip.state,
    tier: slip.tier,
    goal: slip.goal,
    tools: parseSlipTools(slip.tools),
    callCap: slip.callCap,
    callsUsed: slip.callsUsed,
    spendCapCents: slip.spendCapCents,
    spendUsedCents: slip.spendUsedCents,
    expiresAt: slip.expiresAt,
    createdAt: slip.createdAt,
  };
}
