import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, lte } from "drizzle-orm";
import {
  AuthorizationServerMismatchError,
  OAuthError,
  OAuthErrorCode,
  auth,
  type FetchLike,
} from "@modelcontextprotocol/client";
import { recordEvent } from "../../db/events.ts";
import { oauthAttempts, connectors } from "../../db/schema.ts";
import { scopedGet } from "../../db/scoped-reads.ts";
import { assertFetchableUrl, egressRequest } from "../../egress/guard.ts";
import { assertConnectorQuota } from "../quota.ts";
import { ConnectorError, type ConnectorErrorCode } from "../errors.ts";
import { applyDiscovery } from "../discovery.ts";
import {
  connectorRow,
  connectorView,
  markConnectorNeedsReauth,
  setConnectorAuthStatus,
  type ConnectorBaseDeps,
  type ConnectorView,
} from "../records.ts";
import {
  discoverMcpTools,
  McpConnectError,
  type DiscoverOptions,
  type McpConnection,
} from "../mcp.ts";
import type { McpTransportKind } from "@errand/shared";
import type { DiscoveredTool, IngestSummary } from "../catalog.ts";
import type { CredentialStore } from "../../vault/credentials.ts";
import { VaultError } from "../../vault/common.ts";
import type { Vault } from "../../vault/vault.ts";
import { ReauthRequiredError } from "./errors.ts";
import { withConnectorLock } from "./lock.ts";
import { createConnectorOAuthProvider } from "./provider.ts";
import { OAuthStore } from "./store.ts";

const OAUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS_PER_CONNECTOR = 3;

export type OAuthServiceDeps = ConnectorBaseDeps & {
  vault: Vault;
  store: CredentialStore;
  discoverOptions: DiscoverOptions;
  redirectUri: string;
  maxConnectors?: number;
};

export type OAuthStartResult = {
  connector: ConnectorView;
  authorizationUrl: string;
  attemptId: string;
};

export type OAuthCompleteResult = {
  connector: ConnectorView;
  transport: McpTransportKind;
  tools: DiscoveredTool[];
  summary: IngestSummary;
};

type AuthorizationLeg = {
  attemptId?: string;
  state?: string;
  code?: string;
  iss?: string;
  onAuthorizationUrl?: (url: URL) => void;
};

function guardedFetch(options: DiscoverOptions): FetchLike {
  return (url, init) => egressRequest(url, init ?? {}, options);
}

function providerFor(
  deps: OAuthServiceDeps,
  store: OAuthStore,
  connectorId: string,
  options: AuthorizationLeg,
) {
  return createConnectorOAuthProvider({
    redirectUri: deps.redirectUri,
    refreshOnly: options.code !== undefined || options.onAuthorizationUrl === undefined,
    ...(options.state === undefined ? {} : { state: options.state }),
    readConnectorState: () => store.connectorState(connectorId),
    writeConnectorState: (transform) => store.updateConnectorState(connectorId, transform),
    readAttemptSecret: () =>
      options.attemptId === undefined ? Promise.resolve({}) : store.attemptSecret(options.attemptId),
    writeAttemptSecret: (secret) => {
      if (options.attemptId !== undefined) store.saveAttemptSecret(options.attemptId, secret);
    },
    onAuthorizationUrl: options.onAuthorizationUrl ?? (() => undefined),
    onCredentialsInvalidated: (scope) => markConnectorNeedsReauth(deps, connectorId, `invalidated_${scope}`),
  });
}

function failureReason(error: unknown): string {
  if (error instanceof AuthorizationServerMismatchError) return "issuer_mismatch";
  if (error instanceof OAuthError) return `oauth_${error.code}`;
  if (error instanceof ReauthRequiredError) return "reauth_required";
  if (error instanceof ConnectorError) return error.code;
  if (error instanceof Error && error.message.length > 0) return error.message.slice(0, 200);
  return "authorization_failed";
}

function requiresReauth(error: unknown): boolean {
  if (error instanceof AuthorizationServerMismatchError || error instanceof ReauthRequiredError) {
    return true;
  }
  if (error instanceof OAuthError) {
    return (
      error.code === OAuthErrorCode.InvalidGrant ||
      error.code === OAuthErrorCode.InvalidClient ||
      error.code === OAuthErrorCode.UnauthorizedClient
    );
  }
  return false;
}

function asConnectorError(
  error: unknown,
  reason: string,
  fallback: ConnectorErrorCode,
): ConnectorError {
  if (error instanceof ConnectorError) return error;
  if (error instanceof AuthorizationServerMismatchError) {
    return new ConnectorError("oauth_issuer", "The authorization server's issuer did not match");
  }
  return new ConnectorError(fallback, `Authorization failed: ${reason}`);
}

function deleteAttempt(store: OAuthStore, deps: OAuthServiceDeps, attemptId: string): void {
  store.deleteAttemptSecret(attemptId);
  deps.db.delete(oauthAttempts).where(eq(oauthAttempts.id, attemptId)).run();
}

function hasLiveAttempt(deps: OAuthServiceDeps, connectorId: string): boolean {
  return (
    deps.db
      .select({ id: oauthAttempts.id })
      .from(oauthAttempts)
      .where(
        and(
          eq(oauthAttempts.userId, deps.userId),
          eq(oauthAttempts.connectorId, connectorId),
          isNull(oauthAttempts.consumedAt),
          gt(oauthAttempts.expiresAt, new Date().toISOString()),
        ),
      )
      .all().length > 0
  );
}

function attemptIdsFor(deps: OAuthServiceDeps, connectorId: string): string[] {
  return deps.db
    .select({ id: oauthAttempts.id })
    .from(oauthAttempts)
    .where(and(eq(oauthAttempts.userId, deps.userId), eq(oauthAttempts.connectorId, connectorId)))
    .all()
    .map((attempt) => attempt.id);
}

async function connectorIsDiscardable(
  deps: OAuthServiceDeps,
  store: OAuthStore,
  connectorId: string,
  keepConnectorId?: string,
): Promise<boolean> {
  if (connectorId === keepConnectorId) return false;
  const connector = deps.db
    .select()
    .from(connectors)
    .where(and(eq(connectors.userId, deps.userId), eq(connectors.id, connectorId)))
    .all()[0];
  if (connector?.authType !== "oauth" || connector.authStatus !== "pending") return false;
  try {
    if ((await store.connectorState(connectorId)).tokens !== undefined) return false;
  } catch (error) {
    // An unreadable credential is not proof the flow never finished; keep the connector.
    if (error instanceof VaultError) return false;
    throw error;
  }
  return !hasLiveAttempt(deps, connectorId);
}

async function pruneExpiredAttempts(
  deps: OAuthServiceDeps,
  keepConnectorId?: string,
): Promise<void> {
  const rows = deps.db
    .select()
    .from(oauthAttempts)
    .where(
      and(
        eq(oauthAttempts.userId, deps.userId),
        isNull(oauthAttempts.consumedAt),
        lte(oauthAttempts.expiresAt, new Date().toISOString()),
      ),
    )
    .all();
  if (rows.length === 0) return;

  const attemptIdsByConnector = new Map<string, string[]>();
  for (const row of rows) {
    const attemptIds = attemptIdsByConnector.get(row.connectorId);
    if (attemptIds === undefined) attemptIdsByConnector.set(row.connectorId, [row.id]);
    else attemptIds.push(row.id);
  }

  const store = new OAuthStore(deps.vault, deps.store);
  for (const [connectorId, attemptIds] of attemptIdsByConnector) {
    if (await connectorIsDiscardable(deps, store, connectorId, keepConnectorId)) {
      discardConnector(deps, connectorId, attemptIdsFor(deps, connectorId));
    } else {
      for (const attemptId of attemptIds) deleteAttempt(store, deps, attemptId);
    }
  }
}

function discardConnector(deps: OAuthServiceDeps, connectorId: string, attemptIds: string[]): void {
  const store = new OAuthStore(deps.vault, deps.store);
  for (const attemptId of attemptIds) deleteAttempt(store, deps, attemptId);
  deps.store.remove(connectorId);
  deps.db
    .delete(connectors)
    .where(and(eq(connectors.userId, deps.userId), eq(connectors.id, connectorId)))
    .run();
}

async function sweepPendingConnectors(
  deps: OAuthServiceDeps,
  keepConnectorId?: string,
): Promise<void> {
  const rows = deps.db
    .select()
    .from(connectors)
    .where(
      and(
        eq(connectors.userId, deps.userId),
        eq(connectors.authType, "oauth"),
        eq(connectors.authStatus, "pending"),
      ),
    )
    .all();
  const store = new OAuthStore(deps.vault, deps.store);
  for (const row of rows) {
    if (!(await connectorIsDiscardable(deps, store, row.id, keepConnectorId))) continue;
    discardConnector(deps, row.id, attemptIdsFor(deps, row.id));
  }
}

// Both a new flow and a re-auth start by clearing attempts and connectors that
// can no longer complete, except the connector the human is explicitly re-authorizing.
async function cleanupDeadConnectors(
  deps: OAuthServiceDeps,
  keepConnectorId?: string,
): Promise<void> {
  await pruneExpiredAttempts(deps, keepConnectorId);
  await sweepPendingConnectors(deps, keepConnectorId);
}

function pruneAttempts(deps: OAuthServiceDeps, connectorId: string): void {
  const rows = deps.db
    .select()
    .from(oauthAttempts)
    .where(and(eq(oauthAttempts.userId, deps.userId), eq(oauthAttempts.connectorId, connectorId)))
    .all()
    .filter((row) => row.consumedAt === null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const excess = rows.length - MAX_ATTEMPTS_PER_CONNECTOR;
  if (excess <= 0) return;
  const store = new OAuthStore(deps.vault, deps.store);
  for (const row of rows.slice(0, excess)) deleteAttempt(store, deps, row.id);
}

async function runAuthorizationLeg(
  deps: OAuthServiceDeps,
  connectorId: string,
  serverUrl: string,
  store: OAuthStore,
  leg: AuthorizationLeg,
): Promise<void> {
  const result = await auth(providerFor(deps, store, connectorId, leg), {
    serverUrl,
    ...(leg.code === undefined ? {} : { authorizationCode: leg.code }),
    ...(leg.iss === undefined ? {} : { iss: leg.iss }),
    fetchFn: guardedFetch(deps.discoverOptions),
  });
  const expected = leg.onAuthorizationUrl === undefined ? "AUTHORIZED" : "REDIRECT";
  if (result !== expected) {
    throw new ReauthRequiredError(`The authorization server returned ${result}`);
  }
}

// Both a fresh connection and a re-authorization start with the same leg: the
// URL the human must visit, with the verifier kept in the vault.
async function beginAuthorization(
  deps: OAuthServiceDeps,
  connectorId: string,
  serverUrl: string,
  store: OAuthStore,
  attemptId: string,
  state: string,
): Promise<{ authorizationUrl: string }> {
  let authorizationUrl: string | undefined;
  await runAuthorizationLeg(deps, connectorId, serverUrl, store, {
    attemptId,
    state,
    onAuthorizationUrl: (url) => {
      authorizationUrl = url.href;
    },
  });
  if (authorizationUrl === undefined) {
    throw new Error("The authorization server did not return an authorization URL");
  }
  return { authorizationUrl };
}

function insertAttempt(
  deps: OAuthServiceDeps,
  values: { attemptId: string; connectorId: string; state: string; now: Date },
): void {
  deps.db
    .insert(oauthAttempts)
    .values({
      id: values.attemptId,
      userId: deps.userId,
      connectorId: values.connectorId,
      state: values.state,
      redirectUri: deps.redirectUri,
      createdAt: values.now.toISOString(),
      expiresAt: new Date(values.now.getTime() + OAUTH_ATTEMPT_TTL_MS).toISOString(),
    })
    .run();
}

async function authorizeAndAnnounce(
  deps: OAuthServiceDeps,
  input: {
    connectorId: string;
    url: string;
    store: OAuthStore;
    attemptId: string;
    state: string;
    eventType: "connector.oauth_started" | "connector.oauth_restarted";
  },
): Promise<OAuthStartResult> {
  const { authorizationUrl } = await beginAuthorization(
    deps,
    input.connectorId,
    input.url,
    input.store,
    input.attemptId,
    input.state,
  );
  pruneAttempts(deps, input.connectorId);
  recordEvent(deps.db, {
    userId: deps.userId,
    eventType: input.eventType,
    payload: { connector_id: input.connectorId, host: new URL(input.url).host },
  });
  return {
    connector: connectorView(connectorRow(deps, input.connectorId)),
    authorizationUrl,
    attemptId: input.attemptId,
  };
}

export async function startOAuthFlow(
  deps: OAuthServiceDeps,
  input: { name: string; url: string },
): Promise<OAuthStartResult> {
  await cleanupDeadConnectors(deps);
  assertConnectorQuota(deps.db, deps.userId, deps.maxConnectors);
  const normalized = (await assertFetchableUrl(input.url, deps.discoverOptions)).href;
  const now = new Date();
  const connectorId = randomUUID();
  const attemptId = randomUUID();
  const state = randomBytes(32).toString("base64url");

  deps.db
    .insert(connectors)
    .values({
      id: connectorId,
      userId: deps.userId,
      name: input.name,
      url: normalized,
      transport: "streamable-http",
      authType: "oauth",
      authStatus: "pending",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
    .run();
  insertAttempt(deps, { attemptId, connectorId, state, now });

  const store = new OAuthStore(deps.vault, deps.store);
  try {
    return await authorizeAndAnnounce(deps, {
      connectorId,
      url: normalized,
      store,
      attemptId,
      state,
      eventType: "connector.oauth_started",
    });
  } catch (error) {
    discardConnector(deps, connectorId, [attemptId]);
    throw asConnectorError(error, failureReason(error), "oauth_failed");
  }
}

// Re-authorization keeps the connector, its catalog and its pinned approvals;
// only the tokens are replaced when the callback completes.
export async function startOAuthReauth(
  deps: OAuthServiceDeps,
  connectorId: string,
): Promise<OAuthStartResult> {
  await cleanupDeadConnectors(deps, connectorId);
  const row = connectorRow(deps, connectorId);
  if (row.authType !== "oauth") {
    throw new ConnectorError("reauth", "Only an OAuth connector can be re-authorized in a browser");
  }
  const now = new Date();
  const attemptId = randomUUID();
  const state = randomBytes(32).toString("base64url");
  insertAttempt(deps, { attemptId, connectorId, state, now });
  deps.db
    .update(connectors)
    .set({ authStatus: "pending", updatedAt: now.toISOString() })
    .where(and(eq(connectors.userId, deps.userId), eq(connectors.id, connectorId)))
    .run();

  const store = new OAuthStore(deps.vault, deps.store);
  try {
    return await authorizeAndAnnounce(deps, {
      connectorId,
      url: row.url,
      store,
      attemptId,
      state,
      eventType: "connector.oauth_restarted",
    });
  } catch (error) {
    deleteAttempt(store, deps, attemptId);
    markConnectorNeedsReauth(deps, connectorId, failureReason(error));
    throw asConnectorError(error, failureReason(error), "reauth");
  }
}

export async function completeOAuthFlow(
  deps: OAuthServiceDeps,
  input: { state: string; code: string; iss?: string },
): Promise<OAuthCompleteResult> {
  await pruneExpiredAttempts(deps);
  const attempt = scopedGet(
    deps.db,
    oauthAttempts,
    oauthAttempts.userId,
    deps.userId,
    oauthAttempts.state,
    input.state,
  );
  if (attempt === undefined || attempt.consumedAt !== null) {
    throw new ConnectorError("oauth_state", "The authorization state is unknown or already used");
  }
  const store = new OAuthStore(deps.vault, deps.store);
  if (Date.parse(attempt.expiresAt) <= Date.now()) {
    deleteAttempt(store, deps, attempt.id);
    throw new ConnectorError("oauth_state", "The authorization attempt expired; start again");
  }
  if (attempt.redirectUri !== deps.redirectUri) {
    deleteAttempt(store, deps, attempt.id);
    throw new ConnectorError("oauth_state", "The redirect URI does not match this attempt exactly");
  }

  const consumed = deps.db
    .update(oauthAttempts)
    .set({ consumedAt: new Date().toISOString() })
    .where(and(eq(oauthAttempts.id, attempt.id), isNull(oauthAttempts.consumedAt)))
    .returning({ id: oauthAttempts.id })
    .all();
  if (consumed.length !== 1) {
    throw new ConnectorError("oauth_state", "The authorization state is unknown or already used");
  }

  const row = connectorRow(deps, attempt.connectorId);
  const issuerMetadata = (await store.connectorState(row.id)).discoveryState
    ?.authorizationServerMetadata;
  const issuerRequired = issuerMetadata?.authorization_response_iss_parameter_supported === true;
  const issuerMismatch =
    input.iss !== undefined &&
    issuerMetadata?.issuer !== undefined &&
    input.iss !== issuerMetadata.issuer;
  if ((issuerRequired && input.iss === undefined) || issuerMismatch) {
    deleteAttempt(store, deps, attempt.id);
    markConnectorNeedsReauth(deps, row.id, "issuer_mismatch");
    throw new ConnectorError(
      "oauth_issuer",
      "The callback issuer did not match the authorization server",
    );
  }

  try {
    await runAuthorizationLeg(deps, row.id, row.url, store, {
      attemptId: attempt.id,
      state: attempt.state,
      code: input.code,
      ...(input.iss === undefined ? {} : { iss: input.iss }),
    });
  } catch (error) {
    const reason = failureReason(error);
    deleteAttempt(store, deps, attempt.id);
    markConnectorNeedsReauth(deps, row.id, reason);
    throw asConnectorError(error, reason, "reauth");
  }
  deleteAttempt(store, deps, attempt.id);

  const tokens = (await store.connectorState(row.id)).tokens;
  if (tokens === undefined) {
    markConnectorNeedsReauth(deps, row.id, "no_tokens");
    throw new ConnectorError("reauth", "The authorization server issued no tokens");
  }

  let connection: McpConnection;
  try {
    connection = await discoverMcpTools(
      row.url,
      { type: "oauth", accessToken: tokens.access_token },
      deps.discoverOptions,
    );
  } catch (error) {
    if (error instanceof McpConnectError && error.code === "auth") {
      markConnectorNeedsReauth(deps, row.id, "upstream_401");
    } else {
      setConnectorAuthStatus(deps, row.id, "active", failureReason(error));
      recordEvent(deps.db, {
        userId: deps.userId,
        eventType: "connector.oauth_discovery_failed",
        payload: { connector_id: row.id, reason: failureReason(error) },
      });
    }
    throw error;
  }

  setConnectorAuthStatus(deps, row.id, "active", null);
  recordEvent(deps.db, {
    userId: deps.userId,
    eventType: "connector.oauth_authorized",
    payload: { connector_id: row.id, host: new URL(row.url).host },
  });
  const summary = applyDiscovery(deps, row.id, row.name, connection, "catalog.ingested");

  return {
    connector: connectorView(connectorRow(deps, row.id)),
    transport: connection.transport,
    tools: connection.tools,
    summary,
  };
}

// Runs inside the per-connector lock so a rotated refresh token cannot be
// presented twice.
export function refreshOAuthAccessToken(
  deps: OAuthServiceDeps,
  connectorId: string,
): Promise<string> {
  return withConnectorLock(connectorId, async () => {
    const row = connectorRow(deps, connectorId);
    const store = new OAuthStore(deps.vault, deps.store);
    const state = await store.connectorState(connectorId);
    if (state.tokens === undefined) {
      markConnectorNeedsReauth(deps, connectorId, "no_tokens");
      throw new ConnectorError("reauth", "This connector has no tokens; sign in again");
    }

    try {
      await runAuthorizationLeg(deps, connectorId, row.url, store, {});
    } catch (error) {
      const reason = failureReason(error);
      const reauth = requiresReauth(error) || connectorRow(deps, connectorId).authStatus === "needs_reauth";
      if (reauth) {
        markConnectorNeedsReauth(deps, connectorId, reason);
      } else {
        setConnectorAuthStatus(deps, connectorId, "active", reason);
        recordEvent(deps.db, {
          userId: deps.userId,
          eventType: "connector.oauth_refresh_failed",
          payload: { connector_id: connectorId, reason },
        });
      }
      throw asConnectorError(error, reason, reauth ? "reauth" : "oauth_failed");
    }

    const refreshed = await store.connectorState(connectorId);
    const accessToken = refreshed.tokens?.access_token;
    if (accessToken === undefined) {
      markConnectorNeedsReauth(deps, connectorId, "no_tokens");
      throw new ConnectorError("reauth", "The refresh produced no access token");
    }
    return accessToken;
  });
}

export async function refreshOAuthConnection(
  deps: OAuthServiceDeps,
  connectorId: string,
): Promise<McpConnection> {
  const row = connectorRow(deps, connectorId);
  const accessToken = await refreshOAuthAccessToken(deps, connectorId);

  try {
    const connection = await discoverMcpTools(
      row.url,
      { type: "oauth", accessToken },
      deps.discoverOptions,
    );
    setConnectorAuthStatus(deps, connectorId, "active", null);
    recordEvent(deps.db, {
      userId: deps.userId,
      eventType: "connector.oauth_refreshed",
      payload: { connector_id: connectorId },
    });
    return connection;
  } catch (error) {
    if (error instanceof McpConnectError && error.code === "auth") {
      markConnectorNeedsReauth(deps, connectorId, "upstream_401");
      throw new ConnectorError("reauth", "The upstream still rejected the refreshed token");
    }
    throw error;
  }
}
