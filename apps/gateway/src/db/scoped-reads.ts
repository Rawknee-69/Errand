import { and, eq } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "./client.ts";
import {
  agentKeys,
  calls,
  connectors,
  credentials,
  oauthAttempts,
  receipts,
  slips,
  tools,
  trust,
  undoActions,
  users,
} from "./schema.ts";

// One home for per-user scoping: every read filters `user_id = ?` at the query layer.
// `users` itself is keyed by its own id and is not per-user data.

export function scopedList<TTable extends SQLiteTable>(
  db: Db,
  table: TTable,
  userColumn: SQLiteColumn,
  userId: string,
  orderByColumn?: SQLiteColumn,
) {
  const query = db.select().from(table).where(eq(userColumn, userId));
  return (orderByColumn ? query.orderBy(orderByColumn) : query).all();
}

export function scopedGet<TTable extends SQLiteTable>(
  db: Db,
  table: TTable,
  userColumn: SQLiteColumn,
  userId: string,
  idColumn: SQLiteColumn,
  id: string | number,
) {
  return db
    .select()
    .from(table)
    .where(and(eq(userColumn, userId), eq(idColumn, id)))
    .all()[0];
}

export function getUser(db: Db, id: string) {
  return db.select().from(users).where(eq(users.id, id)).all()[0];
}

export function listAgentKeys(db: Db, userId: string) {
  return scopedList(db, agentKeys, agentKeys.userId, userId);
}
export function getAgentKey(db: Db, userId: string, id: string) {
  return scopedGet(db, agentKeys, agentKeys.userId, userId, agentKeys.id, id);
}

export function listConnectors(db: Db, userId: string) {
  return scopedList(db, connectors, connectors.userId, userId);
}
export function getConnector(db: Db, userId: string, id: string) {
  return scopedGet(db, connectors, connectors.userId, userId, connectors.id, id);
}

export function listCredentials(db: Db, userId: string) {
  return scopedList(db, credentials, credentials.userId, userId);
}
export function getCredential(db: Db, userId: string, id: string) {
  return scopedGet(db, credentials, credentials.userId, userId, credentials.id, id);
}

export function listOauthAttempts(db: Db, userId: string) {
  return scopedList(db, oauthAttempts, oauthAttempts.userId, userId);
}
export function getOauthAttempt(db: Db, userId: string, id: string) {
  return scopedGet(db, oauthAttempts, oauthAttempts.userId, userId, oauthAttempts.id, id);
}

export function listTools(db: Db, userId: string) {
  return scopedList(db, tools, tools.userId, userId);
}
export function getTool(db: Db, userId: string, id: string) {
  return scopedGet(db, tools, tools.userId, userId, tools.id, id);
}

export function listSlips(db: Db, userId: string) {
  return scopedList(db, slips, slips.userId, userId);
}
export function getSlip(db: Db, userId: string, id: string) {
  return scopedGet(db, slips, slips.userId, userId, slips.id, id);
}

export function listCalls(db: Db, userId: string) {
  return scopedList(db, calls, calls.userId, userId);
}
export function getCall(db: Db, userId: string, id: string) {
  return scopedGet(db, calls, calls.userId, userId, calls.id, id);
}

export function listReceipts(db: Db, userId: string) {
  return scopedList(db, receipts, receipts.userId, userId);
}
export function getReceipt(db: Db, userId: string, id: string) {
  return scopedGet(db, receipts, receipts.userId, userId, receipts.id, id);
}

export function listUndoActions(db: Db, userId: string) {
  return scopedList(db, undoActions, undoActions.userId, userId);
}
export function getUndoAction(db: Db, userId: string, id: string) {
  return scopedGet(db, undoActions, undoActions.userId, userId, undoActions.id, id);
}

export function listTrust(db: Db, userId: string) {
  return scopedList(db, trust, trust.userId, userId);
}
export function getTrust(db: Db, userId: string, errandType: string) {
  return scopedGet(db, trust, trust.userId, userId, trust.errandType, errandType);
}
