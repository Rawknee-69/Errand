import { describe, expect, test } from "bun:test";
import { agentKeys, users } from "../../src/db/schema.ts";
import { issueAgentKey, revokeAgentKey, verifyAgentKey } from "../../src/vault/agent-keys.ts";
import { TS, userDb } from "./support.ts";

describe("agent keys", () => {
  test("an issued key is shown once and stored only as a SHA-256 hash", () => {
    const db = userDb();

    const issued = issueAgentKey(db, "user-a", "laptop");

    expect(issued.key).toMatch(/^errand_[A-Za-z0-9_-]{43}$/);
    expect(issued.record.keyHash).toHaveLength(64);
    expect(JSON.stringify(db.select().from(agentKeys).all())).not.toContain(issued.key);
  });

  test("verification accepts the issued key and rejects a different one", () => {
    const db = userDb();
    const issued = issueAgentKey(db, "user-a", "laptop");

    expect(verifyAgentKey(db, issued.key)?.userId).toBe("user-a");

    const altered = issued.key.slice(0, -1) + (issued.key.endsWith("A") ? "B" : "A");
    expect(verifyAgentKey(db, altered)).toBeUndefined();
    expect(verifyAgentKey(db, "not-a-key")).toBeUndefined();
  });

  test("a revoked key is denied and keeps its first revocation time", () => {
    const db = userDb();
    const issued = issueAgentKey(db, "user-a", "laptop");

    const revoked = revokeAgentKey(db, "user-a", issued.record.id, "2026-02-01T00:00:00.000Z");
    const again = revokeAgentKey(db, "user-a", issued.record.id, "2026-03-01T00:00:00.000Z");

    expect(revoked?.record.revokedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(revoked?.changed).toBe(true);
    expect(again?.record.revokedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(again?.changed).toBe(false);
    expect(verifyAgentKey(db, issued.key)).toBeUndefined();
  });

  test("another user cannot revoke a key by id", () => {
    const db = userDb();
    const issued = issueAgentKey(db, "user-a", "laptop");
    db.insert(users).values({ id: "user-b", name: "B", createdAt: TS }).run();

    expect(revokeAgentKey(db, "user-b", issued.record.id)).toBeUndefined();
    expect(verifyAgentKey(db, issued.key)?.userId).toBe("user-a");
  });
});
