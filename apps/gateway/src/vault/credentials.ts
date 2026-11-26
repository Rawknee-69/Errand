import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { credentials } from "../db/schema.ts";
import { openCredentialDataKey, VaultError, type CredentialRow } from "./common.ts";
import {
  credentialAad,
  deriveVaultKey,
  generateDataKey,
  openSecret,
  sealSecret,
  wrapDataKey,
} from "./envelope.ts";
import type { VaultKeyring } from "./keyring.ts";

export type CredentialSpec = {
  serviceId: string;
  kind: string;
  secret: string;
  connectorId?: string | null;
};

export type CredentialMetadata = {
  id: string;
  userId: string;
  serviceId: string;
  kind: string;
  keyId: string;
  createdAt: string;
  updatedAt: string;
};

export type RotationResult = {
  fromKeyId: string;
  toKeyId: string;
  rewrapped: number;
};

export function credentialMetadata(row: CredentialRow): CredentialMetadata {
  return {
    id: row.id,
    userId: row.userId,
    serviceId: row.serviceId,
    kind: row.kind,
    keyId: row.keyId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class CredentialStore {
  constructor(
    private readonly db: Db,
    private readonly keyring: VaultKeyring,
    private readonly userId: string,
  ) {}

  store(input: CredentialSpec): CredentialMetadata {
    return this.mutateSecret({
      serviceId: input.serviceId,
      kind: input.kind,
      ...(input.connectorId === undefined ? {} : { connectorId: input.connectorId }),
      transform: () => input.secret,
    });
  }

  // Read-modify-write inside one transaction, so concurrent rotations of the
  // same secret (a rotated refresh token) cannot interleave.
  mutateSecret(input: {
    serviceId: string;
    kind: string;
    connectorId?: string | null;
    transform: (current: string | undefined) => string;
  }): CredentialMetadata {
    return this.db.transaction((tx) => {
      const now = new Date().toISOString();
      const existing = tx
        .select()
        .from(credentials)
        .where(and(eq(credentials.userId, this.userId), eq(credentials.serviceId, input.serviceId)))
        .all()[0];
      const current = existing === undefined ? undefined : this.open(existing);
      const secret = input.transform(current);
      const id = existing?.id ?? randomUUID();
      const dataKey = generateDataKey();
      const sealed = sealSecret(dataKey, secret, credentialAad(id, input.serviceId));
      const wrappedDataKey = wrapDataKey(this.keyring.active, dataKey);
      dataKey.fill(0);
      const sealedColumns = { ...sealed, wrappedDataKey, keyId: this.keyring.active.id, kind: input.kind };

      if (existing) {
        const connectorId = input.connectorId ?? existing.connectorId;
        tx.update(credentials)
          .set({ ...sealedColumns, connectorId, updatedAt: now })
          .where(eq(credentials.id, id))
          .run();
        return credentialMetadata({ ...existing, ...sealedColumns, connectorId, updatedAt: now });
      }

      const row = {
        id,
        userId: this.userId,
        connectorId: input.connectorId ?? null,
        serviceId: input.serviceId,
        createdAt: now,
        updatedAt: now,
        ...sealedColumns,
      };
      tx.insert(credentials).values(row).run();
      return credentialMetadata(row);
    });
  }

  remove(serviceId: string): void {
    this.db
      .delete(credentials)
      .where(and(eq(credentials.userId, this.userId), eq(credentials.serviceId, serviceId)))
      .run();
  }

  private open(row: CredentialRow): string {
    const kek = this.keyring.find(row.keyId);
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

  rotate(nextKeyMaterial: string): RotationResult {
    const next = deriveVaultKey(nextKeyMaterial);
    const fromKeyId = this.keyring.active.id;
    if (next.id === fromKeyId) {
      return { fromKeyId, toKeyId: next.id, rewrapped: 0 };
    }

    const rows = this.db.select().from(credentials).all();
    this.db.transaction((tx) => {
      for (const row of rows) {
        const from = this.keyring.find(row.keyId);
        if (!from) {
          throw new VaultError("key_unavailable", `no key material for key id ${row.keyId}`);
        }
        const dataKey = openCredentialDataKey(from, row);
        try {
          tx.update(credentials)
            .set({ wrappedDataKey: wrapDataKey(next, dataKey), keyId: next.id, updatedAt: new Date().toISOString() })
            .where(eq(credentials.id, row.id))
            .run();
        } finally {
          dataKey.fill(0);
        }
      }
    });

    this.keyring.activate(next);
    return { fromKeyId, toKeyId: next.id, rewrapped: rows.length };
  }
}
