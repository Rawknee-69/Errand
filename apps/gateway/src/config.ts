import { z } from "zod";
import { DEFAULT_MAX_CONNECTORS_PER_USER } from "./connectors/quota.ts";
import { DEFAULT_MAX_RESPONSE_BYTES, DEFAULT_TIMEOUT_MS } from "./egress/guard.ts";

const secret = z
  .string()
  .refine((value) => Buffer.byteLength(value, "utf8") >= 32, {
    message: "must be at least 32 bytes",
  });

const configSchema = z.object({
  VAULT_KEY: secret,
  VAULT_KEY_PREVIOUS: z.string().optional(),
  HMAC_KEY: secret,
  JWT_SECRET: secret,
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_PATH: z.string().min(1).default("errand.db"),
  ALLOW_LOCALHOST_DEV: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .default("false")
    .transform((value) => value === true || value === "true" || value === "1"),
  EGRESS_TIMEOUT_MS: z.coerce.number().int().positive().default(DEFAULT_TIMEOUT_MS),
  EGRESS_MAX_RESPONSE_BYTES: z.coerce.number().int().positive().default(DEFAULT_MAX_RESPONSE_BYTES),
  MAX_CONNECTORS_PER_USER: z.coerce.number().int().positive().default(DEFAULT_MAX_CONNECTORS_PER_USER),
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
