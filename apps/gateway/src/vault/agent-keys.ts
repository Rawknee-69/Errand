import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { agentKeys } from "../db/schema.ts";
import { getAgentKey } from "../db/scoped-reads.ts";

export type AgentKeyRecord = typeof agentKeys.$inferSelect;
export type IssuedAgentKey = { key: string; record: AgentKeyRecord };

export type AgentKeyView = Pick<AgentKeyRecord, "id" | "name" | "createdAt" | "revokedAt">;

export function agentKeyView(record: AgentKeyRecord): AgentKeyView {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    revokedAt: record.revokedAt,
  };
}

const KEY_PREFIX = "errand_";
const KEY_BYTES = 32;
const KEY_PATTERN = new RegExp(`^${KEY_PREFIX}[A-Za-z0-9_-]{${Math.ceil((KEY_BYTES * 4) / 3)}}$`);

function hashAgentKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

// The plaintext key exists only in this return value; the database gets its hash.
export function issueAgentKey(db: Db, userId: string, name: string): IssuedAgentKey {
  const key = `${KEY_PREFIX}${randomBytes(KEY_BYTES).toString("base64url")}`;
  const record = {
    id: randomUUID(),
    userId,
    name,
    keyHash: hashAgentKey(key),
    createdAt: new Date().toISOString(),
    revokedAt: null,
  };
  db.insert(agentKeys).values(record).run();
  return { key, record };
}

// Every stored hash is compared, with no early exit, so match time does not
// track which key was presented.
export function verifyAgentKey(db: Db, presented: string): AgentKeyRecord | undefined {
  if (!KEY_PATTERN.test(presented)) return undefined;
  const digest = Buffer.from(hashAgentKey(presented), "hex");
  let matched: AgentKeyRecord | undefined;
  for (const row of db.select().from(agentKeys).where(isNull(agentKeys.revokedAt)).all()) {
    const expected = Buffer.from(row.keyHash, "hex");
    if (expected.length === digest.length && timingSafeEqual(digest, expected)) {
      matched = row;
    }
  }
  return matched;
}

export type RevokeResult = {
  record: AgentKeyRecord;
  changed: boolean;
};

export function revokeAgentKey(
  db: Db,
  userId: string,
  id: string,
  now = new Date().toISOString(),
): RevokeResult | undefined {
  const row = getAgentKey(db, userId, id);
  if (row === undefined) return undefined;
  if (row.revokedAt !== null) return { record: row, changed: false };
  db.update(agentKeys)
    .set({ revokedAt: now })
    .where(and(eq(agentKeys.userId, userId), eq(agentKeys.id, id), isNull(agentKeys.revokedAt)))
    .run();
  const record = getAgentKey(db, userId, id);
  return record === undefined ? undefined : { record, changed: true };
}
