import { createMigratedDatabase, type Db } from "../../src/db/client.ts";
import { users } from "../../src/db/schema.ts";
import { CredentialStore } from "../../src/vault/credentials.ts";
import { VaultKeyring } from "../../src/vault/keyring.ts";
import { Vault } from "../../src/vault/vault.ts";

export const KEK = "vault-key-material-that-is-long-enough-for-aes";
export const OTHER_KEK = "a-different-vault-key-material-also-long-enough";
export const SEEDED_SECRET = "sk-live-notion-9f3c2a7d4b1e";
export const TS = "2026-01-01T00:00:00.000Z";

export function userDb(userId = "user-a"): Db {
  const db = createMigratedDatabase(":memory:");
  db.insert(users).values({ id: userId, name: userId, createdAt: TS }).run();
  return db;
}

export type VaultFixture = {
  db: Db;
  keyring: VaultKeyring;
  vault: Vault;
  store: CredentialStore;
};

export function vaultFixture(options: { keyMaterial?: string; previous?: string[]; userId?: string } = {}): VaultFixture {
  const { keyMaterial = KEK, previous = [], userId = "user-a" } = options;
  const db = userDb(userId);
  const keyring = new VaultKeyring(keyMaterial, previous);
  return {
    db,
    keyring,
    vault: new Vault(db, keyring, userId),
    store: new CredentialStore(db, keyring, userId),
  };
}
