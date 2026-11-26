import { KEK, userDb } from "../support/fixtures.ts";
import { CredentialStore } from "../../src/vault/credentials.ts";
import { VaultKeyring } from "../../src/vault/keyring.ts";
import { Vault } from "../../src/vault/vault.ts";

export { KEK, OTHER_KEK, SEEDED_SECRET, TS, userDb } from "../support/fixtures.ts";

export type VaultFixture = {
  db: ReturnType<typeof userDb>;
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
