import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "../db/journal.ts";
import { purposeKey, verifySlipSignature, type SlipRecord } from "./slip-signing.ts";

const TOKEN_PREFIX = "cap_";
const CAPABILITY_PURPOSE = "errand/capability/v1";

const claimsSchema = z
  .object({
    v: z.literal(1),
    aud: z.string(),
    uid: z.string(),
    exp: z.string(),
  })
  .strict();

type CapabilityClaims = z.infer<typeof claimsSchema>;

function capabilitySignature(master: string, payload: string): Buffer {
  return createHmac("sha256", purposeKey(master, CAPABILITY_PURPOSE)).update(payload).digest();
}

function claimsFor(slip: Pick<SlipRecord, "id" | "userId" | "expiresAt">): CapabilityClaims {
  return { v: 1, aud: slip.id, uid: slip.userId, exp: slip.expiresAt };
}

// Deterministic so polling errand_status returns the same capability; the slip
// row keeps only its hash and can revoke it by clearing that hash.
export function issueCapability(slip: Pick<SlipRecord, "id" | "userId" | "expiresAt">, master: string): string {
  const payload = Buffer.from(canonicalJson(claimsFor(slip)), "utf8").toString("base64url");
  const signature = capabilitySignature(master, payload).toString("base64url");
  return `${TOKEN_PREFIX}${payload}.${signature}`;
}

export function hashCapability(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function signatureMatches(master: string, payload: string, presented: string): boolean {
  const given = Buffer.from(presented, "base64url");
  const expected = capabilitySignature(master, payload);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function verifyCapability(
  slip: SlipRecord,
  token: string,
  master: string,
  now: Date,
): boolean {
  if (slip.state !== "approved" || slip.capabilityHash === null) return false;

  const stored = Buffer.from(slip.capabilityHash, "hex");
  const presented = Buffer.from(hashCapability(token), "hex");
  if (stored.length !== presented.length || !timingSafeEqual(stored, presented)) return false;

  if (!token.startsWith(TOKEN_PREFIX)) return false;
  const [payload, signature, ...rest] = token.slice(TOKEN_PREFIX.length).split(".");
  if (payload === undefined || signature === undefined || rest.length > 0) return false;
  if (!signatureMatches(master, payload, signature)) return false;

  let claims: CapabilityClaims;
  try {
    claims = claimsSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  } catch {
    return false;
  }

  const expiresAt = Date.parse(slip.expiresAt);
  return (
    claims.aud === slip.id &&
    claims.uid === slip.userId &&
    claims.exp === slip.expiresAt &&
    Number.isFinite(expiresAt) &&
    now.getTime() < expiresAt
  );
}

export function issueValidCapability(
  slip: SlipRecord,
  master: string,
  now: Date,
): string | null {
  if (!verifySlipSignature(slip, master)) return null;
  const token = issueCapability(slip, master);
  return verifyCapability(slip, token, master, now) ? token : null;
}
