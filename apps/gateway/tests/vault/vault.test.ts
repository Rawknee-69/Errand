import { describe, expect, test } from "bun:test";
import { credentials, users } from "../../src/db/schema.ts";
import { CredentialStore } from "../../src/vault/credentials.ts";
import { openVaultForUser } from "../../src/vault/context.ts";
import { deriveVaultKey } from "../../src/vault/envelope.ts";
import { VaultKeyring } from "../../src/vault/keyring.ts";
import { Vault } from "../../src/vault/vault.ts";
import { KEK, OTHER_KEK, SEEDED_SECRET, userDb, vaultFixture } from "./support.ts";

function store(fixture: ReturnType<typeof vaultFixture>, serviceId = "notion"): void {
  fixture.store.store({
    serviceId,
    kind: "api_key",
    secret: `${SEEDED_SECRET}-${serviceId}`,
  });
}

describe("vault envelope encryption", () => {
  test("a stored credential round-trips and is usable inside the callback", async () => {
    const fixture = vaultFixture();
    store(fixture);

    const result = await fixture.vault.withCredential("notion", (secret) => {
      expect(secret).toBe(`${SEEDED_SECRET}-notion`);
      return "forwarded";
    });

    expect(result).toBe("forwarded");
  });

  test("the database row holds ciphertext, never the secret", () => {
    const fixture = vaultFixture();
    store(fixture);

    const row = fixture.db.select().from(credentials).all()[0]!;
    const stored = JSON.stringify(row);

    expect(stored).not.toContain(SEEDED_SECRET);
    expect(row.ciphertext).not.toBe(`${SEEDED_SECRET}-notion`);
    expect(row.wrappedDataKey.length).toBeGreaterThan(0);
  });

  test("decryption fails when the stored key id points at a different key", async () => {
    const fixture = vaultFixture({ previous: [OTHER_KEK] });
    store(fixture);

    fixture.db.$client.query("UPDATE credentials SET key_id = ?").run(deriveVaultKey(OTHER_KEK).id);

    await expect(fixture.vault.withCredential("notion", () => "reachable")).rejects.toMatchObject({
      code: "decrypt_failed",
    });
  });

  test("decryption fails when the additional authenticated data is altered", async () => {
    const fixture = vaultFixture();
    store(fixture);

    fixture.db.$client.query("UPDATE credentials SET id = ?").run("not-the-credential-id");

    await expect(fixture.vault.withCredential("notion", () => "reachable")).rejects.toMatchObject({
      code: "decrypt_failed",
    });
  });

  test("an unknown service is reported without any secret material", async () => {
    const fixture = vaultFixture();

    await expect(fixture.vault.withCredential("missing", () => "reachable")).rejects.toMatchObject({
      code: "credential_not_found",
    });
  });

  test("a callback cannot return, wrap or serialise the decrypted secret", async () => {
    const fixture = vaultFixture();
    store(fixture);

    await expect(fixture.vault.withCredential("notion", (secret) => secret)).rejects.toMatchObject({
      code: "secret_escaped",
    });
    await expect(
      fixture.vault.withCredential("notion", (secret) => ({ headers: { authorization: `Bearer ${secret}` } })),
    ).rejects.toMatchObject({ code: "secret_escaped" });
  });

  test("storing the same service again replaces the secret used at call time", async () => {
    const fixture = vaultFixture();
    store(fixture);

    fixture.store.store({ serviceId: "notion", kind: "api_key", secret: "rotated-value" });

    const matched = await fixture.vault.withCredential("notion", (secret) => secret === "rotated-value");
    expect(matched).toBe(true);
  });

  test("one user's vault cannot read another user's credential for the same service", async () => {
    const fixture = vaultFixture();
    store(fixture);
    fixture.db.insert(users).values({ id: "user-b", name: "B", createdAt: "2026-01-01T00:00:00.000Z" }).run();
    const otherStore = new CredentialStore(fixture.db, fixture.keyring, "user-b");
    otherStore.store({ serviceId: "notion", kind: "api_key", secret: "user-b-notion" });
    const otherVault = new Vault(fixture.db, fixture.keyring, "user-b");

    const seenByB = await otherVault.withCredential("notion", (secret) => secret === "user-b-notion");
    const seenByA = await fixture.vault.withCredential("notion", (secret) => secret === `${SEEDED_SECRET}-notion`);

    expect(seenByB).toBe(true);
    expect(seenByA).toBe(true);
  });

  test("the vault's only read operation is withCredential", () => {
    const reads = Object.getOwnPropertyNames(Vault.prototype).filter((name) => name !== "constructor");
    expect(reads).toEqual(["withCredential"]);
  });

  test("opens from gateway config, carrying previous keys through a rotation", async () => {
    const db = userDb();
    const before = openVaultForUser(db, { VAULT_KEY: KEK, VAULT_KEY_PREVIOUS: OTHER_KEK }, "user-a");
    before.credentials.store({ serviceId: "notion", kind: "api_key", secret: "config-secret" });

    before.credentials.rotate(OTHER_KEK);

    const after = openVaultForUser(db, { VAULT_KEY: OTHER_KEK }, "user-a");
    const matched = await after.vault.withCredential("notion", (secret) => secret === "config-secret");
    expect(matched).toBe(true);
  });

  test("rotation re-wraps data keys without re-encrypting secrets", async () => {    const fixture = vaultFixture();
    store(fixture, "notion");
    store(fixture, "linear");
    const before = fixture.db.select().from(credentials).all();

    const rotation = fixture.store.rotate(OTHER_KEK);

    const nextKeyId = deriveVaultKey(OTHER_KEK).id;
    expect(rotation.rewrapped).toBe(2);
    expect(rotation.toKeyId).toBe(nextKeyId);

    const after = fixture.db.select().from(credentials).all();
    for (const row of after) {
      const previous = before.find((candidate) => candidate.id === row.id)!;
      expect(row.ciphertext).toBe(previous.ciphertext);
      expect(row.nonce).toBe(previous.nonce);
      expect(row.authTag).toBe(previous.authTag);
      expect(row.wrappedDataKey).not.toBe(previous.wrappedDataKey);
      expect(row.keyId).toBe(nextKeyId);
    }

    const reopened = new Vault(fixture.db, new VaultKeyring(OTHER_KEK), "user-a");
    for (const serviceId of ["notion", "linear"]) {
      const matched = await reopened.withCredential(serviceId, (secret) => secret === `${SEEDED_SECRET}-${serviceId}`);
      expect(matched).toBe(true);
    }
  });
});
