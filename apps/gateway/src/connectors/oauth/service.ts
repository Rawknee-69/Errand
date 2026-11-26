import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull, lte } from "drizzle-orm";
import {
  AuthorizationServerMismatchError,
  OAuthError,
  OAuthErrorCode,
  auth,
  type FetchLike,
} from "@modelcontextprotocol/client";
import { appendJournalEvent } from "../../db/journal.ts";
import { oauthAttempts, connectors } from "../../db/schema.ts";
import { scopedGet } from "../../db/scoped-reads.ts";
import { assertFetchableUrl, egressRequest } from "../../egress/guard.ts";
import { assertConnectorQuota } from "../quota.ts";
import { ConnectorError, type ConnectorErrorCode } from "../errors.ts";
import { applyDiscovery } from "../discovery.ts";
import {
  connectorRow,
  connectorView,
  setConnectorAuthStatus,
  type ConnectorBaseDeps,
  type ConnectorView,
} from "../records.ts";
import {
  discoverMcpTools,
  McpConnectError,
  type DiscoverOptions,
  type McpConnection,
  type McpTransportKind,
} from "../mcp.ts";
import type { DiscoveredTool, IngestSummary } from "../catalog.ts";
import type { CredentialStore } from "../../vault/credentials.ts";
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
    onCredentialsInvalidated: (scope) => markNeedsReauth(deps, connectorId, `invalidated_${scope}`),
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

// Emits once per transition into needs_reauth; a second failure while already
// needing a sign-in updates the reason without spamming the journal.
function markNeedsReauth(deps: OAuthServiceDeps, connectorId: string, reason: string): void {
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

function deleteAttempt(store: OAuthStore, deps: OAuthServiceDeps, attemptId: string): void {
  store.deleteAttemptSecret(attemptId);
  deps.db.delete(oauthAttempts).where(eq(oauthAttempts.id, attemptId)).run();
}

function pruneExpiredAttempts(deps: OAuthServiceDeps): void {
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
  const store = new OAuthStore(deps.vault, deps.store);
  for (const row of rows) deleteAttempt(store, deps, row.id);
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

export async function startOAuthFlow(
  deps: OAuthServiceDeps,
  input: { name: string; url: string },
): Promise<OAuthStartResult> {
  pruneExpiredAttempts(deps);
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
  deps.db
    .insert(oauthAttempts)
    .values({
      id: attemptId,
      userId: deps.userId,
      connectorId,
      state,
      redirectUri: deps.redirectUri,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + OAUTH_ATTEMPT_TTL_MS).toISOString(),
    })
    .run();

  const store = new OAuthStore(deps.vault, deps.store);
  let authorizationUrl: string | undefined;

  try {
    await runAuthorizationLeg(deps, connectorId, normalized, store, {
      attemptId,
      state,
      onAuthorizationUrl: (url) => {
        authorizationUrl = url.href;
      },
    });
    if (authorizationUrl === undefined) {
      throw new Error("The authorization server did not return an authorization URL");
    }
    pruneAttempts(deps, connectorId);
    appendJournalEvent(deps.db, {
      userId: deps.userId,
      eventType: "connector.oauth_started",
      payload: { connectorId, host: new URL(normalized).host },
    });
    return {
      connector: connectorView(connectorRow(deps, connectorId)),
      authorizationUrl,
      attemptId,
    };
  } catch (error) {
    discardConnector(deps, connectorId, [attemptId]);
    throw asConnectorError(error, failureReason(error), "oauth_failed");
  }
}

export async function completeOAuthFlow(
  deps: OAuthServiceDeps,
  input: { state: string; code: string; iss?: string },
): Promise<OAuthCompleteResult> {
  pruneExpiredAttempts(deps);
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
    markNeedsReauth(deps, row.id, "issuer_mismatch");
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
    markNeedsReauth(deps, row.id, reason);
    throw asConnectorError(error, reason, "reauth");
  }
  deleteAttempt(store, deps, attempt.id);

  const tokens = (await store.connectorState(row.id)).tokens;
  if (tokens === undefined) {
    markNeedsReauth(deps, row.id, "no_tokens");
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
      markNeedsReauth(deps, row.id, "upstream_401");
    } else {
      setConnectorAuthStatus(deps, row.id, "active", failureReason(error));
      appendJournalEvent(deps.db, {
        userId: deps.userId,
        eventType: "connector.oauth_discovery_failed",
        payload: { connectorId: row.id, reason: failureReason(error) },
      });
    }
    throw error;
  }

  setConnectorAuthStatus(deps, row.id, "active", null);
  appendJournalEvent(deps.db, {
    userId: deps.userId,
    eventType: "connector.oauth_authorized",
    payload: { connectorId: row.id, host: new URL(row.url).host },
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
export function refreshOAuthConnection(
  deps: OAuthServiceDeps,
  connectorId: string,
): Promise<McpConnection> {
  return withConnectorLock(connectorId, async () => {
    const row = connectorRow(deps, connectorId);
    const store = new OAuthStore(deps.vault, deps.store);
    const state = await store.connectorState(connectorId);
    if (state.tokens === undefined) {
      markNeedsReauth(deps, connectorId, "no_tokens");
      throw new ConnectorError("reauth", "This connector has no tokens; sign in again");
    }

    try {
      await runAuthorizationLeg(deps, connectorId, row.url, store, {});
    } catch (error) {
      const reason = failureReason(error);
      const reauth = requiresReauth(error) || connectorRow(deps, connectorId).authStatus === "needs_reauth";
      if (reauth) {
        markNeedsReauth(deps, connectorId, reason);
      } else {
        setConnectorAuthStatus(deps, connectorId, "active", reason);
        appendJournalEvent(deps.db, {
          userId: deps.userId,
          eventType: "connector.oauth_refresh_failed",
          payload: { connectorId, reason },
        });
      }
      throw asConnectorError(error, reason, reauth ? "reauth" : "oauth_failed");
    }

    const refreshed = await store.connectorState(connectorId);
    const accessToken = refreshed.tokens?.access_token;
    if (accessToken === undefined) {
      markNeedsReauth(deps, connectorId, "no_tokens");
      throw new ConnectorError("reauth", "The refresh produced no access token");
    }

    try {
      const connection = await discoverMcpTools(
        row.url,
        { type: "oauth", accessToken },
        deps.discoverOptions,
      );
      setConnectorAuthStatus(deps, connectorId, "active", null);
      appendJournalEvent(deps.db, {
        userId: deps.userId,
        eventType: "connector.oauth_refreshed",
        payload: { connectorId },
      });
      return connection;
    } catch (error) {
      if (error instanceof McpConnectError && error.code === "auth") {
        markNeedsReauth(deps, connectorId, "upstream_401");
        throw new ConnectorError("reauth", "The upstream still rejected the refreshed token");
      }
      throw error;
    }
  });
}
