import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  AuthorizationServerMismatchError,
  OAuthError,
  auth,
  type FetchLike,
} from "@modelcontextprotocol/client";
import { appendJournalEvent } from "../../db/journal.ts";
import { oauthAttempts, connectors } from "../../db/schema.ts";
import { scopedGet } from "../../db/scoped-reads.ts";
import { assertFetchableUrl, egressRequest } from "../../egress/guard.ts";
import { assertConnectorQuota } from "../quota.ts";
import { ConnectorError } from "../errors.ts";
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

function guardedFetch(options: DiscoverOptions): FetchLike {
  return (url, init) => egressRequest(url, init ?? {}, options);
}

function providerFor(
  deps: OAuthServiceDeps,
  store: OAuthStore,
  connectorId: string,
  options: {
    refreshOnly: boolean;
    attemptId?: string;
    state?: string;
    onAuthorizationUrl?: (url: URL) => void;
  },
) {
  return createConnectorOAuthProvider({
    redirectUri: deps.redirectUri,
    refreshOnly: options.refreshOnly,
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
  if (error instanceof Error && error.message.length > 0) return error.message.slice(0, 200);
  return "authorization_failed";
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

function asConnectorError(error: unknown, reason: string): ConnectorError {
  if (error instanceof ConnectorError) return error;
  if (error instanceof AuthorizationServerMismatchError) {
    return new ConnectorError("oauth_issuer", "The authorization server's issuer did not match");
  }
  return new ConnectorError("reauth", `Authorization failed: ${reason}`);
}

function discardConnector(deps: OAuthServiceDeps, connectorId: string, attemptIds: string[]): void {
  const store = new OAuthStore(deps.vault, deps.store);
  for (const attemptId of attemptIds) {
    store.deleteAttemptSecret(attemptId);
    deps.db.delete(oauthAttempts).where(eq(oauthAttempts.id, attemptId)).run();
  }
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
  for (const row of rows.slice(0, excess)) {
    store.deleteAttemptSecret(row.id);
    deps.db.delete(oauthAttempts).where(eq(oauthAttempts.id, row.id)).run();
  }
}

export async function startOAuthFlow(
  deps: OAuthServiceDeps,
  input: { name: string; url: string },
): Promise<OAuthStartResult> {
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
  const provider = providerFor(deps, store, connectorId, {
    refreshOnly: false,
    attemptId,
    state,
    onAuthorizationUrl: (url) => {
      authorizationUrl = url.href;
    },
  });

  try {
    const result = await auth(provider, {
      serverUrl: normalized,
      fetchFn: guardedFetch(deps.discoverOptions),
    });
    if (result !== "REDIRECT" || authorizationUrl === undefined) {
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
    throw asConnectorError(error, failureReason(error));
  }
}

export async function completeOAuthFlow(
  deps: OAuthServiceDeps,
  input: { state: string; code: string; iss?: string },
): Promise<OAuthCompleteResult> {
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
    store.deleteAttemptSecret(attempt.id);
    deps.db.delete(oauthAttempts).where(eq(oauthAttempts.id, attempt.id)).run();
    throw new ConnectorError("oauth_state", "The authorization attempt expired; start again");
  }
  if (attempt.redirectUri !== deps.redirectUri) {
    store.deleteAttemptSecret(attempt.id);
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
  const recordedIssuer = (await store.connectorState(row.id)).discoveryState
    ?.authorizationServerMetadata?.issuer;
  if (input.iss !== undefined && recordedIssuer !== undefined && input.iss !== recordedIssuer) {
    const reason = "issuer_mismatch";
    store.deleteAttemptSecret(attempt.id);
    markNeedsReauth(deps, row.id, reason);
    throw new ConnectorError("oauth_issuer", "The callback issuer did not match the authorization server");
  }
  const provider = providerFor(deps, store, row.id, {
    refreshOnly: true,
    attemptId: attempt.id,
    state: attempt.state,
  });

  try {
    const result = await auth(provider, {
      serverUrl: row.url,
      authorizationCode: input.code,
      ...(input.iss === undefined ? {} : { iss: input.iss }),
      fetchFn: guardedFetch(deps.discoverOptions),
    });
    if (result !== "AUTHORIZED") {
      throw new ReauthRequiredError("The authorization code was not exchanged");
    }
  } catch (error) {
    const reason = failureReason(error);
    markNeedsReauth(deps, row.id, reason);
    store.deleteAttemptSecret(attempt.id);
    throw asConnectorError(error, reason);
  }

  store.deleteAttemptSecret(attempt.id);
  const tokens = (await store.connectorState(row.id)).tokens;
  if (tokens === undefined) {
    const reason = "no_tokens";
    markNeedsReauth(deps, row.id, reason);
    throw new ConnectorError("reauth", "The authorization server issued no tokens");
  }

  const connection = await discoverMcpTools(
    row.url,
    { type: "oauth", accessToken: tokens.access_token },
    deps.discoverOptions,
  );
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

    const provider = providerFor(deps, store, connectorId, { refreshOnly: true });
    try {
      const result = await auth(provider, {
        serverUrl: row.url,
        fetchFn: guardedFetch(deps.discoverOptions),
      });
      if (result !== "AUTHORIZED") {
        throw new ReauthRequiredError("The stored credentials could not be refreshed");
      }
    } catch (error) {
      const reason = failureReason(error);
      markNeedsReauth(deps, connectorId, reason);
      throw asConnectorError(error, reason);
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
