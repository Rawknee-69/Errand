const base = "http://127.0.0.1:8899";
const repo = "C:/Users/Rem/.local/share/opencode/worktree/5e3805/tidy-star";
const logs = `${repo}/docs/proof/19-receipts-trust-journal-keys/logs`;

const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ passphrase: "proof-passphrase-19" }),
});
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (cookie === undefined) throw new Error("login failed");

async function save(path: string, file: string): Promise<void> {
  const response = await fetch(`${base}${path}`, { headers: { cookie } });
  const body = await response.text();
  await Bun.write(`${logs}/${file}`, `${response.status}\n${body}\n`);
  console.log(`${path} -> ${response.status} ${file}`);
}

await save("/api/receipts", "api-receipts.json");
await save("/api/trust", "api-trust.json");
await save("/api/agent-keys", "api-agent-keys.json");
await save("/api/journal/verify", "journal-verify-broken.json");
