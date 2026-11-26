import { openCredentialDataKey, VaultError, type CredentialRow } from "./common.ts";
import { credentialAad, openSecret } from "./envelope.ts";
import type { VaultKeyring } from "./keyring.ts";

// The one place a stored secret becomes plaintext. The data key is wiped even
// when authentication fails.
export function decryptCredential(keyring: VaultKeyring, row: CredentialRow): string {
  const kek = keyring.find(row.keyId);
  if (kek === undefined) {
    throw new VaultError("key_unavailable", `no key material for key id ${row.keyId}`);
  }
  const dataKey = openCredentialDataKey(kek, row);
  try {
    return openSecret(dataKey, row, credentialAad(row.id, row.serviceId));
  } catch {
    throw new VaultError("decrypt_failed", `credential ${row.id} failed authentication`);
  } finally {
    dataKey.fill(0);
  }
}
