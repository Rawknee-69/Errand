import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

const base = "http://127.0.0.1:5301";
const repo = "C:/Users/Rem/.local/share/opencode/worktree/5e3805/tidy-star";
const screens = `${repo}/docs/proof/19-receipts-trust-journal-keys/screens`;
const logs = `${repo}/docs/proof/19-receipts-trust-journal-keys/logs`;
const executablePath =
  "C:/Users/Rem/AppData/Local/ms-playwright/chromium-1255/chrome-win64/chrome.exe";

type Observation = {
  where: string;
  kind: string;
  detail: string;
};

const observations: Observation[] = [];

function watch(page: Page, where: string): void {
  page.on("console", (message) => {
    if (message.type() === "error") {
      observations.push({ where, kind: "console.error", detail: message.text() });
    }
  });
  page.on("pageerror", (error) => {
    observations.push({ where, kind: "pageerror", detail: error.message });
  });
  page.on("requestfailed", (request) => {
    observations.push({
      where,
      kind: "requestfailed",
      detail: `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`,
    });
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      observations.push({
        where,
        kind: "http",
        detail: `${response.status()} ${response.request().method()} ${response.url()}`,
      });
    }
  });
}

async function signIn(page: Page): Promise<void> {
  await page.goto(`${base}/receipts`, { waitUntil: "networkidle" });
  if (await page.getByText("Owner passphrase").count()) {
    await page.locator("input[type=password]").fill("proof-passphrase-19");
    await page.getByRole("button", { name: "Open control panel" }).click();
    await page.waitForURL("**/connect");
  }
}

async function desktop(browser: Browser): Promise<{ width: number; height: number }> {
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  watch(page, "desktop");
  await signIn(page);

  await page.goto(`${base}/receipts`, { waitUntil: "networkidle" });
  await page.getByText("What actually happened").waitFor();
  await page.screenshot({
    path: `${screens}/01-desktop-receipts.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.getByRole("button", { name: "Undo this change" }).first().click();
  const undone = page.locator(".receipt-card").filter({ hasText: "Created “Doomed event”" });
  await undone.getByText("Undone").waitFor({ timeout: 15_000 });
  await undone.getByText("Deleted evt-").waitFor({ timeout: 15_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `${screens}/02-desktop-receipts-undone.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.goto(`${base}/trust`, { waitUntil: "networkidle" });
  await page.getByText("What your agent has earned").waitFor();
  await page.screenshot({
    path: `${screens}/03-desktop-trust-offer.png`,
    fullPage: true,
    animations: "disabled",
  });

  const offered = page.locator(".trust-card").filter({ hasText: "5 of 5 clean runs" });
  await offered.locator("input").nth(0).fill("2");
  await offered.locator("input").nth(1).fill("15");
  await offered.locator("input").nth(2).fill("5");
  await offered.getByRole("button", { name: "Accept license with these caps" }).click();
  await offered.getByRole("button", { name: "Update caps" }).waitFor({ timeout: 10_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `${screens}/04-desktop-trust-license.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.goto(`${base}/journal`, { waitUntil: "networkidle" });
  await page.getByText("Is the record intact?").waitFor();
  await page.getByRole("button", { name: "Run the journal check" }).click();
  await page.getByText("Chain intact").waitFor({ timeout: 10_000 });
  await page.screenshot({
    path: `${screens}/05-desktop-journal-clean.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.goto(`${base}/keys`, { waitUntil: "networkidle" });
  await page.getByText("The keys your agents use").waitFor();
  await page.screenshot({
    path: `${screens}/06-desktop-keys.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.getByPlaceholder("Claude Code").fill("Cursor laptop");
  await page.getByRole("button", { name: "Create agent key" }).click();
  await page.getByText("Copy this now").waitFor({ timeout: 10_000 });
  await page.screenshot({
    path: `${screens}/07-desktop-key-created.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.getByRole("button", { name: "I saved it, hide the key" }).click();
  const seed = page.locator(".key-card").filter({ hasText: "Proof agent" });
  await seed.getByRole("button", { name: "Revoke" }).click();
  await seed.getByRole("button", { name: "Revoke this key now" }).click();
  await seed.getByText("Revoked").waitFor({ timeout: 10_000 });
  await page.screenshot({
    path: `${screens}/08-desktop-key-revoked.png`,
    fullPage: true,
    animations: "disabled",
  });

  const size = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  await context.close();
  return size;
}

async function phone(browser: Browser): Promise<{ width: number; height: number }> {
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  watch(page, "phone");
  await signIn(page);

  await page.goto(`${base}/receipts`, { waitUntil: "networkidle" });
  await page.getByText("What actually happened").waitFor();
  await page.screenshot({
    path: `${screens}/09-phone-receipts.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.goto(`${base}/trust`, { waitUntil: "networkidle" });
  await page.getByText("What your agent has earned").waitFor();
  await page.screenshot({
    path: `${screens}/10-phone-trust.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.goto(`${base}/journal`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Run the journal check" }).click();
  await page.getByText("Chain intact").waitFor({ timeout: 10_000 });
  await page.screenshot({
    path: `${screens}/11-phone-journal.png`,
    fullPage: true,
    animations: "disabled",
  });

  await page.goto(`${base}/keys`, { waitUntil: "networkidle" });
  await page.getByText("The keys your agents use").waitFor();
  await page.screenshot({
    path: `${screens}/12-phone-keys.png`,
    fullPage: true,
    animations: "disabled",
  });

  const size = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  await context.close();
  return size;
}

const browser = await chromium.launch({ executablePath, headless: true });
const desktopSize = await desktop(browser);
const phoneSize = await phone(browser);
await browser.close();

await Bun.write(
  `${logs}/browser-window.txt`,
  [
    `desktop viewport ${desktopSize.width}x${desktopSize.height}`,
    `phone viewport ${phoneSize.width}x${phoneSize.height}`,
    ...observations.map((row) => `[${row.where}] ${row.kind}: ${row.detail}`),
    observations.length === 0 ? "no console errors, page errors, failed requests or 4xx/5xx" : "",
  ].join("\n"),
);

console.log(`desktop ${desktopSize.width}x${desktopSize.height}`);
console.log(`phone ${phoneSize.width}x${phoneSize.height}`);
console.log(`observations: ${observations.length}`);
for (const row of observations) console.log(`${row.where} ${row.kind}: ${row.detail}`);
console.log("VERDICT: browser drive pass");
