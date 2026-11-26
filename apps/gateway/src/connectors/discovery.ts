import { and, eq } from "drizzle-orm";
import { connectors } from "../db/schema.ts";
import { appendJournalEvent } from "../db/journal.ts";
import { ingestTools, type IngestSummary } from "./catalog.ts";
import type { McpConnection } from "./mcp.ts";
import type { ConnectorBaseDeps } from "./records.ts";

// Update the transport, ingest the catalog and journal the discovery, in the
// one order both a fresh connect and a refresh must follow.
export function applyDiscovery(
  deps: ConnectorBaseDeps,
  connectorId: string,
  connectorName: string,
  connection: McpConnection,
  eventType: "catalog.ingested" | "catalog.refreshed",
): IngestSummary {
  const now = new Date().toISOString();
  deps.db
    .update(connectors)
    .set({ transport: connection.transport, lastSuccessAt: now, updatedAt: now })
    .where(and(eq(connectors.userId, deps.userId), eq(connectors.id, connectorId)))
    .run();
  const summary = ingestTools(deps.db, {
    userId: deps.userId,
    connectorId,
    connectorName,
    tools: connection.tools,
  });
  appendJournalEvent(deps.db, {
    userId: deps.userId,
    eventType,
    payload: { connectorId, ...summary },
  });
  return summary;
}
