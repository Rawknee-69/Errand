import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

type Secrets = {
  VAULT_KEY: string;
  HMAC_KEY: string;
  JWT_SECRET: string;
  OWNER_PASSPHRASE: string;
};

const root = fileURLToPath(new URL("..", import.meta.url));
const demoDir = join(root, ".demo");
const logDir = join(demoDir, "logs");
const secretsPath = join(demoDir, "secrets.json");
const databasePath = join(demoDir, "errand.db");

const fresh = Bun.argv.includes("--fresh");
const secret = () => randomBytes(32).toString("base64");

async function loadSecrets(): Promise<Secrets> {
  try {
    return JSON.parse(await readFile(secretsPath, "utf8")) as Secrets;
  } catch {
    const created: Secrets = {
      VAULT_KEY: secret(),
      HMAC_KEY: secret(),
      JWT_SECRET: secret(),
      OWNER_PASSPHRASE: "errand-demo-passphrase",
    };
    await Bun.write(secretsPath, `${JSON.stringify(created, null, 2)}\n`);
    return created;
  }
}

async function waitFor(url: string, label: string, logPath: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The child is still binding its port.
    }
    await Bun.sleep(250);
  }
  const tail = await readFile(logPath, "utf8").catch(() => "");
  throw new Error(
    `${label} did not answer at ${url}. Last lines of ${logPath}:\n${tail.split("\n").slice(-20).join("\n")}`,
  );
}

type DemoAccount = {
  users: Array<{ id: string; name: string; createdAt: string }>;
  keys: Array<{
    id: string;
    userId: string;
    name: string;
    keyHash: string;
    createdAt: string;
    revokedAt: string | null;
  }>;
};

// Demo guests and every issued agent key are held in memory across `--fresh`,
// so a reset never logs the audience out or invalidates a key they copied. The
// owner row is re-created by the gateway; a key for a missing user is ignored.
function readDemoAccounts(): DemoAccount {
  if (!existsSync(databasePath)) return { users: [], keys: [] };
  const db = new Database(databasePath, { readonly: true });
  try {
    const users = db.query("select id, name, created_at as createdAt from users where id like 'demo-%'").all() as DemoAccount["users"];
    const keys = db
      .query(
        "select id, user_id as userId, name, key_hash as keyHash, created_at as createdAt, revoked_at as revokedAt from agent_keys",
      )
      .all() as DemoAccount["keys"];
    return { users, keys };
  } catch {
    return { users: [], keys: [] };
  } finally {
    db.close();
  }
}

function restoreDemoAccounts(accounts: DemoAccount): void {
  if (accounts.users.length === 0 && accounts.keys.length === 0) return;
  const db = new Database(databasePath, { create: false });
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    const insertUser = db.prepare(
      "insert or ignore into users (id, name, created_at) values ($id, $name, $createdAt)",
    );
    for (const user of accounts.users) {
      insertUser.run({ $id: user.id, $name: user.name, $createdAt: user.createdAt });
    }
    const insertKey = db.prepare(
      "insert or ignore into agent_keys (id, user_id, name, key_hash, created_at, revoked_at) values ($id, $userId, $name, $keyHash, $createdAt, $revokedAt)",
    );
    for (const key of accounts.keys) {
      insertKey.run({
        $id: key.id,
        $userId: key.userId,
        $name: key.name,
        $keyHash: key.keyHash,
        $createdAt: key.createdAt,
        $revokedAt: key.revokedAt,
      });
    }
  } finally {
    db.close();
  }
}

await mkdir(logDir, { recursive: true });
const demoAccounts = fresh ? readDemoAccounts() : { users: [], keys: [] };
if (fresh) {
  try {
    for (const suffix of ["", "-shm", "-wal"]) {
      await rm(`${databasePath}${suffix}`, { force: true });
    }
  } catch {
    console.error(
      "Cannot reset the demo database because another gateway still holds it.\n" +
        "Stop the running demo first, then run `bun run demo:up --fresh`.",
    );
    process.exit(1);
  }
}
const secrets = await loadSecrets();

type Child = ReturnType<typeof Bun.spawn>;
const children: Child[] = [];

async function pump(stream: ReadableStream<Uint8Array>, write: (chunk: Uint8Array) => void) {
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    write(value);
  }
}

function start(name: string, args: string[], env: Record<string, string>): Child {
  const sink = Bun.file(join(logDir, `${name}.log`)).writer();
  const child = Bun.spawn(args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  void pump(child.stdout, (chunk) => sink.write(chunk));
  void pump(child.stderr, (chunk) => sink.write(chunk));
  void child.exited.then(() => sink.end());
  children.push(child);
  return child;
}

let stopping = false;
function stopAll(code = 0): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exit(code);
}
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

console.log("Starting Errand…");

start("mock-services", ["bun", "apps/mock-services/src/index.ts"], {
  PORT: "4001",
});

start("gateway", ["bun", "apps/gateway/src/index.ts"], {
  PORT: "8787",
  DATABASE_PATH: databasePath,
  VAULT_KEY: secrets.VAULT_KEY,
  HMAC_KEY: secrets.HMAC_KEY,
  JWT_SECRET: secrets.JWT_SECRET,
  OWNER_PASSPHRASE: secrets.OWNER_PASSPHRASE,
  DEMO_MODE: "true",
  // Keeps a demo guest signed in for the whole demo day.
  SESSION_TTL_HOURS: "24",
  SESSION_COOKIE_SECURE: "false",
  ALLOW_LOCALHOST_DEV: "true",
  OAUTH_REDIRECT_URI: "http://127.0.0.1:8787/api/oauth/callback",
  WEB_ORIGIN: "http://127.0.0.1:5173",
});

start(
  "web",
  ["bun", "run", "--cwd", "apps/web", "dev", "--", "--host", "127.0.0.1", "--port", "5173"],
  { GATEWAY_URL: "http://127.0.0.1:8787" },
);

try {
  await Promise.all([
    waitFor("http://127.0.0.1:4001/health", "mock services", `${logDir}/mock-services.log`),
    waitFor("http://127.0.0.1:8787/health", "gateway", `${logDir}/gateway.log`),
    waitFor("http://127.0.0.1:5173/", "web", `${logDir}/web.log`),
  ]);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stopAll(1);
}

restoreDemoAccounts(demoAccounts);

console.log("");
console.log("  Errand demo is up");
console.log("  ------------------");
console.log("  Control panel   http://127.0.0.1:5173");
console.log(`  Owner passphrase ${secrets.OWNER_PASSPHRASE}`);
console.log("  Notion URL      https://mcp.notion.com/mcp");
console.log("  Offline server  http://127.0.0.1:4001/calendar/mcp");
if (demoAccounts.users.length > 0) {
  console.log(
    `  Kept ${demoAccounts.users.length} demo guest(s) and ${demoAccounts.keys.length} key(s) across the reset`,
  );
}
console.log("");
console.log("  Next: bun run demo:seed");
console.log(`  Logs: ${logDir}`);
console.log("  Ctrl+C stops gateway, mock services and web together.");
console.log("");

await new Promise<never>(() => undefined);
