import { appendFile, writeFile } from "node:fs/promises";

const [gatewayBase, mockBase, mode = "after"] = process.argv.slice(2);
const passphrase = process.env.OWNER_PASSPHRASE ?? "";
const logPath = process.env.LOG_PATH;

function log(line = "") {
  console.log(line);
  if (logPath !== undefined) return appendFile(logPath, `${line}\n`);
  return Promise.resolve();
}

async function login() {
  const response = await fetch(`${gatewayBase}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passphrase }),
  });
  const body = await response.json();
  await log(`POST /api/auth/login -> ${response.status} authenticated=${body.authenticated}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (cookie === undefined) throw new Error("login did not set a session cookie");
  return cookie;
}

async function startFlow(cookie, name) {
  const response = await fetch(`${gatewayBase}/api/connectors/oauth/start`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name, url: `${mockBase}/oauth/mcp` }),
  });
  const body = await response.json();
  await log(`POST /api/connectors/oauth/start -> ${response.status}`);
  await log(`  connector ${body.connector.id} authStatus=${body.connector.authStatus}`);
  if (response.status !== 201) throw new Error(JSON.stringify(body));
  return body;
}

async function approve(authorizationUrl) {
  const authorize = new URL(authorizationUrl);
  const page = await fetch(authorize);
  const html = await page.text();
  await log(`GET ${authorize.pathname} -> ${page.status} consent-form=${html.includes("<form")}`);
  const response = await fetch(`${authorize.origin}${authorize.pathname}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: authorize.searchParams.toString(),
    redirect: "manual",
  });
  const location = response.headers.get("location");
  await log(`POST ${authorize.pathname} (Approve) -> ${response.status}`);
  await log(`  Location: ${location}`);
  if (location === null) throw new Error("consent did not redirect to the callback");
  return location;
}

async function callback(cookie, location, extra = {}, acceptHtml = true) {
  const url = new URL(location);
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: {
      cookie,
      ...(acceptHtml ? { accept: "text/html,application/xhtml+xml" } : {}),
    },
    redirect: "manual",
  });
  const body = await response.text();
  await log(`GET ${url.pathname}${url.search}${acceptHtml ? " (Accept: text/html)" : " (no HTML accept)"}`);
  await log(`  status: ${response.status}`);
  await log(`  Location: ${response.headers.get("location")}`);
  await log(`  Content-Type: ${response.headers.get("content-type")}`);
  await log(`  body: ${body.replace(/\s+/g, " ").slice(0, 300)}`);
  return { status: response.status, body };
}

if (logPath !== undefined) await writeFile(logPath, "");
await log(`# OAuth callback proof — ${mode} — gateway ${gatewayBase}, mock ${mockBase}`);
const cookie = await login();

const first = await startFlow(cookie, `Mock calendar ${mode} 1`);
const firstCallback = await approve(first.authorizationUrl);
await callback(cookie, firstCallback);

if (mode === "after") {
  const second = await startFlow(cookie, "Mock calendar after 2");
  const secondCallback = await approve(second.authorizationUrl);
  await callback(cookie, secondCallback, {}, false);

  const third = await startFlow(cookie, "Mock calendar after 3");
  const thirdCallback = await approve(third.authorizationUrl);
  await callback(cookie, thirdCallback, {
    webOrigin: "https://evil.example",
    next: "https://evil.example",
  });
}

await log("# end");
