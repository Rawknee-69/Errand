import { and, eq } from "drizzle-orm";
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

// Every per-user read is scoped by user id at the query layer: a caller can
// only ever read rows belonging to the user it names. `users` itself is keyed
// by its own id and is not per-user data.

export type User = typeof users.$inferSelect;
export type AgentKey = typeof agentKeys.$inferSelect;
export type Connector = typeof connectors.$inferSelect;
export type Credential = typeof credentials.$inferSelect;
export type OauthAttempt = typeof oauthAttempts.$inferSelect;
export type Tool = typeof tools.$inferSelect;
export type Slip = typeof slips.$inferSelect;
export type Call = typeof calls.$inferSelect;
export type Receipt = typeof receipts.$inferSelect;
export type UndoAction = typeof undoActions.$inferSelect;
export type Trust = typeof trust.$inferSelect;

export function getUser(db: Db, id: string): User | undefined {
  return db.select().from(users).where(eq(users.id, id)).all()[0];
}

export function listAgentKeys(db: Db, userId: string): AgentKey[] {
  return db.select().from(agentKeys).where(eq(agentKeys.userId, userId)).all();
}

export function getAgentKey(db: Db, userId: string, id: string): AgentKey | undefined {
  return db.select().from(agentKeys).where(and(eq(agentKeys.userId, userId), eq(agentKeys.id, id))).all()[0];
}

export function listConnectors(db: Db, userId: string): Connector[] {
  return db.select().from(connectors).where(eq(connectors.userId, userId)).all();
}

export function getConnector(db: Db, userId: string, id: string): Connector | undefined {
  return db.select().from(connectors).where(and(eq(connectors.userId, userId), eq(connectors.id, id))).all()[0];
}

export function listCredentials(db: Db, userId: string): Credential[] {
  return db.select().from(credentials).where(eq(credentials.userId, userId)).all();
}

export function getCredential(db: Db, userId: string, id: string): Credential | undefined {
  return db.select().from(credentials).where(and(eq(credentials.userId, userId), eq(credentials.id, id))).all()[0];
}

export function listOauthAttempts(db: Db, userId: string): OauthAttempt[] {
  return db.select().from(oauthAttempts).where(eq(oauthAttempts.userId, userId)).all();
}

export function getOauthAttempt(db: Db, userId: string, id: string): OauthAttempt | undefined {
  return db.select().from(oauthAttempts).where(and(eq(oauthAttempts.userId, userId), eq(oauthAttempts.id, id))).all()[0];
}

export function listTools(db: Db, userId: string): Tool[] {
  return db.select().from(tools).where(eq(tools.userId, userId)).all();
}

export function getTool(db: Db, userId: string, id: string): Tool | undefined {
  return db.select().from(tools).where(and(eq(tools.userId, userId), eq(tools.id, id))).all()[0];
}

export function listSlips(db: Db, userId: string): Slip[] {
  return db.select().from(slips).where(eq(slips.userId, userId)).all();
}

export function getSlip(db: Db, userId: string, id: string): Slip | undefined {
  return db.select().from(slips).where(and(eq(slips.userId, userId), eq(slips.id, id))).all()[0];
}

export function listCalls(db: Db, userId: string): Call[] {
  return db.select().from(calls).where(eq(calls.userId, userId)).all();
}

export function getCall(db: Db, userId: string, id: string): Call | undefined {
  return db.select().from(calls).where(and(eq(calls.userId, userId), eq(calls.id, id))).all()[0];
}

export function listReceipts(db: Db, userId: string): Receipt[] {
  return db.select().from(receipts).where(eq(receipts.userId, userId)).all();
}

export function getReceipt(db: Db, userId: string, id: string): Receipt | undefined {
  return db.select().from(receipts).where(and(eq(receipts.userId, userId), eq(receipts.id, id))).all()[0];
}

export function listUndoActions(db: Db, userId: string): UndoAction[] {
  return db.select().from(undoActions).where(eq(undoActions.userId, userId)).all();
}

export function getUndoAction(db: Db, userId: string, id: string): UndoAction | undefined {
  return db.select().from(undoActions).where(and(eq(undoActions.userId, userId), eq(undoActions.id, id))).all()[0];
}

export function listTrust(db: Db, userId: string): Trust[] {
  return db.select().from(trust).where(eq(trust.userId, userId)).all();
}

export function getTrust(db: Db, userId: string, errandType: string): Trust | undefined {
  return db.select().from(trust).where(and(eq(trust.userId, userId), eq(trust.errandType, errandType))).all()[0];
}
