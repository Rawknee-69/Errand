import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { ReceiptView, ToolClass, VerificationOutcome } from "@errand/shared";
import type { Db } from "../db/client.ts";
import { recordEvent, recordEventIn } from "../db/events.ts";
import { receipts, undoActions } from "../db/schema.ts";
import { demoteTrust } from "../policy/trust.ts";
import {
  getCall,
  getConnector,
  getReceipt,
  getUndoAction,
  listUndoActions,
  listReceipts,
} from "../db/scoped-reads.ts";
import type { DiscoverOptions } from "../connectors/mcp.ts";
import type { HttpStatus } from "../errors.ts";
import { createUpstream, type Upstream } from "../connectors/upstream.ts";
import type { VaultKeyring } from "../vault/keyring.ts";
import { inverseSchema, verifyChange, type Inverse, type Verification } from "./verifier.ts";

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

  input.db.transaction((tx) => {
    tx.insert(receipts)
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
      tx.insert(undoActions)
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

    recordEventIn(tx, {
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

    if (input.verification === "mismatched") {
      demoteTrust(tx, input.userId, input.errandType, "mismatch");
    }
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

type UndoFailureCode =
  | "not_found"
  | "no_undo"
  | "already_applied"
  | "connector_missing"
  | "upstream_failed";

const UNDO_STATUS: Record<UndoFailureCode, HttpStatus> = {
  not_found: 404,
  no_undo: 409,
  already_applied: 409,
  connector_missing: 409,
  upstream_failed: 502,
};

export type UndoResult =
  | { ok: true; verification: VerificationOutcome; summary: string; receipt: ReceiptView }
  | { ok: false; code: UndoFailureCode; message: string; status: HttpStatus };

function undoFailed(code: UndoFailureCode, message: string): UndoResult {
  return { ok: false, code, message, status: UNDO_STATUS[code] };
}

async function verifyUndo(
  upstream: Upstream,
  connector: NonNullable<ReturnType<typeof getConnector>>,
  inverse: Inverse,
): Promise<Verification> {
  const result = await upstream.call(connector, inverse.tool, inverse.arguments);
  return verifyChange({
    connectorUrl: connector.url,
    connectorName: connector.name,
    tool: inverse.tool,
    arguments: inverse.arguments,
    result,
    toolClass: inverse.toolClass,
    read: upstream.reader(connector),
  });
}

export async function applyUndo(
  deps: UndoDeps,
  userId: string,
  receiptId: string,
): Promise<UndoResult> {
  const receipt = getReceipt(deps.db, userId, receiptId);
  if (receipt === undefined) {
    return undoFailed("not_found", `No receipt ${receiptId} for this owner`);
  }
  const undo = listUndoActions(deps.db, userId).find((row) => row.receiptId === receipt.id);
  if (undo === undefined) {
    return undoFailed("no_undo", "This change has no inverse and cannot be undone");
  }
  const parsed = inverseSchema.safeParse(JSON.parse(undo.inverse));
  if (!parsed.success) {
    return undoFailed("no_undo", "The stored inverse could not be read");
  }
  const call = receipt.callId === null ? undefined : getCall(deps.db, userId, receipt.callId);
  const connector = call === undefined ? undefined : getConnector(deps.db, userId, call.connectorId);
  if (connector === undefined) {
    return undoFailed("connector_missing", "The connector for this receipt is gone");
  }

  const claimed = deps.db
    .update(undoActions)
    .set({ startedAt: new Date().toISOString() })
    .where(
      and(
        eq(undoActions.userId, userId),
        eq(undoActions.id, undo.id),
        isNull(undoActions.startedAt),
        isNull(undoActions.appliedAt),
      ),
    )
    .returning({ id: undoActions.id })
    .all();
  if (claimed.length === 0) {
    return undoFailed("already_applied", "This undo has already been applied or is in progress");
  }

  const upstream = createUpstream({
    db: deps.db,
    keyring: deps.keyring,
    userId,
    discoverOptions: deps.discoverOptions,
    redirectUri: deps.redirectUri,
    ...(deps.callTimeoutMs === undefined ? {} : { timeoutMs: deps.callTimeoutMs }),
    ...(deps.resultCapBytes === undefined ? {} : { resultCapBytes: deps.resultCapBytes }),
  });

  let verification: Verification;
  try {
    verification = await verifyUndo(upstream, connector, parsed.data);
  } catch (error) {
    deps.db
      .update(undoActions)
      .set({ startedAt: null })
      .where(and(eq(undoActions.userId, userId), eq(undoActions.id, undo.id)))
      .run();
    const message = error instanceof Error ? error.message : String(error);
    recordEvent(deps.db, {
      userId,
      eventType: "undo.failed",
      payload: { receipt_id: receipt.id, slip_id: receipt.slipId, message },
    });
    return undoFailed("upstream_failed", message);
  }

  const matched = verification.verification === "matched";
  deps.db.transaction((tx) => {
    tx.update(undoActions)
      .set({
        startedAt: null,
        appliedAt: matched ? new Date().toISOString() : null,
        verification: verification.verification,
        summary: verification.summary,
      })
      .where(and(eq(undoActions.userId, userId), eq(undoActions.id, undo.id)))
      .run();

    recordEventIn(tx, {
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

    demoteTrust(tx, userId, receipt.errandType, "undo");
  });

  const updated = getReceiptView(deps.db, userId, receipt.id);
  if (updated === undefined) {
    return undoFailed("not_found", `No receipt ${receiptId} for this owner`);
  }
  return {
    ok: true,
    verification: verification.verification,
    summary: verification.summary,
    receipt: updated,
  };
}
