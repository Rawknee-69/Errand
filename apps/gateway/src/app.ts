import type { GatewayHealth } from "@errand/shared";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import { Hono } from "hono";
import gatewayPackage from "../package.json" with { type: "json" };
import { AGENT_PATH, createAgentHandler } from "./agent/mcp.ts";
import { createMigratedDatabase, type Db } from "./db/client.ts";
import { appendJournalEvent, verifyJournal } from "./db/journal.ts";
import { users, type ToolClass, type ToolState } from "./db/schema.ts";
import { getUser, listAgentKeys } from "./db/scoped-reads.ts";
import { EgressRefusal } from "./egress/guard.ts";
import { ConnectorLimitError } from "./connectors/quota.ts";
import { listCatalog, type CatalogTool } from "./connectors/catalog.ts";
import { McpConnectError, type DiscoverOptions } from "./connectors/mcp.ts";
import { connectorAuthInputSchema, toConnectorAuth } from "./connectors/auth.ts";
import { ConnectorError } from "./connectors/errors.ts";
import {
  approveCatalogTool,
  connectConnector,
  listConnectors,
  probeUrl,
  refreshConnector,
  type ConnectResult,
  type ConnectorServiceDeps,
} from "./connectors/service.ts";
import { agentKeyView, issueAgentKey, revokeAgentKey, verifyAgentKey } from "./vault/agent-keys.ts";
import { CredentialStore } from "./vault/credentials.ts";
import { VaultKeyring } from "./vault/keyring.ts";
import { Vault } from "./vault/vault.ts";

export const DEFAULT_OWNER_ID = "owner";

export type GatewayAppOptions = {
  userId?: string;
  keyring?: VaultKeyring;
  discoverOptions?: DiscoverOptions;
  maxConnectors?: number;
};

const probeSchema = z.object({ url: z.string().min(1) });
const agentKeyCreateSchema = z.object({ name: z.string().trim().min(1).max(64) });

function bearerToken(header: string | undefined): string | undefined {
  return header?.match(/^Bearer\s+(\S+)$/i)?.[1];
}

export type CatalogToolView = {
  id: string;
  connectorId: string;
  name: string;
  agentName: string;
  description: string;
  inputSchema: string;
  annotations: string;
  class: ToolClass;
  definitionHash: string;
  observedDescription: string;
  observedInputSchema: string;
  observedAnnotations: string;
  observedClass: ToolClass;
  observedHash: string;
  state: ToolState;
  requestable: boolean;
  changedAt: string | null;
  removedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function catalogToolView(row: CatalogTool): CatalogToolView {
  return {
    id: row.id,
    connectorId: row.connectorId,
    name: row.name,
    agentName: row.agentName,
    description: row.description,
    inputSchema: row.inputSchema,
    annotations: row.annotations,
    class: row.class,
    definitionHash: row.definitionHash,
    observedDescription: row.observedDescription,
    observedInputSchema: row.observedInputSchema,
    observedAnnotations: row.observedAnnotations,
    observedClass: row.observedClass,
    observedHash: row.observedHash,
    state: row.state,
    requestable: row.requestable,
    changedAt: row.changedAt,
    removedAt: row.removedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createGatewayApp(
  db: Db = createMigratedDatabase(":memory:"),
  options: GatewayAppOptions = {},
): Hono {
  const app = new Hono();
  const userId = options.userId ?? DEFAULT_OWNER_ID;
  if (getUser(db, userId) === undefined) {
    db.insert(users).values({ id: userId, name: userId, createdAt: new Date().toISOString() }).run();
  }
  const discoverOptions = options.discoverOptions ?? {};
  const keyring = options.keyring;
  const agentHandler = createAgentHandler(db);

  function serviceDeps(): ConnectorServiceDeps {
    if (keyring === undefined) {
      throw new ConnectorError("credential", "The vault is not configured on this gateway");
    }
    return {
      db,
      userId,
      vault: new Vault(db, keyring, userId),
      store: new CredentialStore(db, keyring, userId),
      discoverOptions,
      ...(options.maxConnectors === undefined ? {} : { maxConnectors: options.maxConnectors }),
    };
  }

  function connectorDetail(result: ConnectResult) {
    return {
      connector: result.connector,
      transport: result.transport,
      summary: result.summary,
      tools: listCatalog(db, userId)
        .filter((tool) => tool.connectorId === result.connector.id)
        .map(catalogToolView),
    };
  }

  app.get("/health", (c) => {
    const health: GatewayHealth = {
      service: "gateway",
      status: "ok",
      version: gatewayPackage.version,
    };
    return c.json(health);
  });

  app.get("/api/journal/verify", (c) => c.json(verifyJournal(db)));

  app.get("/api/agent-keys", (c) =>
    c.json({ agentKeys: listAgentKeys(db, userId).map(agentKeyView) }),
  );

  app.post("/api/agent-keys", async (c) => {
    const body = agentKeyCreateSchema.parse(await c.req.json());
    const issued = issueAgentKey(db, userId, body.name);
    appendJournalEvent(db, {
      userId,
      eventType: "agent_key.created",
      payload: { agent_key_id: issued.record.id, name: issued.record.name },
    });
    return c.json(
      {
        key: issued.key,
        agentKey: agentKeyView(issued.record),
        mcpUrl: new URL(AGENT_PATH, c.req.url).toString(),
      },
      201,
    );
  });

  app.post("/api/agent-keys/:id/revoke", (c) => {
    const result = revokeAgentKey(db, userId, c.req.param("id"));
    if (result === undefined) return c.json({ error: "not_found" }, 404);
    if (result.changed) {
      appendJournalEvent(db, {
        userId,
        eventType: "agent_key.revoked",
        payload: { agent_key_id: result.record.id },
      });
    }
    return c.json({ agentKey: agentKeyView(result.record) });
  });

  app.all(AGENT_PATH, async (c) => {
    const presented = bearerToken(c.req.header("authorization"));
    const record = presented === undefined ? undefined : verifyAgentKey(db, presented);
    if (record === undefined) {
      return c.json(
        { error: "unauthorized", message: "A valid agent key is required" },
        401,
        { "www-authenticate": 'Bearer realm="errand"' },
      );
    }
    // The SDK names the authenticated principal `clientId`; here it is the key's owner.
    const authInfo: AuthInfo = { token: record.id, clientId: record.userId, scopes: [] };
    return agentHandler.fetch(c.req.raw, { authInfo });
  });

  app.post("/api/connectors/probe", async (c) => {
    const body = probeSchema.parse(await c.req.json());
    return c.json(await probeUrl(discoverOptions, body.url));
  });

  app.get("/api/connectors", (c) => c.json({ connectors: listConnectors(db, userId) }));

  app.post("/api/connectors", async (c) => {
    const body = connectorAuthInputSchema.parse(await c.req.json());
    const result = await connectConnector(serviceDeps(), {
      name: body.name,
      url: body.url,
      auth: toConnectorAuth(body),
    });
    return c.json(connectorDetail(result), 201);
  });

  app.post("/api/connectors/:id/refresh", async (c) => {
    const result = await refreshConnector(serviceDeps(), c.req.param("id"));
    return c.json(connectorDetail(result));
  });

  app.get("/api/catalog", (c) =>
    c.json({
      tools: listCatalog(db, userId).map(catalogToolView),
      connectors: listConnectors(db, userId),
    }),
  );

  app.post("/api/catalog/:id/approve", (c) => {
    const tool = approveCatalogTool(db, userId, c.req.param("id"));
    return c.json({ tool: catalogToolView(tool) });
  });

  app.get("/api/connectors/:id", (c) => {
    const connector = listConnectors(db, userId).find((row) => row.id === c.req.param("id"));
    if (connector === undefined) return c.json({ error: "not_found" }, 404);
    return c.json({ connector });
  });

  app.onError((error, c) => {
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: "invalid_request",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    }
    if (error instanceof EgressRefusal) {
      return c.json({ error: "egress", code: error.code, message: error.message }, 400);
    }
    if (error instanceof ConnectorLimitError) {
      return c.json({ error: "connector_limit", message: error.message }, 409);
    }
    if (error instanceof McpConnectError) {
      return c.json(
        { error: error.code, message: error.message },
        error.code === "auth" ? 401 : 502,
      );
    }
    if (error instanceof ConnectorError) {
      return c.json(
        { error: error.code, message: error.message },
        error.code === "not_found" ? 404 : 400,
      );
    }
    console.error(error);
    return c.json({ error: "internal", message: "Unexpected gateway error" }, 500);
  });

  return app;
}
