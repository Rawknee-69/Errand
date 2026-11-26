import type { credentials } from "../db/schema.ts";
import { unwrapDataKey, type VaultKey } from "./envelope.ts";

export type CredentialRow = typeof credentials.$inferSelect;

export type VaultErrorCode = "credential_not_found" | "key_unavailable" | "decrypt_failed" | "secret_escaped";

export class VaultError extends Error {
  constructor(
    readonly code: VaultErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VaultError";
  }
}

export function openCredentialDataKey(kek: VaultKey, row: CredentialRow): Buffer {
  try {
    return unwrapDataKey(kek, row.wrappedDataKey);
  } catch {
    throw new VaultError("decrypt_failed", `credential ${row.id} failed authentication`);
  }
}
