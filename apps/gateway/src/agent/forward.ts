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
import { createConnectorServiceDeps } from "../connectors/service.ts";
import type { CallDecision } from "../policy/pipeline.ts";
import { VaultError } from "../vault/common.ts";
import type { VaultKeyring } from "../vault/keyring.ts";

export type AdmittedCall = Extract<CallDecision, { outcome: "admitted" }>;

export type ForwardFailureCode =
  | "upstream_timeout"
  | "upstream_error"
  | "upstream_egress"
  | "upstream_auth"
  | "credential_unavailable";

export type NotForwardedReason = "outbox_not_installed" | "spend_tap_not_installed";

export type ForwardOutcome =
  | { state: "forwarded"; result: ConnectorToolResult; durationMs: number }
  | { state: "not_forwarded"; reason: NotForwardedReason }
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

function failureFrom(error: unknown, tool: string): ForwardFailure {
  if (error instanceof ConnectorCallError) {
    return { error: FAILURE_CODES[error.code], message: error.message };
  }
  if (error instanceof VaultError) {
    return {
      error: "credential_unavailable",
      message: `The vault could not supply a credential for ${tool}`,
    };
  }
  if (error instanceof ConnectorError) {
    if (error.code === "credential") {
      return { error: "credential_unavailable", message: `The stored credential for ${tool} is unusable` };
    }
    if (error.code === "reauth" || error.code === "oauth_failed" || error.code === "oauth_issuer") {
      return { error: "upstream_auth", message: `The connector for ${tool} needs to be authorized again` };
    }
  }
  const detail = error instanceof Error ? error.message : String(error);
  return { error: "upstream_error", message: `The upstream call to ${tool} failed: ${detail.slice(0, 300)}` };
}

type ForwardFailure = { error: ForwardFailureCode; message: string };

function insertCall(
  db: Db,
  userId: string,
  decision: AdmittedCall,
  args: Record<string, unknown>,
  outcome: { result: string | null; error: string | null },
): string {
  const callId = randomUUID();
  db.insert(calls)
    .values({
      id: callId,
      userId,
      slipId: decision.slipId,
      connectorId: decision.connectorId,
      tool: decision.tool,
      arguments: JSON.stringify(args),
      result: outcome.result,
      error: outcome.error,
      createdAt: new Date().toISOString(),
    })
    .run();
  return callId;
}

function recordSuccess(
  db: Db,
  userId: string,
  decision: AdmittedCall,
  args: Record<string, unknown>,
  result: ConnectorToolResult,
  durationMs: number,
): void {
  const serialized = JSON.stringify(result);
  const callId = insertCall(db, userId, decision, args, { result: serialized, error: null });
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
      upstream_is_error: result.isError,
    },
  });
  markConnectorSuccess({ db, userId }, decision.connectorId);
}

function recordFailure(
  db: Db,
  userId: string,
  decision: AdmittedCall,
  args: Record<string, unknown>,
  failure: ForwardFailure,
  durationMs: number,
): void {
  const callId = insertCall(db, userId, decision, args, {
    result: null,
    error: failure.message,
  });
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

// Sends and spends are admitted by policy but cannot run until ticket #12
// installs the outbox and the spend tap.
function notForwarded(reason: NotForwardedReason): ForwardOutcome {
  return { state: "not_forwarded", reason };
}

export function createForwarder(options: ForwarderOptions): Forwarder {
  const limiter = new ConnectorLimiter(
    options.connectorConcurrency ?? DEFAULT_CONNECTOR_CONCURRENCY,
  );
  const callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const resultCapBytes = options.resultCapBytes ?? DEFAULT_RESULT_CAP_BYTES;

  return async (userId, decision, args) => {
    switch (decision.class) {
      case "send":
        return notForwarded("outbox_not_installed");
      case "spend":
        return notForwarded("spend_tap_not_installed");
      case "unknown": {
        const failure = {
          error: "upstream_error" as const,
          message: `${decision.tool} has no forwardable class`,
        };
        recordFailure(options.db, userId, decision, args, failure, 0);
        return { state: "failed", ...failure, durationMs: 0 };
      }
      case "read":
      case "write":
      case "delete":
        break;
    }

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
    const deadline = started + callTimeoutMs;
    let result: ConnectorToolResult | undefined;
    let failure: ForwardFailure | undefined;
    try {
      result = await limiter.run(connector.id, () =>
        callConnectorTool(
          createConnectorServiceDeps(
            options.db,
            options.keyring,
            userId,
            options.discoverOptions,
            options.redirectUri,
          ),
          {
            id: connector.id,
            url: connector.url,
            transport: connector.transport,
            authType: connector.authType,
          },
          decision.upstreamTool,
          args,
          { timeoutMs: Math.max(1, deadline - Date.now()), resultCapBytes },
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
