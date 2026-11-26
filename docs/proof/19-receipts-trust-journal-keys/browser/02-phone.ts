import { chromium } from "playwright-core";

const base = "http://127.0.0.1:5301";
const repo = "C:/Users/Rem/.local/share/opencode/worktree/5e3805/tidy-star";
const screens = `${repo}/docs/proof/19-receipts-trust-journal-keys/screens`;
const executablePath =
  "C:/Users/Rem/AppData/Local/ms-playwright/chromium-1255/chrome-win64/chrome.exe";

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
const page = await context.newPage();

await page.goto(`${base}/receipts`, { waitUntil: "networkidle" });
if (await page.getByText("Owner passphrase").count()) {
  await page.locator("input[type=password]").fill("proof-passphrase-19");
  await page.getByRole("button", { name: "Open control panel" }).click();
  await page.waitForURL("**/connect");
}

await page.goto(`${base}/receipts`, { waitUntil: "networkidle" });
await page.getByText("What actually happened").waitFor();
await page.screenshot({ path: `${screens}/09-phone-receipts.png`, animations: "disabled" });
await page.getByText('Created “Proof dinner”').scrollIntoViewIfNeeded();
await page.screenshot({
  path: `${screens}/09b-phone-receipts-undo.png`,
  animations: "disabled",
});

await page.goto(`${base}/trust`, { waitUntil: "networkidle" });
await page.getByText("What your agent has earned").waitFor();
await page.screenshot({ path: `${screens}/10-phone-trust.png`, animations: "disabled" });
await page.locator(".trust-card").filter({ hasText: "Update caps" }).scrollIntoViewIfNeeded();
await page.screenshot({ path: `${screens}/10b-phone-trust-caps.png`, animations: "disabled" });

await page.goto(`${base}/journal`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Run the journal check" }).click();
await page.getByText("Chain intact").waitFor({ timeout: 10_000 });
await page.screenshot({ path: `${screens}/11-phone-journal.png`, animations: "disabled" });

await page.goto(`${base}/keys`, { waitUntil: "networkidle" });
await page.getByText("The keys your agents use").waitFor();
await page.screenshot({ path: `${screens}/12-phone-keys.png`, animations: "disabled" });

const size = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
await browser.close();
console.log(`phone viewport ${size.width}x${size.height}`);
