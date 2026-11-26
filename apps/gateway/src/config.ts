import { z } from "zod";
import { DEFAULT_CALL_TIMEOUT_MS, DEFAULT_CONNECTOR_CONCURRENCY } from "./connectors/call.ts";
import { DEFAULT_MAX_CONNECTORS_PER_USER } from "./connectors/quota.ts";
import { DEFAULT_MAX_RESPONSE_BYTES, DEFAULT_TIMEOUT_MS } from "./egress/guard.ts";

const secret = z
  .string()
  .refine((value) => Buffer.byteLength(value, "utf8") >= 32, {
    message: "must be at least 32 bytes",
  });

function parseHttpUrl(value: string): URL | undefined {
  if (value !== value.trim()) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const http = url.protocol === "http:" || url.protocol === "https:";
  return http && url.username === "" && url.password === "" ? url : undefined;
}

const httpUrlSchema = z
  .string()
  .refine((value) => parseHttpUrl(value) !== undefined, {
    message: "must be an absolute http(s) URL",
  });

export const webOriginSchema = z
  .string()
  .refine((value) => {
    const url = parseHttpUrl(value);
    return url !== undefined && url.pathname === "/" && url.search === "" && url.hash === "";
  }, { message: "must be an absolute http(s) origin without a path" })
  .transform((value) => parseHttpUrl(value)?.origin ?? value);

// An empty variable in a compose env_file is present but blank; treat it as
// unset so an unused optional value does not have to be deleted from .env.
const blankAsAbsent = (value: unknown) => (value === "" ? undefined : value);

// SSE feeds are long-lived; Bun's 10-second default would cut an idle one.
export const GATEWAY_IDLE_TIMEOUT_SECONDS = 120;

const booleanish = (fallback: boolean) =>
  z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .default(fallback ? "true" : "false")
    .transform((value) => value === true || value === "true" || value === "1");

const configSchema = z.object({
  VAULT_KEY: secret,
  VAULT_KEY_PREVIOUS: z.preprocess(blankAsAbsent, z.string().optional()),
  HMAC_KEY: secret,
  JWT_SECRET: secret,
  OWNER_PASSPHRASE: z.string().min(12, "must be at least 12 characters"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_PATH: z.string().min(1).default("errand.db"),
  ALLOW_LOCALHOST_DEV: booleanish(false),
  DEMO_MODE: booleanish(false),
  SESSION_COOKIE_SECURE: booleanish(true),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  EGRESS_TIMEOUT_MS: z.coerce.number().int().positive().default(DEFAULT_TIMEOUT_MS),
  EGRESS_MAX_RESPONSE_BYTES: z.coerce.number().int().positive().default(DEFAULT_MAX_RESPONSE_BYTES),
  CALL_TIMEOUT_MS: z.coerce.number().int().positive().default(DEFAULT_CALL_TIMEOUT_MS),
  CONNECTOR_CONCURRENCY: z.coerce.number().int().positive().default(DEFAULT_CONNECTOR_CONCURRENCY),
  MAX_CONNECTORS_PER_USER: z.coerce.number().int().positive().default(DEFAULT_MAX_CONNECTORS_PER_USER),
  // Must match the public callback URL registered with each authorization server.
  OAUTH_REDIRECT_URI: z.preprocess(blankAsAbsent, httpUrlSchema.optional()),
  WEB_ORIGIN: z.preprocess(blankAsAbsent, webOriginSchema.optional()),
});

export type GatewayConfig = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined>): GatewayConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid gateway configuration — ${detail}`);
  }
  return result.data;
}
