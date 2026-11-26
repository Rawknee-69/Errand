import { chromium } from "playwright-core";

const repo = "C:/Users/Rem/.local/share/opencode/worktree/5e3805/tidy-star";
const screens = `${repo}/docs/proof/19-receipts-trust-journal-keys/screens`;
const executablePath =
  "C:/Users/Rem/AppData/Local/ms-playwright/chromium-1255/chrome-win64/chrome.exe";

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

await page.goto("http://127.0.0.1:5301/receipts", { waitUntil: "networkidle" });
if (await page.getByText("Owner passphrase").count()) {
  await page.locator("input[type=password]").fill("proof-passphrase-19");
  await page.getByRole("button", { name: "Open control panel" }).click();
  await page.waitForURL("**/connect");
}

for (const [path, apiPath, text, filename] of [
  ["/receipts", "**/api/receipts", "Reading receipts…", "22-desktop-receipts-loading.png"],
  ["/trust", "**/api/trust", "Reading the trust ledger…", "23-desktop-trust-loading.png"],
] as const) {
  await page.route(apiPath, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    await route.continue();
  });
  await page.goto(`http://127.0.0.1:5301${path}`, { waitUntil: "domcontentloaded" });
  await page.getByText(text).waitFor();
  await page.screenshot({ path: `${screens}/${filename}`, animations: "disabled" });
  await page.unroute(apiPath);
}

await browser.close();
console.log("loading states captured");
