import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { ReceiptView, ToolClass, VerificationOutcome } from "@errand/shared";
import type { Db } from "../db/client.ts";
import { appendJournalEvent } from "../db/journal.ts";
import { receipts, undoActions } from "../db/schema.ts";
import {
  getCall,
  getConnector,
  getReceipt,
  getUndoAction,
  listUndoActions,
  listReceipts,
} from "../db/scoped-reads.ts";
import {
  callConnectorTool,
  connectorTarget,
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_RESULT_CAP_BYTES,
} from "../connectors/call.ts";
import { createConnectorServiceDeps } from "../connectors/service.ts";
import type { DiscoverOptions } from "../connectors/mcp.ts";
import type { VaultKeyring } from "../vault/keyring.ts";
import {
  inverseSchema,
  verifyChange,
  type Inverse,
  type UpstreamRead,
  type Verification,
} from "./verifier.ts";

type ReceiptRow = typeof receipts.$inferSelect;
type UndoRow = typeof undoActions.$inferSelect;

export type RecordReceiptInput = {
  db: Db;
  userId: string;
  slipId: string;
  callId: string;
  errandType: string;
  toolClass: ToolClass;
  verification: VerificationOutcome;
  summary: string;
  inverse?: Inverse;
};

function isIrreversible(toolClass: ToolClass, inverse: Inverse | undefined): boolean {
  if (inverse !== undefined) return false;
  return toolClass === "send" || toolClass === "spend" || toolClass === "delete";
}

function withUndoNote(
  summary: string,
  irreversible: boolean,
  inverse: Inverse | undefined,
): string {
  if (irreversible) return `${summary} This cannot be undone.`;
  if (inverse === undefined) return `${summary} No undo is available for this change.`;
  return summary;
}

function receiptView(row: ReceiptRow, undo: UndoRow | undefined): ReceiptView {
  return {
    id: row.id,
    slipId: row.slipId,
    callId: row.callId,
    errandType: row.errandType,
    verification: row.verification,
    summary: row.summary,
    toolClass: row.toolClass,
    irreversible: row.irreversible,
    undo:
      undo === undefined
        ? null
        : {
            id: undo.id,
            appliedAt: undo.appliedAt,
            verification: undo.verification,
            summary: undo.summary,
          },
    createdAt: row.createdAt,
  };
}

function undoByReceipt(rows: UndoRow[]): Map<string, UndoRow> {
  return new Map(
    rows
      .filter((row): row is UndoRow & { receiptId: string } => row.receiptId !== null)
      .map((row) => [row.receiptId, row]),
  );
}

export function recordReceipt(input: RecordReceiptInput): ReceiptView {
  const id = randomUUID();
  const undoId = randomUUID();
  const createdAt = new Date().toISOString();
  const irreversible = isIrreversible(input.toolClass, input.inverse);
  const summary = withUndoNote(input.summary, irreversible, input.inverse);

  input.db
    .insert(receipts)
    .values({
      id,
      userId: input.userId,
      slipId: input.slipId,
      callId: input.callId,
      errandType: input.errandType,
      verification: input.verification,
      toolClass: input.toolClass,
      irreversible,
      summary,
      createdAt,
    })
    .run();

  if (input.inverse !== undefined) {
    input.db
      .insert(undoActions)
      .values({
        id: undoId,
        userId: input.userId,
        receiptId: id,
        callId: input.callId,
        inverse: JSON.stringify(input.inverse),
        createdAt,
      })
      .run();
  }

  appendJournalEvent(input.db, {
    userId: input.userId,
    eventType: "receipt.created",
    payload: {
      receipt_id: id,
      slip_id: input.slipId,
      call_id: input.callId,
      tool_class: input.toolClass,
      verification: input.verification,
      irreversible,
      undo_available: input.inverse !== undefined,
      summary,
    },
  });

  const saved = getReceipt(input.db, input.userId, id);
  if (saved === undefined) throw new Error(`Receipt ${id} was not stored`);
  return receiptView(
    saved,
    input.inverse === undefined ? undefined : getUndoAction(input.db, input.userId, undoId),
  );
}

export function listReceiptViews(db: Db, userId: string): ReceiptView[] {
  const undo = undoByReceipt(listUndoActions(db, userId));
  return listReceipts(db, userId)
    .map((row) => receiptView(row, undo.get(row.id)))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function getReceiptView(db: Db, userId: string, id: string): ReceiptView | undefined {
  const row = getReceipt(db, userId, id);
  if (row === undefined) return undefined;
  const undo = listUndoActions(db, userId).find((entry) => entry.receiptId === row.id);
  return receiptView(row, undo);
}

export type UndoDeps = {
  db: Db;
  keyring: VaultKeyring;
  discoverOptions: DiscoverOptions;
  redirectUri: string;
  callTimeoutMs?: number;
  resultCapBytes?: number;
};

export type UndoResult =
  | { ok: true; verification: VerificationOutcome; summary: string; receipt: ReceiptView }
  | {
      ok: false;
      code:
        | "not_found"
        | "no_undo"
        | "already_applied"
        | "connector_missing"
        | "upstream_failed";
      message: string;
    };

async function verifyUndo(
  deps: UndoDeps,
  userId: string,
  connector: NonNullable<ReturnType<typeof getConnector>>,
  inverse: Inverse,
  read: UpstreamRead,
): Promise<Verification> {
  const serviceDeps = createConnectorServiceDeps({
    db: deps.db,
    keyring: deps.keyring,
    userId,
    discoverOptions: deps.discoverOptions,
    redirectUri: deps.redirectUri,
  });
  const options = {
    timeoutMs: deps.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
    resultCapBytes: deps.resultCapBytes ?? DEFAULT_RESULT_CAP_BYTES,
  };
  const result = await callConnectorTool(
    serviceDeps,
    connectorTarget(connector),
    inverse.tool,
    inverse.arguments,
    options,
  );
  return verifyChange({
    connectorUrl: connector.url,
    connectorName: connector.name,
    tool: inverse.tool,
    arguments: inverse.arguments,
    result,
    toolClass: inverse.toolClass,
    read,
  });
}

export async function applyUndo(
  deps: UndoDeps,
  userId: string,
  receiptId: string,
): Promise<UndoResult> {
  const receipt = getReceipt(deps.db, userId, receiptId);
  if (receipt === undefined) {
    return { ok: false, code: "not_found", message: `No receipt ${receiptId} for this owner` };
  }
  const undo = listUndoActions(deps.db, userId).find((row) => row.receiptId === receipt.id);
  if (undo === undefined) {
    return { ok: false, code: "no_undo", message: "This change has no inverse and cannot be undone" };
  }
  const parsed = inverseSchema.safeParse(JSON.parse(undo.inverse));
  if (!parsed.success) {
    return { ok: false, code: "no_undo", message: "The stored inverse could not be read" };
  }
  const call = receipt.callId === null ? undefined : getCall(deps.db, userId, receipt.callId);
  const connector = call === undefined ? undefined : getConnector(deps.db, userId, call.connectorId);
  if (connector === undefined) {
    return { ok: false, code: "connector_missing", message: "The connector for this receipt is gone" };
  }

  const claimedAt = new Date().toISOString();
  const claimed = deps.db.$client
    .prepare(
      `UPDATE undo_actions SET started_at = ?
       WHERE user_id = ? AND id = ? AND started_at IS NULL AND applied_at IS NULL`,
    )
    .run(claimedAt, userId, undo.id);
  if (claimed.changes === 0) {
    return {
      ok: false,
      code: "already_applied",
      message: "This undo has already been applied or is in progress",
    };
  }

  const serviceDeps = createConnectorServiceDeps({
    db: deps.db,
    keyring: deps.keyring,
    userId,
    discoverOptions: deps.discoverOptions,
    redirectUri: deps.redirectUri,
  });
  const options = {
    timeoutMs: deps.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
    resultCapBytes: deps.resultCapBytes ?? DEFAULT_RESULT_CAP_BYTES,
  };
  const read: UpstreamRead = (tool, args) =>
    callConnectorTool(serviceDeps, connectorTarget(connector), tool, args, options);

  let verification: Verification;
  try {
    verification = await verifyUndo(deps, userId, connector, parsed.data, read);
  } catch (error) {
    deps.db
      .update(undoActions)
      .set({ startedAt: null })
      .where(and(eq(undoActions.userId, userId), eq(undoActions.id, undo.id)))
      .run();
    const message = error instanceof Error ? error.message : String(error);
    appendJournalEvent(deps.db, {
      userId,
      eventType: "undo.failed",
      payload: { receipt_id: receipt.id, slip_id: receipt.slipId, message },
    });
    return { ok: false, code: "upstream_failed", message };
  }

  const matched = verification.verification === "matched";
  deps.db
    .update(undoActions)
    .set({
      startedAt: null,
      appliedAt: matched ? new Date().toISOString() : null,
      verification: verification.verification,
      summary: verification.summary,
    })
    .where(and(eq(undoActions.userId, userId), eq(undoActions.id, undo.id)))
    .run();

  appendJournalEvent(deps.db, {
    userId,
    eventType: matched ? "undo.applied" : "undo.mismatched",
    payload: {
      receipt_id: receipt.id,
      slip_id: receipt.slipId,
      tool: parsed.data.tool,
      verification: verification.verification,
      summary: verification.summary,
    },
  });

  const updated = getReceiptView(deps.db, userId, receipt.id);
  if (updated === undefined) {
    return { ok: false, code: "not_found", message: `No receipt ${receiptId} for this owner` };
  }
  return {
    ok: true,
    verification: verification.verification,
    summary: verification.summary,
    receipt: updated,
  };
}
