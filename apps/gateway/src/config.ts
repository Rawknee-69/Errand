import { z } from "zod";

const secret = z
  .string()
  .refine((value) => Buffer.byteLength(value, "utf8") >= 32, {
    message: "must be at least 32 bytes",
  });

const configSchema = z.object({
  VAULT_KEY: secret,
  HMAC_KEY: secret,
  JWT_SECRET: secret,
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_PATH: z.string().min(1).default("errand.db"),
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
