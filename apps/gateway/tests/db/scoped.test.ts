import { describe, expect, test } from "bun:test";
import { createMigratedDatabase, type Db } from "../../src/db/client.ts";
import { appendJournalEvent, listJournalEvents } from "../../src/db/journal.ts";
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
} from "../../src/db/schema.ts";
import {
  getUser,
  getAgentKey,
  getCall,
  getConnector,
  getCredential,
  getOauthAttempt,
  getReceipt,
  getSlip,
  getTool,
  getTrust,
  getUndoAction,
  listAgentKeys,
  listCalls,
  listConnectors,
  listCredentials,
  listOauthAttempts,
  listReceipts,
  listSlips,
  listTools,
  listTrust,
  listUndoActions,
} from "../../src/db/scoped-reads.ts";

const TS = "2026-01-01T00:00:00.000Z";

// Seed one full set of rows for a user; ids are namespaced per user.
function seedUser(db: Db, userId: string): void {
  const p = `${userId}-`;
  db.insert(users).values({ id: userId, name: userId, createdAt: TS }).run();
  db.insert(agentKeys)
    .values({ id: p + "key", userId, name: "k", keyHash: p + "hash", createdAt: TS })
    .run();
  db.insert(connectors)
    .values({ id: p + "conn", userId, name: "c", url: "https://example.com", transport: "streamable-http", authType: "none", createdAt: TS, updatedAt: TS })
    .run();
  db.insert(credentials)
    .values({ id: p + "cred", userId, connectorId: p + "conn", serviceId: p + "conn", kind: "api_key", ciphertext: "x", nonce: "n", authTag: "t", wrappedDataKey: "w", keyId: "k", createdAt: TS, updatedAt: TS })
    .run();
  db.insert(oauthAttempts)
    .values({ id: p + "oauth", userId, connectorId: p + "conn", state: p + "state", codeVerifier: "v", redirectUri: "https://example.com/cb", createdAt: TS, expiresAt: TS })
    .run();
  db.insert(tools)
    .values({ id: p + "tool", userId, connectorId: p + "conn", name: "t", definitionHash: "h", createdAt: TS, updatedAt: TS })
    .run();
  db.insert(slips)
    .values({ id: p + "slip", userId, errandType: "e", state: "approved", tier: "learner", expiresAt: TS, createdAt: TS, updatedAt: TS })
    .run();
  db.insert(calls)
    .values({ id: p + "call", userId, slipId: p + "slip", connectorId: p + "conn", tool: "t", createdAt: TS })
    .run();
  db.insert(receipts)
    .values({ id: p + "receipt", userId, slipId: p + "slip", callId: p + "call", errandType: "e", verification: "unverified", createdAt: TS })
    .run();
  db.insert(undoActions)
    .values({ id: p + "undo", userId, receiptId: p + "receipt", callId: p + "call", inverse: "{}", createdAt: TS })
    .run();
  db.insert(trust)
    .values({ userId, errandType: "e", tier: "learner", createdAt: TS, updatedAt: TS })
    .run();
  appendJournalEvent(db, { userId, eventType: "seed", payload: { userId } });
}

describe("per-user reads are scoped by user id at the query layer", () => {
  test("a user's reads never return another user's rows", () => {
    const db = createMigratedDatabase(":memory:");
    seedUser(db, "user-a");
    seedUser(db, "user-b");

    // every list read returns only rows owned by the named user
    expect(listAgentKeys(db, "user-a").map((r) => r.id)).toEqual(["user-a-key"]);
    expect(listConnectors(db, "user-a").map((r) => r.id)).toEqual(["user-a-conn"]);
    expect(listCredentials(db, "user-a").map((r) => r.id)).toEqual(["user-a-cred"]);
    expect(listOauthAttempts(db, "user-a").map((r) => r.id)).toEqual(["user-a-oauth"]);
    expect(listTools(db, "user-a").map((r) => r.id)).toEqual(["user-a-tool"]);
    expect(listSlips(db, "user-a").map((r) => r.id)).toEqual(["user-a-slip"]);
    expect(listCalls(db, "user-a").map((r) => r.id)).toEqual(["user-a-call"]);
    expect(listReceipts(db, "user-a").map((r) => r.id)).toEqual(["user-a-receipt"]);
    expect(listUndoActions(db, "user-a").map((r) => r.id)).toEqual(["user-a-undo"]);
    expect(listTrust(db, "user-a").map((r) => r.userId)).toEqual(["user-a"]);
    expect(listJournalEvents(db, "user-a").every((r) => r.userId === "user-a")).toBe(true);

    // every by-id read requires the row to belong to the named user
    expect(getAgentKey(db, "user-a", "user-b-key")).toBeUndefined();
    expect(getConnector(db, "user-a", "user-b-conn")).toBeUndefined();
    expect(getCredential(db, "user-a", "user-b-cred")).toBeUndefined();
    expect(getOauthAttempt(db, "user-a", "user-b-oauth")).toBeUndefined();
    expect(getTool(db, "user-a", "user-b-tool")).toBeUndefined();
    expect(getSlip(db, "user-a", "user-b-slip")).toBeUndefined();
    expect(getCall(db, "user-a", "user-b-call")).toBeUndefined();
    expect(getReceipt(db, "user-a", "user-b-receipt")).toBeUndefined();
    expect(getUndoAction(db, "user-a", "user-b-undo")).toBeUndefined();
    expect(getTrust(db, "user-a", "e")?.userId).toBe("user-a");

    // symmetrically for user-b
    expect(listAgentKeys(db, "user-b").map((r) => r.id)).toEqual(["user-b-key"]);
    expect(getSlip(db, "user-b", "user-a-slip")).toBeUndefined();

    // own profile
    expect(getUser(db, "user-a")?.name).toBe("user-a");
  });
});
