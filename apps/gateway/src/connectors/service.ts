import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { appendJournalEvent } from "../db/journal.ts";
import { scopedGet, scopedList } from "../db/scoped-reads.ts";
import { connectors, credentials, type ConnectorAuthType } from "../db/schema.ts";
import type { CredentialStore } from "../vault/credentials.ts";
import type { Vault } from "../vault/vault.ts";
import { assertFetchableUrl } from "../egress/guard.ts";
import { parseCredential, serialiseCredential, type ConnectorAuth } from "./auth.ts";
import {
  getCatalogTool,
  ingestTools,
  pinToolDefinition,
  type DiscoveredTool,
  type IngestSummary,
} from "./catalog.ts";
import { ConnectorError } from "./errors.ts";
import { assertConnectorQuota } from "./quota.ts";
import {
  discoverMcpTools,
  McpConnectError,
  type DiscoverOptions,
  type McpConnection,
  type McpTransportKind,
} from "./mcp.ts";

export type ConnectorServiceDeps = {
  db: Db;
  userId: string;
  vault: Vault;
  store: CredentialStore;
  discoverOptions: DiscoverOptions;
  maxConnectors?: number;
};

export type ConnectorView = {
  id: string;
  name: string;
  url: string;
  transport: string;
  authType: ConnectorAuthType;
  createdAt: string;
  updatedAt: string;
};

export type AuthHint = "bearer" | "basic" | "header";

export type ProbeResult = {
  reachable: boolean;
  transport: McpTransportKind | null;
  requiresAuth: boolean;
  authHint: AuthHint | null;
  toolCount: number;
};

export type ConnectResult = {
  connector: ConnectorView;
  transport: McpTransportKind;
  tools: DiscoveredTool[];
  summary: IngestSummary;
};

export function connectorView(row: typeof connectors.$inferSelect): ConnectorView {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    transport: row.transport,
    authType: row.authType,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listConnectors(db: Db, userId: string): ConnectorView[] {
  return scopedList(db, connectors, connectors.userId, userId).map(connectorView);
}

function connectorHost(url: string): string {
  return new URL(url).host;
}

function authHint(challenge: string | undefined): AuthHint | null {
  const scheme = challenge?.split(/\s+/)[0]?.toLowerCase();
  if (scheme === "bearer") return "bearer";
  if (scheme === "basic") return "basic";
  if (scheme !== undefined && scheme !== "") return "header";
  return null;
}

export async function probeUrl(discoverOptions: DiscoverOptions, url: string): Promise<ProbeResult> {
  await assertFetchableUrl(url, discoverOptions);
  try {
    const connection = await discoverMcpTools(url, { type: "none" }, discoverOptions);
    return {
      reachable: true,
      transport: connection.transport,
      requiresAuth: false,
      authHint: null,
      toolCount: connection.tools.length,
    };
  } catch (error) {
    if (error instanceof McpConnectError && error.code === "auth") {
      return {
        reachable: true,
        transport: null,
        requiresAuth: true,
        authHint: authHint(error.challenge),
        toolCount: 0,
      };
    }
    if (error instanceof McpConnectError && error.code === "connect") {
      return {
        reachable: false,
        transport: null,
        requiresAuth: false,
        authHint: null,
        toolCount: 0,
      };
    }
    throw error;
  }
}

async function discoverWithStoredAuth(
  deps: ConnectorServiceDeps,
  connectorId: string,
  authType: ConnectorAuthType,
  url: string,
): Promise<McpConnection> {
  if (authType === "none") return discoverMcpTools(url, { type: "none" }, deps.discoverOptions);
  return deps.vault.withCredential(connectorId, (secret) =>
    discoverMcpTools(url, parseCredential(authType, secret), deps.discoverOptions),
  );
}

function applyDiscovery(
  deps: ConnectorServiceDeps,
  connectorId: string,
  connectorName: string,
  connection: McpConnection,
  eventType: "catalog.ingested" | "catalog.refreshed",
): IngestSummary {
  deps.db
    .update(connectors)
    .set({ transport: connection.transport, updatedAt: new Date().toISOString() })
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

function connectorRow(deps: ConnectorServiceDeps, connectorId: string) {
  const row = scopedGet(deps.db, connectors, connectors.userId, deps.userId, connectors.id, connectorId);
  if (row === undefined) throw new ConnectorError("not_found", `Connector ${connectorId} not found`);
  return row;
}

export async function connectConnector(
  deps: ConnectorServiceDeps,
  input: { name: string; url: string; auth: ConnectorAuth },
): Promise<ConnectResult> {
  assertConnectorQuota(deps.db, deps.userId, deps.maxConnectors);
  const normalized = (await assertFetchableUrl(input.url, deps.discoverOptions)).href;
  const now = new Date().toISOString();
  const id = randomUUID();

  deps.db
    .insert(connectors)
    .values({
      id,
      userId: deps.userId,
      name: input.name,
      url: normalized,
      transport: "streamable-http",
      authType: input.auth.type,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const secret = serialiseCredential(input.auth);
  try {
    if (secret !== undefined) {
      deps.store.store({ serviceId: id, kind: input.auth.type, secret, connectorId: id });
    }
    const connection = await discoverWithStoredAuth(deps, id, input.auth.type, normalized);
    appendJournalEvent(deps.db, {
      userId: deps.userId,
      eventType: "connector.connected",
      payload: {
        connectorId: id,
        host: connectorHost(normalized),
        transport: connection.transport,
        authType: input.auth.type,
        toolCount: connection.tools.length,
      },
    });
    const summary = applyDiscovery(deps, id, input.name, connection, "catalog.ingested");
    return {
      connector: connectorView(connectorRow(deps, id)),
      transport: connection.transport,
      tools: connection.tools,
      summary,
    };
  } catch (error) {
    deps.db.delete(credentials).where(eq(credentials.serviceId, id)).run();
    deps.db.delete(connectors).where(eq(connectors.id, id)).run();
    throw error;
  }
}

export async function refreshConnector(
  deps: ConnectorServiceDeps,
  connectorId: string,
): Promise<ConnectResult> {
  const row = connectorRow(deps, connectorId);

  let connection: McpConnection;
  try {
    connection = await discoverWithStoredAuth(deps, row.id, row.authType, row.url);
  } catch (error) {
    appendJournalEvent(deps.db, {
      userId: deps.userId,
      eventType: "connector.refresh_failed",
      payload: {
        connectorId: row.id,
        message: error instanceof Error ? error.message : "unknown error",
      },
    });
    throw error;
  }

  const summary = applyDiscovery(deps, row.id, row.name, connection, "catalog.refreshed");
  return {
    connector: connectorView(connectorRow(deps, row.id)),
    transport: connection.transport,
    tools: connection.tools,
    summary,
  };
}

export function approveCatalogTool(db: Db, userId: string, toolId: string) {
  const row = getCatalogTool(db, userId, toolId);
  if (row === undefined) throw new ConnectorError("not_found", `Tool ${toolId} not found`);
  if (row.state === "removed") throw new ConnectorError("not_found", `Tool ${row.name} was removed`);
  const tool = pinToolDefinition(db, userId, row);
  appendJournalEvent(db, {
    userId,
    eventType: "catalog.tool_approved",
    payload: {
      toolId: tool.id,
      connectorId: tool.connectorId,
      name: tool.name,
      previousClass: row.class,
      class: tool.class,
      previousHash: row.definitionHash,
      hash: tool.definitionHash,
    },
  });
  return tool;
}
