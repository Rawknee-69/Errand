import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.ts";
import { appendJournalEvent } from "../db/journal.ts";
import { getConnector } from "../db/scoped-reads.ts";
import { calls } from "../db/schema.ts";
import {
  callConnectorTool,
  ConnectorCallError,
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_CONNECTOR_CONCURRENCY,
  DEFAULT_RESULT_CAP_BYTES,
  type ConnectorCallFailure,
  type ConnectorToolResult,
} from "../connectors/call.ts";
import { ConnectorLimiter } from "../connectors/concurrency.ts";
import { ConnectorError } from "../connectors/errors.ts";
import type { DiscoverOptions } from "../connectors/mcp.ts";
import { markConnectorNeedsReauth, markConnectorSuccess } from "../connectors/records.ts";
import type { OAuthServiceDeps } from "../connectors/oauth/service.ts";
import type { CallDecision } from "../policy/pipeline.ts";
import { CredentialStore } from "../vault/credentials.ts";
import { VaultError } from "../vault/common.ts";
import type { VaultKeyring } from "../vault/keyring.ts";
import { Vault } from "../vault/vault.ts";

export type AdmittedCall = Extract<CallDecision, { outcome: "admitted" }>;

export type ForwardFailureCode =
  | "upstream_timeout"
  | "upstream_error"
  | "upstream_egress"
  | "upstream_auth"
  | "credential_unavailable";

export type ForwardOutcome =
  | { state: "forwarded"; result: ConnectorToolResult; durationMs: number }
  | { state: "not_forwarded"; reason: "outbox_not_installed" | "spend_tap_not_installed" }
  | { state: "failed"; error: ForwardFailureCode; message: string; durationMs: number };

export type ForwarderOptions = {
  db: Db;
  keyring: VaultKeyring;
  discoverOptions: DiscoverOptions;
  redirectUri: string;
  callTimeoutMs?: number;
  connectorConcurrency?: number;
  resultCapBytes?: number;
};

export type Forwarder = (
  userId: string,
  decision: AdmittedCall,
  args: Record<string, unknown>,
) => Promise<ForwardOutcome>;

const FAILURE_CODES: Record<ConnectorCallFailure, ForwardFailureCode> = {
  auth: "upstream_auth",
  credential: "credential_unavailable",
  timeout: "upstream_timeout",
  egress: "upstream_egress",
  upstream: "upstream_error",
};

function failureFrom(error: unknown, tool: string): { error: ForwardFailureCode; message: string } {
  if (error instanceof ConnectorCallError) {
    return { error: FAILURE_CODES[error.code], message: error.message };
  }
  if (error instanceof VaultError) {
    return {
      error: "credential_unavailable",
      message: `The vault could not supply a credential for ${tool}`,
    };
  }
  if (error instanceof ConnectorError && error.code === "credential") {
    return { error: "credential_unavailable", message: `The stored credential for ${tool} is unusable` };
  }
  const detail = error instanceof Error ? error.message : String(error);
  return { error: "upstream_error", message: `The upstream call to ${tool} failed: ${detail.slice(0, 300)}` };
}

function serviceDeps(options: ForwarderOptions, userId: string): OAuthServiceDeps {
  return {
    db: options.db,
    userId,
    vault: new Vault(options.db, options.keyring, userId),
    store: new CredentialStore(options.db, options.keyring, userId),
    discoverOptions: options.discoverOptions,
    redirectUri: options.redirectUri,
  };
}

function recordSuccess(
  db: Db,
  userId: string,
  decision: AdmittedCall,
  args: Record<string, unknown>,
  result: ConnectorToolResult,
  durationMs: number,
): void {
  const callId = randomUUID();
  const serialized = JSON.stringify(result);
  db.insert(calls)
    .values({
      id: callId,
      userId,
      slipId: decision.slipId,
      connectorId: decision.connectorId,
      tool: decision.tool,
      arguments: JSON.stringify(args),
      result: serialized,
      createdAt: new Date().toISOString(),
    })
    .run();
  appendJournalEvent(db, {
    userId,
    eventType: "call.succeeded",
    payload: {
      slip_id: decision.slipId,
      tool: decision.tool,
      connector_id: decision.connectorId,
      call_id: callId,
      class: decision.class,
      duration_ms: durationMs,
      result_bytes: Buffer.byteLength(serialized, "utf8"),
      truncated: result.truncated,
    },
  });
  markConnectorSuccess({ db, userId }, decision.connectorId);
}

function recordFailure(
  db: Db,
  userId: string,
  decision: AdmittedCall,
  args: Record<string, unknown>,
  failure: { error: ForwardFailureCode; message: string },
  durationMs: number,
): void {
  const callId = randomUUID();
  db.insert(calls)
    .values({
      id: callId,
      userId,
      slipId: decision.slipId,
      connectorId: decision.connectorId,
      tool: decision.tool,
      arguments: JSON.stringify(args),
      error: failure.message,
      createdAt: new Date().toISOString(),
    })
    .run();
  appendJournalEvent(db, {
    userId,
    eventType: "call.failed",
    payload: {
      slip_id: decision.slipId,
      tool: decision.tool,
      connector_id: decision.connectorId,
      call_id: callId,
      class: decision.class,
      reason: failure.error,
      message: failure.message,
      duration_ms: durationMs,
    },
  });
  if (failure.error === "upstream_auth" || failure.error === "credential_unavailable") {
    markConnectorNeedsReauth({ db, userId }, decision.connectorId, failure.error);
  }
}

// Sends and spends are admitted by policy but not forwarded until the outbox
// (ticket #12) and spend tap exist; deferring keeps them from running early.
function defer(
  db: Db,
  userId: string,
  decision: AdmittedCall,
  reason: "outbox_not_installed" | "spend_tap_not_installed",
): ForwardOutcome {
  appendJournalEvent(db, {
    userId,
    eventType: "call.deferred",
    payload: {
      slip_id: decision.slipId,
      tool: decision.tool,
      connector_id: decision.connectorId,
      class: decision.class,
      reason,
    },
  });
  return { state: "not_forwarded", reason };
}

export function createForwarder(options: ForwarderOptions): Forwarder {
  const limiter = new ConnectorLimiter(
    options.connectorConcurrency ?? DEFAULT_CONNECTOR_CONCURRENCY,
  );
  const callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const resultCapBytes = options.resultCapBytes ?? DEFAULT_RESULT_CAP_BYTES;

  return async (userId, decision, args) => {
    if (decision.class === "send") return defer(options.db, userId, decision, "outbox_not_installed");
    if (decision.class === "spend") return defer(options.db, userId, decision, "spend_tap_not_installed");

    const connector = getConnector(options.db, userId, decision.connectorId);
    if (connector === undefined) {
      const failure = {
        error: "upstream_error" as const,
        message: `The connector for ${decision.tool} disappeared before forwarding`,
      };
      recordFailure(options.db, userId, decision, args, failure, 0);
      return { state: "failed", ...failure, durationMs: 0 };
    }

    const started = Date.now();
    let result: ConnectorToolResult | undefined;
    let failure: { error: ForwardFailureCode; message: string } | undefined;
    try {
      result = await limiter.run(connector.id, () =>
        callConnectorTool(
          serviceDeps(options, userId),
          {
            id: connector.id,
            url: connector.url,
            transport: connector.transport,
            authType: connector.authType,
          },
          decision.upstreamTool,
          args,
          { timeoutMs: callTimeoutMs, resultCapBytes },
        ),
      );
    } catch (error) {
      failure = failureFrom(error, decision.tool);
    }
    const durationMs = Date.now() - started;

    if (result === undefined) {
      const failed = failure ?? {
        error: "upstream_error" as const,
        message: `The upstream call to ${decision.tool} failed`,
      };
      recordFailure(options.db, userId, decision, args, failed, durationMs);
      return { state: "failed", ...failed, durationMs };
    }

    recordSuccess(options.db, userId, decision, args, result, durationMs);
    return { state: "forwarded", result, durationMs };
  };
}
