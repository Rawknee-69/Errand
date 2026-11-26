import { and, eq } from "drizzle-orm";
import type { ConnectorView } from "@errand/shared";
import type { Db } from "../db/client.ts";
import { appendJournalEvent } from "../db/journal.ts";
import { connectors, type ConnectorAuthStatus } from "../db/schema.ts";
import { scopedGet } from "../db/scoped-reads.ts";
import { ConnectorError } from "./errors.ts";

export type { ConnectorView };

export type ConnectorBaseDeps = {
  db: Db;
  userId: string;
};

export function connectorView(row: typeof connectors.$inferSelect): ConnectorView {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    transport: row.transport,
    authType: row.authType,
    authStatus: row.authStatus,
    lastAuthError: row.lastAuthError,
    lastSuccessAt: row.lastSuccessAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function connectorRow(deps: ConnectorBaseDeps, connectorId: string) {
  const row = scopedGet(
    deps.db,
    connectors,
    connectors.userId,
    deps.userId,
    connectors.id,
    connectorId,
  );
  if (row === undefined) throw new ConnectorError("not_found", `Connector ${connectorId} not found`);
  return row;
}

export function setConnectorAuthStatus(
  deps: ConnectorBaseDeps,
  connectorId: string,
  authStatus: ConnectorAuthStatus,
  lastAuthError: string | null,
): void {
  deps.db
    .update(connectors)
    .set({ authStatus, lastAuthError, updatedAt: new Date().toISOString() })
    .where(and(eq(connectors.userId, deps.userId), eq(connectors.id, connectorId)))
    .run();
}

// Emits once per transition into needs_reauth; a second failure while already
// needing a sign-in updates the reason without spamming the journal.
export function markConnectorNeedsReauth(
  deps: ConnectorBaseDeps,
  connectorId: string,
  reason: string,
): void {
  const row = connectorRow(deps, connectorId);
  const wasNeedsReauth = row.authStatus === "needs_reauth";
  setConnectorAuthStatus(deps, connectorId, "needs_reauth", reason);
  if (!wasNeedsReauth) {
    appendJournalEvent(deps.db, {
      userId: deps.userId,
      eventType: "connector.needs_reauth",
      payload: { connectorId, reason },
    });
  }
}

export function markConnectorSuccess(deps: ConnectorBaseDeps, connectorId: string): void {
  const now = new Date().toISOString();
  deps.db
    .update(connectors)
    .set({ lastSuccessAt: now, updatedAt: now })
    .where(and(eq(connectors.userId, deps.userId), eq(connectors.id, connectorId)))
    .run();
}
