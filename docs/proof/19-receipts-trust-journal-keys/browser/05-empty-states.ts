import { chromium } from "playwright-core";

const base = "http://127.0.0.1:5302";
const repo = "C:/Users/Rem/.local/share/opencode/worktree/5e3805/tidy-star";
const screens = `${repo}/docs/proof/19-receipts-trust-journal-keys/screens`;
const executablePath =
  "C:/Users/Rem/AppData/Local/ms-playwright/chromium-1255/chrome-win64/chrome.exe";

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

await page.goto(`${base}/receipts`, { waitUntil: "networkidle" });
if (await page.getByText("Owner passphrase").count()) {
  await page.locator("input[type=password]").fill("proof-passphrase-19");
  await page.getByRole("button", { name: "Open control panel" }).click();
  await page.waitForURL("**/connect");
}

await page.goto(`${base}/receipts`, { waitUntil: "networkidle" });
await page.getByText("No receipts yet").waitFor();
await page.screenshot({
  path: `${screens}/14-desktop-receipts-empty.png`,
  animations: "disabled",
});

await page.goto(`${base}/trust`, { waitUntil: "networkidle" });
await page.getByText("No errand types have run yet").waitFor();
await page.screenshot({
  path: `${screens}/15-desktop-trust-empty.png`,
  animations: "disabled",
});

await page.goto(`${base}/keys`, { waitUntil: "networkidle" });
await page.getByText("No keys yet").waitFor();
await page.screenshot({
  path: `${screens}/16-desktop-keys-empty.png`,
  animations: "disabled",
});

await page.goto(`${base}/journal`, { waitUntil: "networkidle" });
await page.getByText("Nothing is checked until you run it.").waitFor();
await page.screenshot({
  path: `${screens}/17-desktop-journal-initial.png`,
  animations: "disabled",
});

await browser.close();
console.log("empty states captured");
