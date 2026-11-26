import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { credentials } from "../db/schema.ts";
import { VaultError } from "./common.ts";
import type { VaultKeyring } from "./keyring.ts";
import { decryptCredential } from "./open.ts";

function carriesSecret(value: unknown, secret: string, depth = 0): boolean {
  if (typeof value === "string") return value.includes(secret);
  if (depth >= 3 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => carriesSecret(item, secret, depth + 1));
  return Object.values(value).some((item) => carriesSecret(item, secret, depth + 1));
}

// The only module that decrypts. withCredential is its only read: the secret
// lives for the callback's duration and cannot leave through its return value.
export class Vault {
  constructor(
    private readonly db: Db,
    private readonly keyring: VaultKeyring,
    private readonly userId: string,
  ) {}

  async withCredential<T>(serviceId: string, fn: (secret: string) => T | Promise<T>): Promise<T> {
    const row = this.db
      .select()
      .from(credentials)
      .where(and(eq(credentials.userId, this.userId), eq(credentials.serviceId, serviceId)))
      .orderBy(desc(credentials.updatedAt))
      .limit(1)
      .all()[0];
    if (!row) {
      throw new VaultError("credential_not_found", `no credential for service ${serviceId}`);
    }
    const secret = decryptCredential(this.keyring, row);

    const result = await fn(secret);
    if (carriesSecret(result, secret)) {
      throw new VaultError("secret_escaped", "credential callback returned the decrypted secret");
    }
    return result;
  }
}
