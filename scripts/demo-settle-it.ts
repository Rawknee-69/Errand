import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { seedSettleFixtures } from "./settle-it/fixtures.ts";
import { runSettleIt } from "./settle-it/story.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const base = process.env.GATEWAY_URL ?? "http://127.0.0.1:8787";
const mock = process.env.MOCK_URL ?? "http://127.0.0.1:4001";
const autoApprove = Bun.argv.includes("--auto-approve");
const tapSpend = Bun.argv.includes("--tap-spend");

function assertLoopback(raw: string, label: string): void {
  const host = new URL(raw).hostname;
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`${label} must be a loopback URL; refusing to run against ${host}`);
  }
}

assertLoopback(base, "GATEWAY_URL");
assertLoopback(mock, "MOCK_URL");

const passphrase = await readFile(`${root}/.demo/secrets.json`, "utf8")
  .then((text) => z.object({ OWNER_PASSPHRASE: z.string() }).parse(JSON.parse(text)).OWNER_PASSPHRASE)
  .catch(() => {
    throw new Error("Run `bun run demo:up` first; .demo/secrets.json is missing.");
  });

const health = await fetch(`${base}/health`).catch(() => undefined);
if (health === undefined || !health.ok) {
  throw new Error(`The gateway is not answering at ${base}. Run \`bun run demo:up\` first.`);
}

const fixtures = await seedSettleFixtures(base, mock, passphrase);
try {
  await runSettleIt(fixtures, { autoApprove, tapSpend, mock });
} finally {
  await fixtures.owner.agent.close();
  for (const friend of fixtures.friends) await friend.agent.close();
}
