import { describe, expect, test } from "bun:test";
import path from "node:path";

const gatewayDir = path.join(import.meta.dir, "..");

function envWithoutSecrets(): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !["VAULT_KEY", "HMAC_KEY", "JWT_SECRET"].includes(name),
    ),
  ) as Record<string, string>;
  return env;
}

async function boot(env: Record<string, string>) {
  const process = Bun.spawn([Bun.argv[0]!, "src/index.ts"], {
    cwd: gatewayDir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  return { exitCode, stderr };
}

describe("gateway boot", () => {
  test("refuses to start when the secrets are absent", async () => {
    const { exitCode, stderr } = await boot(envWithoutSecrets());

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Invalid gateway configuration");
    expect(stderr).toContain("VAULT_KEY");
  });
});
