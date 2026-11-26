import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { appendJournalEvent } from "../db/journal.ts";
import { scopedGet, scopedList } from "../db/scoped-reads.ts";
import { connectors, credentials, type ConnectorAuthType } from "../db/schema.ts";
import type { CredentialStore } from "../vault/credentials.ts";
import type { Vault } from "../vault/vault.ts";
import { assertFetchableUrl } from "../egress/guard.ts";
import { approveTool, getCatalogTool, ingestTools, type IngestSummary, type DiscoveredTool } from "./catalog.ts";
import { assertConnectorQuota } from "./quota.ts";
import {
  discoverMcpTools,
  McpConnectError,
  type ConnectorAuth,
  type DiscoverOptions,
  type McpTransportKind,
} from "./mcp.ts";

export type ConnectorServiceDeps = {
  db: Db;
  userId: string;
  vault: Vault;
  store: CredentialStore;
  discover: DiscoverOptions;
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

export type ProbeResult = {
  reachable: boolean;
  transport: McpTransportKind | null;
  requiresAuth: boolean;
  toolCount: number;
};

export type ConnectResult = {
  connector: ConnectorView;
  transport: McpTransportKind;
  tools: DiscoveredTool[];
  summary: IngestSummary;
};

export type ConnectorErrorCode = "not_found" | "credential";

export class ConnectorError extends Error {
  constructor(
    readonly code: ConnectorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

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

const bearerSecret = z.object({ token: z.string().min(1) });
const headerSecret = z.object({ headerName: z.string().min(1), value: z.string().min(1) });
const basicSecret = z.object({ username: z.string().min(1), password: z.string().min(1) });

export function parseCredential(authType: ConnectorAuthType, secret: string): ConnectorAuth {
  let raw: unknown;
  try {
    raw = JSON.parse(secret);
  } catch {
    throw new ConnectorError("credential", "The stored credential is not valid JSON");
  }
  if (authType === "bearer") {
    const parsed = bearerSecret.safeParse(raw);
    if (!parsed.success) throw new ConnectorError("credential", "The stored bearer token is invalid");
    return { type: "bearer", token: parsed.data.token };
  }
  if (authType === "header") {
    const parsed = headerSecret.safeParse(raw);
    if (!parsed.success) throw new ConnectorError("credential", "The stored header credential is invalid");
    return { type: "header", headerName: parsed.data.headerName, value: parsed.data.value };
  }
  if (authType === "basic") {
    const parsed = basicSecret.safeParse(raw);
    if (!parsed.success) throw new ConnectorError("credential", "The stored basic credential is invalid");
    return { type: "basic", username: parsed.data.username, password: parsed.data.password };
  }
  throw new ConnectorError("credential", `Auth type ${authType} has no stored credential`);
}

function credentialSecret(auth: ConnectorAuth): string | undefined {
  switch (auth.type) {
    case "none":
      return undefined;
    case "bearer":
      return JSON.stringify({ token: auth.token });
    case "header":
      return JSON.stringify({ headerName: auth.headerName, value: auth.value });
    case "basic":
      return JSON.stringify({ username: auth.username, password: auth.password });
  }
}

function connectorHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

export async function probeUrl(discover: DiscoverOptions, url: string): Promise<ProbeResult> {
  await assertFetchableUrl(url, discover);
  try {
    const connection = await discoverMcpTools(url, { type: "none" }, discover);
    return {
      reachable: true,
      transport: connection.transport,
      requiresAuth: false,
      toolCount: connection.tools.length,
    };
  } catch (error) {
    if (error instanceof McpConnectError && error.code === "auth") {
      return { reachable: true, transport: null, requiresAuth: true, toolCount: 0 };
    }
    if (error instanceof McpConnectError && error.code === "connect") {
      return { reachable: false, transport: null, requiresAuth: false, toolCount: 0 };
    }
    throw error;
  }
}

async function discoverWithStoredAuth(
  deps: ConnectorServiceDeps,
  connectorId: string,
  authType: ConnectorAuthType,
  url: string,
): Promise<Awaited<ReturnType<typeof discoverMcpTools>>> {
  if (authType === "none") return discoverMcpTools(url, { type: "none" }, deps.discover);
  return deps.vault.withCredential(connectorId, (secret) =>
    discoverMcpTools(url, parseCredential(authType, secret), deps.discover),
  );
}

export async function connectConnector(
  deps: ConnectorServiceDeps,
  input: { name: string; url: string; auth: ConnectorAuth },
): Promise<ConnectResult> {
  assertConnectorQuota(deps.db, deps.userId, deps.maxConnectors);
  const normalized = (await assertFetchableUrl(input.url, deps.discover)).href;
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

  const secret = credentialSecret(input.auth);
  try {
    if (secret !== undefined) {
      deps.store.store({
        serviceId: id,
        kind: input.auth.type,
        secret,
        connectorId: id,
      });
    }
    const connection = await discoverWithStoredAuth(deps, id, input.auth.type, normalized);
    deps.db
      .update(connectors)
      .set({ transport: connection.transport, updatedAt: new Date().toISOString() })
      .where(and(eq(connectors.userId, deps.userId), eq(connectors.id, id)))
      .run();
    const summary = ingestTools(deps.db, {
      userId: deps.userId,
      connectorId: id,
      connectorName: input.name,
      tools: connection.tools,
    });
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
    appendJournalEvent(deps.db, {
      userId: deps.userId,
      eventType: "catalog.ingested",
      payload: { connectorId: id, ...summary },
    });

    const row = scopedGet(deps.db, connectors, connectors.userId, deps.userId, connectors.id, id);
    if (row === undefined) throw new ConnectorError("not_found", "The connector vanished after connecting");
    return {
      connector: connectorView(row),
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
  const row = scopedGet(deps.db, connectors, connectors.userId, deps.userId, connectors.id, connectorId);
  if (row === undefined) throw new ConnectorError("not_found", `Connector ${connectorId} not found`);

  let connection: Awaited<ReturnType<typeof discoverMcpTools>>;
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

  deps.db
    .update(connectors)
    .set({ transport: connection.transport, updatedAt: new Date().toISOString() })
    .where(and(eq(connectors.userId, deps.userId), eq(connectors.id, row.id)))
    .run();
  const summary = ingestTools(deps.db, {
    userId: deps.userId,
    connectorId: row.id,
    connectorName: row.name,
    tools: connection.tools,
  });
  appendJournalEvent(deps.db, {
    userId: deps.userId,
    eventType: "catalog.refreshed",
    payload: { connectorId: row.id, ...summary },
  });
  const refreshed = scopedGet(deps.db, connectors, connectors.userId, deps.userId, connectors.id, row.id);
  if (refreshed === undefined) throw new ConnectorError("not_found", `Connector ${connectorId} not found`);
  return {
    connector: connectorView(refreshed),
    transport: connection.transport,
    tools: connection.tools,
    summary,
  };
}

export function approveCatalogTool(db: Db, userId: string, toolId: string) {
  if (getCatalogTool(db, userId, toolId) === undefined) {
    throw new ConnectorError("not_found", `Tool ${toolId} not found`);
  }
  const tool = approveTool(db, userId, toolId);
  appendJournalEvent(db, {
    userId,
    eventType: "catalog.tool_approved",
    payload: { toolId: tool.id, connectorId: tool.connectorId, name: tool.name },
  });
  return tool;
}

