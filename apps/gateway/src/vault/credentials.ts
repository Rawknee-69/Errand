import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { credentials } from "../db/schema.ts";
import { openCredentialDataKey, VaultError, type CredentialRow } from "./common.ts";
import { credentialAad, deriveVaultKey, generateDataKey, sealSecret, wrapDataKey } from "./envelope.ts";
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
    const now = new Date().toISOString();
    const existing = this.db
      .select()
      .from(credentials)
      .where(and(eq(credentials.userId, this.userId), eq(credentials.serviceId, input.serviceId)))
      .all()[0];
    const id = existing?.id ?? randomUUID();
    const dataKey = generateDataKey();
    const sealed = sealSecret(dataKey, input.secret, credentialAad(id, input.serviceId));
    const wrappedDataKey = wrapDataKey(this.keyring.active, dataKey);
    dataKey.fill(0);

    const sealedColumns = { ...sealed, wrappedDataKey, keyId: this.keyring.active.id, kind: input.kind };
    if (existing) {
      const connectorId = input.connectorId ?? existing.connectorId;
      const updated = { ...existing, ...sealedColumns, connectorId, updatedAt: now };
      this.db
        .update(credentials)
        .set({ ...sealedColumns, connectorId, updatedAt: now })
        .where(eq(credentials.id, id))
        .run();
      return credentialMetadata(updated);
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
    this.db.insert(credentials).values(row).run();
    return credentialMetadata(row);
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
