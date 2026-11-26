import { randomUUID } from "node:crypto";
import type { ReceiptView } from "@errand/shared";
import type { Db } from "../db/client.ts";
import { appendJournalEvent } from "../db/journal.ts";
import { getConnector, getSlip } from "../db/scoped-reads.ts";
import { calls } from "../db/schema.ts";
import {
  callConnectorTool,
  ConnectorCallError,
  connectorTarget,
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
import { createConnectorServiceDeps, type ConnectorServiceDeps } from "../connectors/service.ts";
import { createOutboxService, type OutboxService } from "../outbox/service.ts";
import type { CallDecision } from "../policy/pipeline.ts";
import { recordReceipt } from "../receipts/receipts.ts";
import { verifyChange, type UpstreamRead } from "../receipts/verifier.ts";
import { settleSlip } from "../policy/trust.ts";
import { VaultError } from "../vault/common.ts";
import type { VaultKeyring } from "../vault/keyring.ts";

export type AdmittedCall = Extract<CallDecision, { outcome: "admitted" }>;

type ConnectorRow = NonNullable<ReturnType<typeof getConnector>>;

export type ForwardFailureCode =
  | "upstream_timeout"
  | "upstream_error"
  | "upstream_egress"
  | "upstream_auth"
  | "credential_unavailable";

export type ForwardOutcome =
  | {
      state: "forwarded";
      result: ConnectorToolResult;
      durationMs: number;
      callId: string;
      receipt?: ReceiptView;
    }
  | { state: "held"; outboxId: string; releaseAt: string | null; expiresAt: string }
  | { state: "needs_human"; outboxId: string; amountCents: number; expiresAt: string }
  | { state: "failed"; error: ForwardFailureCode; message: string; durationMs: number };

export type ForwarderOptions = {
  db: Db;
  keyring: VaultKeyring;
  discoverOptions: DiscoverOptions;
  redirectUri: string;
  hmacKey?: string | undefined;
  callTimeoutMs?: number;
  connectorConcurrency?: number;
  resultCapBytes?: number;
};

export type Forwarder = (
  userId: string,
  decision: AdmittedCall,
  args: Record<string, unknown>,
) => Promise<ForwardOutcome>;

export type AgentForwarder = {
  forward: Forwarder;
  outbox: OutboxService;
};

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
): string {
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
  return callId;
}

function recordFailure(
  db: Db,
  userId: string,
  decision: AdmittedCall,
  args: Record<string, unknown>,
  failure: ForwardFailure,
  durationMs: number,
): string {
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
  return callId;
}

type ReceiptContext = {
  db: Db;
  userId: string;
  decision: AdmittedCall;
  connector: ConnectorRow;
  callId: string;
  args: Record<string, unknown>;
  result: ConnectorToolResult;
  serviceDeps: ConnectorServiceDeps;
  timeoutMs: number;
  resultCapBytes: number;
};

async function receiptForChange(context: ReceiptContext): Promise<ReceiptView | undefined> {
  const slip = getSlip(context.db, context.userId, context.decision.slipId);
  if (slip === undefined) return undefined;
  const read: UpstreamRead = (tool, args) =>
    callConnectorTool(context.serviceDeps, connectorTarget(context.connector), tool, args, {
      timeoutMs: context.timeoutMs,
      resultCapBytes: context.resultCapBytes,
    });
  const verification = await verifyChange({
    connectorUrl: context.connector.url,
    connectorName: context.connector.name,
    tool: context.decision.upstreamTool,
    arguments: context.args,
    result: context.result,
    toolClass: context.decision.class,
    read,
  });

  return recordReceipt({
    db: context.db,
    userId: context.userId,
    slipId: context.decision.slipId,
    callId: context.callId,
    errandType: slip.errandType,
    toolClass: context.decision.class,
    verification: verification.verification,
    summary: verification.summary,
    ...(verification.inverse === undefined ? {} : { inverse: verification.inverse }),
  });
}

function settleIfFinished(db: Db, userId: string, decision: AdmittedCall): void {
  if (decision.callsRemaining === 0) settleSlip(db, userId, decision.slipId);
}

// The only path that touches an upstream tool. Held calls are re-admitted and
// then come here, so the outbox never forwards from its own dispatch branch.
export function createUpstreamForwarder(options: ForwarderOptions): Forwarder {
  const limiter = new ConnectorLimiter(
    options.connectorConcurrency ?? DEFAULT_CONNECTOR_CONCURRENCY,
  );
  const callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const resultCapBytes = options.resultCapBytes ?? DEFAULT_RESULT_CAP_BYTES;

  return async (userId, decision, args) => {
    const connector = getConnector(options.db, userId, decision.connectorId);
    if (connector === undefined) {
      const failure = {
        error: "upstream_error" as const,
        message: `The connector for ${decision.tool} disappeared before forwarding`,
      };
      recordFailure(options.db, userId, decision, args, failure, 0);
      return { state: "failed", ...failure, durationMs: 0 };
    }

    const serviceDeps = createConnectorServiceDeps({
      db: options.db,
      keyring: options.keyring,
      userId,
      discoverOptions: options.discoverOptions,
      redirectUri: options.redirectUri,
    });
    const started = Date.now();
    const deadline = started + callTimeoutMs;
    let result: ConnectorToolResult | undefined;
    let failure: ForwardFailure | undefined;
    try {
      result = await limiter.run(connector.id, () => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new ConnectorCallError(
            "timeout",
            `The upstream call to ${decision.tool} timed out waiting for a connector slot`,
          );
        }
        return callConnectorTool(
          serviceDeps,
          connectorTarget(connector),
          decision.upstreamTool,
          args,
          { timeoutMs: remaining, resultCapBytes },
        );
      });
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
      settleIfFinished(options.db, userId, decision);
      return { state: "failed", ...failed, durationMs };
    }

    const callId = recordSuccess(options.db, userId, decision, args, result, durationMs);
    let receipt: ReceiptView | undefined;
    if (decision.class !== "read") {
      try {
        receipt = await receiptForChange({
          db: options.db,
          userId,
          decision,
          connector,
          callId,
          args,
          result,
          serviceDeps,
          timeoutMs: callTimeoutMs,
          resultCapBytes,
        });
      } catch {
        appendJournalEvent(options.db, {
          userId,
          eventType: "receipt.failed",
          payload: {
            slip_id: decision.slipId,
            call_id: callId,
            tool: decision.tool,
          },
        });
      }
    }
    settleIfFinished(options.db, userId, decision);
    return {
      state: "forwarded",
      result,
      durationMs,
      callId,
      ...(receipt === undefined ? {} : { receipt }),
    };
  };
}

export function createForwarder(options: ForwarderOptions): AgentForwarder {
  const upstream = createUpstreamForwarder(options);
  const outbox = createOutboxService({
    db: options.db,
    forward: upstream,
    hmacKey: options.hmacKey,
  });

  return {
    outbox,
    async forward(userId, decision, args) {
      switch (decision.class) {
        case "send": {
          const item = outbox.hold(userId, decision, args);
          return {
            state: "held",
            outboxId: item.id,
            releaseAt: item.releaseAt,
            expiresAt: item.expiresAt,
          };
        }
        case "spend": {
          const item = outbox.needsHuman(userId, decision, args);
          return {
            state: "needs_human",
            outboxId: item.id,
            amountCents: item.amountCents,
            expiresAt: item.expiresAt,
          };
        }
        case "read":
        case "write":
        case "delete":
          return upstream(userId, decision, args);
      }
    },
  };
}
