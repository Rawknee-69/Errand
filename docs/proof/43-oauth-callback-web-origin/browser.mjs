import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const proofDir = process.env.PROOF_DIR ?? "";
const passphrase = process.env.OWNER_PASSPHRASE ?? "";
const webBase = process.env.WEB_BASE ?? "http://127.0.0.1:5173";
const afterBase = process.env.AFTER_BASE ?? "http://127.0.0.1:8788";
const beforeBase = process.env.BEFORE_BASE ?? "http://127.0.0.1:8789";
const mockBase = process.env.MOCK_BASE ?? "http://127.0.0.1:4002";

const screens = join(proofDir, "screens");
await mkdir(screens, { recursive: true });

const lines = [];
async function step(line) {
  console.log(line);
  lines.push(line);
}

async function gatewayLogin(base) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passphrase }),
  });
  if (response.status !== 200) throw new Error(`login ${base} -> ${response.status}`);
  const pair = (response.headers.get("set-cookie") ?? "").split(";")[0];
  const separator = pair.indexOf("=");
  if (separator === -1) throw new Error("no session cookie");
  return { name: pair.slice(0, separator), value: pair.slice(separator + 1) };
}

async function startAndApprove(base, name) {
  const session = await gatewayLogin(base);
  const cookie = `${session.name}=${session.value}`;
  const start = await fetch(`${base}/api/connectors/oauth/start`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name, url: `${mockBase}/oauth/mcp` }),
  });
  const started = await start.json();
  const authorize = new URL(started.authorizationUrl);
  const consent = await fetch(authorize);
  const consentHtml = await consent.text();
  const approved = await fetch(`${authorize.origin}${authorize.pathname}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: authorize.searchParams.toString(),
    redirect: "manual",
  });
  const callbackUrl = approved.headers.get("location");
  if (callbackUrl === null) throw new Error("consent did not redirect");
  return { session, consentStatus: consent.status, consentHtml, callbackUrl };
}

const browser = await chromium.launch({ channel: "msedge", headless: true });

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const consoleMessages = [];
const network = [];
page.on("console", (message) => consoleMessages.push(`[${message.type()}] ${message.text()}`));
page.on("pageerror", (error) => consoleMessages.push(`[pageerror] ${error.message}`));
page.on("response", (response) => network.push(`${response.status()} ${response.request().method()} ${response.url()}`));
page.on("requestfailed", (request) =>
  network.push(`FAILED ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`),
);

await page.goto(`${webBase}/`, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "Open control panel" }).waitFor();
await page.screenshot({ path: join(screens, "01-login-desktop.png"), fullPage: true });
await step(`01 login screen: url=${page.url()}`);

await page.getByLabel("Owner passphrase").fill(passphrase);
await page.getByRole("button", { name: "Open control panel" }).click();
await page.waitForURL("**/connect");
await page.getByRole("heading", { name: "Paste one URL" }).waitFor();
await page.screenshot({ path: join(screens, "02-connect-desktop.png"), fullPage: true });
await step(`02 signed in, connect screen: url=${page.url()}`);

await page.getByRole("button", { name: "Connectors", exact: true }).first().click();
await page.getByRole("heading", { name: "What Errand is connected to" }).waitFor();
await page.getByText("Nothing connected").waitFor();
await page.screenshot({ path: join(screens, "03-connectors-empty-desktop.png"), fullPage: true });
await step(`03 empty connectors screen: url=${page.url()} text="${(await page.locator("main.content").innerText()).replace(/\s+/g, " ").slice(0, 200)}"`);

const started = await page.evaluate(async (mcpUrl) => {
  const response = await fetch("/api/connectors/oauth/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Mock calendar (browser)", url: mcpUrl }),
  });
  const body = await response.json();
  return { status: response.status, authorizationUrl: body.authorizationUrl, connectorId: body.connector?.id };
}, `${mockBase}/oauth/mcp`);
await step(`04 OAuth start via control-panel origin: status=${started.status} connector=${started.connectorId}`);

await page.goto(started.authorizationUrl, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "Approve" }).waitFor();
await page.screenshot({ path: join(screens, "04-consent-desktop.png"), fullPage: true });
await step(`05 consent page: url=${page.url()} heading=${await page.locator("h1").innerText()}`);

await page.getByRole("button", { name: "Approve" }).click();
await page.waitForURL(`${webBase}/connectors`, { timeout: 20000 });
await page.getByRole("heading", { name: "What Errand is connected to" }).waitFor();
await page.getByText("Mock calendar (browser)").waitFor();
await step(`06 redirect landed on: ${page.url()}`);
const connectorCards = await page.locator("article.connector-card").count();
const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
await step(`07 connectors screen: cards=${connectorCards} text="${bodyText.slice(0, 420)}"`);
await page.screenshot({ path: join(screens, "05-connectors-after-redirect-desktop.png"), fullPage: true });

const refresh = page.getByRole("button", { name: "Refresh catalog" }).first();
await refresh.click();
await page.waitForTimeout(1500);
const firstCard = (await page.locator("article.connector-card").first().innerText()).replace(/\s+/g, " ");
await step(`08 refresh button driven; first card: "${firstCard}"`);
await page.screenshot({ path: join(screens, "06-connectors-after-refresh-desktop.png"), fullPage: true });

await page.getByRole("button", { name: "Catalog", exact: true }).first().click();
await page.getByRole("heading", { name: "Every tool, and what it may do" }).waitFor();
await step(`09 catalog screen: url=${page.url()}`);
await page.screenshot({ path: join(screens, "07-catalog-desktop.png"), fullPage: true });

await page.getByRole("button", { name: "Connectors", exact: true }).first().click();
await page.getByRole("heading", { name: "What Errand is connected to" }).waitFor();
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
const phoneMetrics = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
}));
await page.screenshot({ path: join(screens, "08-connectors-phone.png"), fullPage: true });
await step(`10 phone viewport: scrollWidth=${phoneMetrics.scrollWidth} innerWidth=${phoneMetrics.innerWidth}`);

const secrets = ["access_token", "refresh_token", "client_secret", "code_verifier", "codeVerifier"];
const visible = await page.locator("body").innerText();
const leaked = secrets.filter((word) => visible.includes(word));
await step(`11 secret words visible in page: ${leaked.length === 0 ? "none" : leaked.join(", ")}`);

const before = await startAndApprove(beforeBase, "Mock calendar (before)");
const beforeContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await beforeContext.addCookies([
  { name: before.session.name, value: before.session.value, domain: "127.0.0.1", path: "/" },
]);
const beforePage = await beforeContext.newPage();
await beforePage.goto(before.callbackUrl, { waitUntil: "domcontentloaded" });
const beforeHeading = await beforePage.locator("h1").innerText();
const beforeLinks = await beforePage.locator("a").evaluateAll((anchors) =>
  anchors.map((anchor) => ({ text: anchor.textContent, href: anchor.getAttribute("href") })),
);
await beforePage.screenshot({ path: join(screens, "09-before-deadend-desktop.png"), fullPage: true });
await step(`12 before page (no WEB_ORIGIN): url=${beforePage.url()} heading=${beforeHeading} links=${JSON.stringify(beforeLinks)}`);

for (const message of consoleMessages) await step(`console ${message}`);
for (const entry of network) await step(`network ${entry}`);

await writeFile(join(proofDir, "logs", "browser-window.txt"), `${lines.join("\n")}\n`, "utf8");
await browser.close();
