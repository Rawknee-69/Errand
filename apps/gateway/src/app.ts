import type { GatewayHealth } from "@errand/shared";
import { z } from "zod";
import { Hono } from "hono";
import gatewayPackage from "../package.json" with { type: "json" };
import { createMigratedDatabase, type Db } from "./db/client.ts";
import { verifyJournal } from "./db/journal.ts";
import { users, type ToolClass, type ToolState } from "./db/schema.ts";
import { getUser } from "./db/scoped-reads.ts";
import { EgressRefusal } from "./egress/guard.ts";
import { ConnectorLimitError } from "./connectors/quota.ts";
import { listCatalog, type CatalogTool } from "./connectors/catalog.ts";
import { McpConnectError, type ConnectorAuth, type DiscoverOptions } from "./connectors/mcp.ts";
import {
  approveCatalogTool,
  ConnectorError,
  connectConnector,
  listConnectors,
  probeUrl,
  refreshConnector,
  type ConnectorServiceDeps,
} from "./connectors/service.ts";
import { CredentialStore } from "./vault/credentials.ts";
import { VaultKeyring } from "./vault/keyring.ts";
import { Vault } from "./vault/vault.ts";

export type GatewayAppOptions = {
  userId?: string;
  keyring?: VaultKeyring;
  discover?: DiscoverOptions;
  maxConnectors?: number;
};

const probeSchema = z.object({ url: z.string().min(1) });

const headerName = z
  .string()
  .regex(/^[A-Za-z0-9-]+$/, "Header names may only contain letters, digits and hyphens")
  .refine(
    (name) =>
      !["host", "content-length", "connection", "transfer-encoding", "authorization"].includes(
        name.toLowerCase(),
      ),
    { message: "That header is managed by the gateway" },
  );

const connectorBase = {
  name: z.string().min(1).max(120),
  url: z.string().min(1),
};

const connectSchema = z.discriminatedUnion("authType", [
  z.object({ ...connectorBase, authType: z.literal("none") }),
  z.object({ ...connectorBase, authType: z.literal("bearer"), token: z.string().min(1) }),
  z.object({
    ...connectorBase,
    authType: z.literal("header"),
    headerName,
    headerValue: z.string().min(1),
  }),
  z.object({
    ...connectorBase,
    authType: z.literal("basic"),
    username: z.string().min(1),
    password: z.string().min(1),
  }),
]);

function toConnectorAuth(input: z.infer<typeof connectSchema>): ConnectorAuth {
  switch (input.authType) {
    case "none":
      return { type: "none" };
    case "bearer":
      return { type: "bearer", token: input.token };
    case "header":
      return { type: "header", headerName: input.headerName, value: input.headerValue };
    case "basic":
      return { type: "basic", username: input.username, password: input.password };
  }
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
  const userId = options.userId ?? "owner";
  if (getUser(db, userId) === undefined) {
    db.insert(users).values({ id: userId, name: userId, createdAt: new Date().toISOString() }).run();
  }
  const discover = options.discover ?? {};
  const keyring = options.keyring;

  function serviceDeps(): ConnectorServiceDeps {
    if (keyring === undefined) {
      throw new ConnectorError("credential", "The vault is not configured on this gateway");
    }
    return {
      db,
      userId,
      vault: new Vault(db, keyring, userId),
      store: new CredentialStore(db, keyring, userId),
      discover,
      ...(options.maxConnectors === undefined ? {} : { maxConnectors: options.maxConnectors }),
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

  app.post("/api/connectors/probe", async (c) => {
    const body = probeSchema.parse(await c.req.json());
    return c.json(await probeUrl(discover, body.url));
  });

  app.get("/api/connectors", (c) => c.json({ connectors: listConnectors(db, userId) }));

  app.post("/api/connectors", async (c) => {
    const body = connectSchema.parse(await c.req.json());
    const result = await connectConnector(serviceDeps(), {
      name: body.name,
      url: body.url,
      auth: toConnectorAuth(body),
    });
    const tools = listCatalog(db, userId)
      .filter((tool) => tool.connectorId === result.connector.id)
      .map(catalogToolView);
    return c.json(
      {
        connector: result.connector,
        transport: result.transport,
        summary: result.summary,
        tools,
      },
      201,
    );
  });

  app.post("/api/connectors/:id/refresh", async (c) => {
    const result = await refreshConnector(serviceDeps(), c.req.param("id"));
    const tools = listCatalog(db, userId)
      .filter((tool) => tool.connectorId === result.connector.id)
      .map(catalogToolView);
    return c.json({
      connector: result.connector,
      transport: result.transport,
      summary: result.summary,
      tools,
    });
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
