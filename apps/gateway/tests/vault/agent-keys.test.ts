import { describe, expect, test } from "bun:test";
import { agentKeys } from "../../src/db/schema.ts";
import { issueAgentKey, verifyAgentKey } from "../../src/vault/agent-keys.ts";
import { userDb } from "./support.ts";

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
});
