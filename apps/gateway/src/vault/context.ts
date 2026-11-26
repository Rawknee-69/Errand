import type { GatewayConfig } from "../config.ts";
import type { Db } from "../db/client.ts";
import { CredentialStore } from "./credentials.ts";
import { VaultKeyring } from "./keyring.ts";
import { Vault } from "./vault.ts";

export type VaultContext = {
  vault: Vault;
  credentials: CredentialStore;
};

// Keys come from the environment, never from the database or a backup.
export function openVaultForUser(
  db: Db,
  config: Pick<GatewayConfig, "VAULT_KEY" | "VAULT_KEY_PREVIOUS">,
  userId: string,
): VaultContext {
  const previous = config.VAULT_KEY_PREVIOUS?.split(",")
    .map((material) => material.trim())
    .filter((material) => material.length > 0) ?? [];
  const keyring = new VaultKeyring(config.VAULT_KEY, previous);
  return { vault: new Vault(db, keyring, userId), credentials: new CredentialStore(db, keyring, userId) };
}
