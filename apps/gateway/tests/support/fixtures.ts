import { createMigratedDatabase, type Db } from "../../src/db/client.ts";
import { users } from "../../src/db/schema.ts";

export const TS = "2026-01-01T00:00:00.000Z";
export const KEK = "vault-key-material-that-is-long-enough-for-aes";
export const OTHER_KEK = "a-different-vault-key-material-also-long-enough";
export const SEEDED_SECRET = "sk-live-notion-9f3c2a7d4b1e";
export const SLIP_KEY = "slip-hmac-key-material-long-enough-for-tests";

export function userDb(userIds: string | string[] = "user-a"): Db {
  const db = createMigratedDatabase(":memory:");
  for (const id of Array.isArray(userIds) ? userIds : [userIds]) {
    db.insert(users).values({ id, name: id, createdAt: TS }).run();
  }
  return db;
}
