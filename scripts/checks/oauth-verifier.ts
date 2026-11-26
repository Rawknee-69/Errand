// Correction: the PKCE verifier is a secret. It lives encrypted in the Vault
// and the plain oauth_attempts row must never grow a code_verifier column
// again. Fails the build if it does.
import { at, read, type Violation } from "./_shared";

export const name = "oauth-verifier";

const file = "apps/gateway/src/db/schema.ts";

export function run(): Violation[] {
  const text = read(file);
  const start = text.indexOf("export const oauthAttempts");
  if (start === -1) {
    return [{ file, line: 1, column: 1, message: "oauthAttempts table not found" }];
  }
  const end = text.indexOf("});", start);
  const block = text.slice(start, end === -1 ? undefined : end);
  const match = /\bcodeVerifier\b|\bcode_verifier\b/.exec(block);
  if (match === null) return [];
  return [
    at(
      file,
      text,
      start + match.index,
      "the PKCE verifier must stay in the Vault, not in oauth_attempts",
    ),
  ];
}
