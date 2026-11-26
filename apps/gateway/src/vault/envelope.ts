import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

export type VaultKey = { id: string; key: Buffer };

export type SealedSecret = {
  ciphertext: string;
  nonce: string;
  authTag: string;
};

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const DATA_KEY_BYTES = 32;
const WRAP_VERSION = 1;

export function deriveVaultKey(material: string): VaultKey {
  if (Buffer.byteLength(material, "utf8") < 32) {
    throw new Error("vault key material must be at least 32 bytes");
  }
  const key = Buffer.from(
    hkdfSync("sha256", Buffer.from(material, "utf8"), Buffer.from("errand-vault"), Buffer.from("key-encryption-key"), 32),
  );
  return { id: createHash("sha256").update(key).digest("hex").slice(0, 16), key };
}

export function generateDataKey(): Buffer {
  return randomBytes(DATA_KEY_BYTES);
}

export function credentialAad(credentialId: string, serviceId: string): string {
  return `credential\u0000${credentialId}\u0000${serviceId}`;
}

function wrapAad(keyId: string): string {
  return `vault-key\u0000${keyId}`;
}

export function wrapDataKey(kek: VaultKey, dataKey: Buffer): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", kek.key, nonce);
  cipher.setAAD(Buffer.from(wrapAad(kek.id), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  const packed = Buffer.concat([Buffer.from([WRAP_VERSION]), nonce, cipher.getAuthTag(), ciphertext]);
  return packed.toString("base64");
}

export function unwrapDataKey(kek: VaultKey, wrapped: string): Buffer {
  const packed = Buffer.from(wrapped, "base64");
  const minLength = 1 + NONCE_BYTES + TAG_BYTES + DATA_KEY_BYTES;
  if (packed.length !== minLength || packed[0] !== WRAP_VERSION) {
    throw new Error("wrapped data key is malformed");
  }
  const nonce = packed.subarray(1, 1 + NONCE_BYTES);
  const tag = packed.subarray(1 + NONCE_BYTES, 1 + NONCE_BYTES + TAG_BYTES);
  const ciphertext = packed.subarray(1 + NONCE_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", kek.key, nonce);
  decipher.setAAD(Buffer.from(wrapAad(kek.id), "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function sealSecret(dataKey: Buffer, plaintext: string, aad: string): SealedSecret {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", dataKey, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function openSecret(dataKey: Buffer, sealed: SealedSecret, aad: string): string {
  const nonce = Buffer.from(sealed.nonce, "base64");
  const tag = Buffer.from(sealed.authTag, "base64");
  if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("sealed secret is malformed");
  }
  const decipher = createDecipheriv("aes-256-gcm", dataKey, nonce);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  const ciphertext = Buffer.from(sealed.ciphertext, "base64");
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
