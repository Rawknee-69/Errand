import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { connectors, type ConnectorAuthStatus, type ConnectorAuthType } from "../db/schema.ts";
import { scopedGet } from "../db/scoped-reads.ts";
import { ConnectorError } from "./errors.ts";

export type ConnectorBaseDeps = {
  db: Db;
  userId: string;
};

export type ConnectorView = {
  id: string;
  name: string;
  url: string;
  transport: string;
  authType: ConnectorAuthType;
  authStatus: ConnectorAuthStatus;
  lastAuthError: string | null;
  createdAt: string;
  updatedAt: string;
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
