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

async function consent(authorizationUrl) {
  const authorize = new URL(authorizationUrl);
  for (const attempt of ["open", "refresh mid-flow"]) {
    const page = await fetch(authorize);
    await log(`GET ${authorize.pathname} (${attempt}) -> ${page.status}`);
    if (page.status !== 200) throw new Error("consent page unavailable");
  }
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

async function callback(cookie, location, note, extra = {}, acceptHtml = true) {
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
  await log(`GET ${url.pathname}${url.search} (${note})`);
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
const firstCallback = await consent(first.authorizationUrl);
await callback(cookie, firstCallback, "success, Accept: text/html");

if (mode === "after") {
  await callback(cookie, firstCallback, "replay of the consumed state, Accept: text/html");

  const unknown = await fetch(`${gatewayBase}/api/oauth/callback?state=nope&code=x`, {
    headers: { accept: "text/html", cookie },
    redirect: "manual",
  });
  await log("GET /api/oauth/callback?state=nope&code=x (unknown state, Accept: text/html)");
  await log(`  status: ${unknown.status}`);
  await log(`  body: ${(await unknown.text()).replace(/\s+/g, " ").slice(0, 300)}`);

  const refreshed = await startFlow(cookie, "Mock calendar after 2 (consent refreshed)");
  const refreshedCallback = await consent(refreshed.authorizationUrl);
  await callback(cookie, refreshedCallback, "success after a mid-flow consent refresh");

  const json = await startFlow(cookie, "Mock calendar after 3");
  const jsonCallback = await consent(json.authorizationUrl);
  await callback(cookie, jsonCallback, "non-HTML caller", {}, false);

  const evil = await startFlow(cookie, "Mock calendar after 4");
  const evilCallback = await consent(evil.authorizationUrl);
  await callback(cookie, evilCallback, "attempted open redirect", {
    webOrigin: "https://evil.example",
    next: "https://evil.example",
  });
} else {
  const unknown = await fetch(`${gatewayBase}/api/oauth/callback?state=nope&code=x`, {
    headers: { accept: "text/html", cookie },
    redirect: "manual",
  });
  await log("GET /api/oauth/callback?state=nope&code=x (unknown state, Accept: text/html)");
  await log(`  status: ${unknown.status}`);
  await log(`  body: ${(await unknown.text()).replace(/\s+/g, " ").slice(0, 300)}`);
}

await log("# end");
