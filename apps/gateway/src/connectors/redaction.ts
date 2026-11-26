import { authSecrets, type ConnectorAuth } from "./auth.ts";

export function redactText(text: string, secrets: string[]): string {
  let redacted = text;
  // Longest first, so a short password cannot break a longer encoded form
  // (the base64 `user:password` header) before that form is replaced.
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret !== "") redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
}

function redactValue(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets));
  if (value !== null && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) redacted[key] = redactValue(item, secrets);
    return redacted;
  }
  return value;
}

// Upstream results are untrusted and may echo whatever was sent, so every
// credential value is replaced before the result reaches the agent or a row.
export function redactAuthSecrets(value: unknown, auth: ConnectorAuth): unknown {
  return redactValue(value, authSecrets(auth));
}
