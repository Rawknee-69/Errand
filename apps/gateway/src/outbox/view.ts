import type { OutboxItem } from "@errand/shared";
import type { Db } from "../db/client.ts";
import { outbox } from "../db/schema.ts";
import { getConnector, getSlip } from "../db/scoped-reads.ts";

export type OutboxRow = typeof outbox.$inferSelect;

export function outboxView(db: Db, userId: string, row: OutboxRow): OutboxItem {
  const slip = getSlip(db, userId, row.slipId);
  const connector = getConnector(db, userId, row.connectorId);
  return {
    id: row.id,
    slipId: row.slipId,
    goal: slip?.goal ?? "",
    tool: row.tool,
    connectorName: connector?.name ?? "",
    toolClass: row.toolClass,
    state: row.state,
    amountCents: row.amountCents,
    releaseAt: row.releaseAt,
    expiresAt: row.expiresAt,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}
