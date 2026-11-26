import {
  escapeHtml,
  slipApprovalInputSchema,
  slipApprovedSchema,
  slipDetailSchema,
  type CatalogToolView,
  type ConnectorDetail,
  type GatewayHealth,
} from "@errand/shared";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import { Hono, type Context } from "hono";
import gatewayPackage from "../package.json" with { type: "json" };
import { AGENT_PATH, createAgentHandler } from "./agent/mcp.ts";
import { registerAuth, requestUserId, type AuthOptions, type GatewayEnv } from "./auth/api.ts";
import { DEFAULT_OWNER_ID } from "./auth/owner.ts";
import { createMigratedDatabase, type Db } from "./db/client.ts";
import { appendJournalEvent, verifyJournal } from "./db/journal.ts";
import { users } from "./db/schema.ts";
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
import { completeOAuthFlow, startOAuthFlow } from "./connectors/oauth/service.ts";
import { CredentialStore } from "./vault/credentials.ts";
import { VaultKeyring } from "./vault/keyring.ts";
import { Vault } from "./vault/vault.ts";
import { approveSlip, denySlip, SlipError } from "./slips/approval.ts";
import { getSlipDetail, listSlipSummaries } from "./slips/view.ts";

export { DEFAULT_OWNER_ID };
export const DEFAULT_OAUTH_REDIRECT_URI = "http://127.0.0.1:8787/api/oauth/callback";

export type GatewayAppOptions = {
  userId?: string;
  keyring?: VaultKeyring;
  discoverOptions?: DiscoverOptions;
  maxConnectors?: number;
  oauthRedirectUri?: string;
  hmacKey?: string;
  auth: AuthOptions | "disabled";
};

const probeSchema = z.object({ url: z.string().min(1) });
const agentKeyCreateSchema = z.object({ name: z.string().trim().min(1).max(64) });
const slipDenySchema = z.object({ reason: z.string().max(500).optional() }).strict();

async function optionalJson(c: Context<GatewayEnv>): Promise<unknown> {
  const text = await c.req.text();
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new SlipError("invalid_json", "The request body is not valid JSON");
  }
}

function bearerToken(header: string | undefined): string | undefined {
  return header?.match(/^Bearer\s+(\S+)$/i)?.[1];
}

const oauthStartSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().min(1),
});
const oauthCallbackSchema = z.object({
  state: z.string().min(1),
  code: z.string().min(1),
  iss: z.string().optional(),
});

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

function oauthCallbackPage(connectorName: string): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>Errand — connected</title>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto">
  <h1>Connected</h1>
  <p><strong>${escapeHtml(connectorName)}</strong> is authorized and its tools are catalogued.</p>
  <p><a href="/api/catalog">Open the catalog</a></p>
</body>`;
}

export function createGatewayApp(
  db: Db = createMigratedDatabase(":memory:"),
  options: GatewayAppOptions,
): Hono<GatewayEnv> {
  const app = new Hono<GatewayEnv>();
  const defaultUserId = options.userId ?? DEFAULT_OWNER_ID;
  if (getUser(db, defaultUserId) === undefined) {
    db.insert(users)
      .values({ id: defaultUserId, name: defaultUserId, createdAt: new Date().toISOString() })
      .run();
  }
  const discoverOptions = options.discoverOptions ?? {};
  const keyring = options.keyring;
  if (options.hmacKey !== undefined && Buffer.byteLength(options.hmacKey, "utf8") < 32) {
    throw new Error("Slip signing requires an HMAC key of at least 32 bytes");
  }
  const agentHandler = createAgentHandler(db, options.hmacKey);
  const oauthRedirectUri = options.oauthRedirectUri ?? DEFAULT_OAUTH_REDIRECT_URI;

  if (options.auth !== "disabled") registerAuth(app, db, options.auth);

  function userIdFor(c: Context<GatewayEnv>): string {
    return requestUserId(c, defaultUserId);
  }

  function serviceDeps(userId: string): ConnectorServiceDeps {
    if (keyring === undefined) {
      throw new ConnectorError("credential", "The vault is not configured on this gateway");
    }
    return {
      db,
      userId,
      vault: new Vault(db, keyring, userId),
      store: new CredentialStore(db, keyring, userId),
      discoverOptions,
      redirectUri: oauthRedirectUri,
      ...(options.maxConnectors === undefined ? {} : { maxConnectors: options.maxConnectors }),
    };
  }

  function connectorDetail(result: ConnectResult, userId: string): ConnectorDetail {
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

  app.get("/api/agent-keys", (c) => {
    const userId = userIdFor(c);
    return c.json({ agentKeys: listAgentKeys(db, userId).map(agentKeyView) });
  });

  app.post("/api/agent-keys", async (c) => {
    const userId = userIdFor(c);
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
    const userId = userIdFor(c);
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

  app.get("/api/slips", (c) => {
    const userId = userIdFor(c);
    return c.json({ slips: listSlipSummaries(db, userId) });
  });

  app.get("/api/slips/:id", (c) => {
    const userId = userIdFor(c);
    const detail = getSlipDetail(db, userId, c.req.param("id"));
    if (detail === undefined) return c.json({ error: "not_found" }, 404);
    return c.json(slipDetailSchema.parse(detail));
  });

  app.post("/api/slips/:id/approve", async (c) => {
    const userId = userIdFor(c);
    const body = slipApprovalInputSchema.parse(await optionalJson(c));
    const result = approveSlip(db, userId, c.req.param("id"), body, { hmacKey: options.hmacKey });
    return c.json(slipApprovedSchema.parse({ ...result.detail, trims: result.trims }));
  });

  app.post("/api/slips/:id/deny", async (c) => {
    const userId = userIdFor(c);
    const body = slipDenySchema.parse(await optionalJson(c));
    return c.json(slipDetailSchema.parse(denySlip(db, userId, c.req.param("id"), body.reason)));
  });

  app.post("/api/connectors/probe", async (c) => {
    const body = probeSchema.parse(await c.req.json());
    return c.json(await probeUrl(discoverOptions, body.url));
  });

  app.get("/api/connectors", (c) => {
    const userId = userIdFor(c);
    return c.json({ connectors: listConnectors(db, userId) });
  });

  app.post("/api/connectors", async (c) => {
    const body = connectorAuthInputSchema.parse(await c.req.json());
    const userId = userIdFor(c);
    const result = await connectConnector(serviceDeps(userId), {
      name: body.name,
      url: body.url,
      auth: toConnectorAuth(body),
    });
    return c.json(connectorDetail(result, userId), 201);
  });

  app.post("/api/connectors/:id/refresh", async (c) => {
    const userId = userIdFor(c);
    const result = await refreshConnector(serviceDeps(userId), c.req.param("id"));
    return c.json(connectorDetail(result, userId));
  });

  app.post("/api/connectors/oauth/start", async (c) => {
    const body = oauthStartSchema.parse(await c.req.json());
    const userId = userIdFor(c);
    const result = await startOAuthFlow(serviceDeps(userId), body);
    return c.json(result, 201);
  });

  app.get("/api/oauth/callback", async (c) => {
    const query = oauthCallbackSchema.parse(
      Object.fromEntries(new URL(c.req.url).searchParams.entries()),
    );
    const userId = userIdFor(c);
    const result = await completeOAuthFlow(serviceDeps(userId), {
      state: query.state,
      code: query.code,
      ...(query.iss === undefined ? {} : { iss: query.iss }),
    });
    if (c.req.header("accept")?.includes("text/html") === true) {
      return c.html(oauthCallbackPage(result.connector.name));
    }
    return c.json(connectorDetail(result, userId));
  });

  app.get("/api/catalog", (c) => {
    const userId = userIdFor(c);
    return c.json({
      tools: listCatalog(db, userId).map(catalogToolView),
      connectors: listConnectors(db, userId),
    });
  });

  app.post("/api/catalog/:id/approve", (c) => {
    const userId = userIdFor(c);
    const tool = approveCatalogTool(db, userId, c.req.param("id"));
    return c.json({ tool: catalogToolView(tool) });
  });

  app.get("/api/connectors/:id", (c) => {
    const userId = userIdFor(c);
    const connector = listConnectors(db, userId).find((row) => row.id === c.req.param("id"));
    if (connector === undefined) return c.json({ error: "not_found" }, 404);
    return c.json({ connector });
  });

  app.onError((error, c) => {
    if (error instanceof SlipError) {
      const status =
        error.code === "not_found"
          ? 404
          : error.code === "cap_above_request" || error.code === "invalid_json"
            ? 400
            : error.code === "signing_unavailable"
              ? 500
              : 409;
      return c.json({ error: error.code, message: error.message }, status);
    }
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
      const status =
        error.code === "not_found"
          ? 404
          : error.code === "reauth"
            ? 409
            : error.code === "oauth_failed"
              ? 502
              : 400;
      return c.json({ error: error.code, message: error.message }, status);
    }
    console.error(error);
    return c.json({ error: "internal", message: "Unexpected gateway error" }, 500);
  });

  return app;
}
