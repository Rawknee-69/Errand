import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "errand_session";
const ISSUER = "errand";
const AUDIENCE = "errand-control-panel";

export type SessionClaims = {
  userId: string;
  demo: boolean;
};

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function issueSession(
  secret: string,
  claims: SessionClaims,
  ttlSeconds: number,
  now: number,
): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  return new SignJWT({ demo: claims.demo })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ttlSeconds)
    .sign(key(secret));
}

export async function readSession(
  secret: string,
  token: string,
  now: number,
): Promise<SessionClaims | undefined> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      currentDate: new Date(now),
    });
    if (typeof payload.sub !== "string" || typeof payload.demo !== "boolean") return undefined;
    return { userId: payload.sub, demo: payload.demo };
  } catch {
    return undefined;
  }
}
