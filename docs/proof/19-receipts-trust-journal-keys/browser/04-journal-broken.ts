import { chromium } from "playwright-core";

const base = "http://127.0.0.1:5301";
const repo = "C:/Users/Rem/.local/share/opencode/worktree/5e3805/tidy-star";
const screens = `${repo}/docs/proof/19-receipts-trust-journal-keys/screens`;
const executablePath =
  "C:/Users/Rem/AppData/Local/ms-playwright/chromium-1255/chrome-win64/chrome.exe";

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

await page.goto(`${base}/journal`, { waitUntil: "networkidle" });
if (await page.getByText("Owner passphrase").count()) {
  await page.locator("input[type=password]").fill("proof-passphrase-19");
  await page.getByRole("button", { name: "Open control panel" }).click();
  await page.waitForURL("**/connect");
}
await page.goto(`${base}/journal`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Run the journal check" }).click();
const verdict = page.locator(".journal-verdict");
await verdict.getByText("Chain broken at sequence 7").waitFor({ timeout: 10_000 });
await page.screenshot({
  path: `${screens}/13-desktop-journal-broken.png`,
  animations: "disabled",
});
console.log(await verdict.innerText());

await page.route("**/api/journal/verify", (route) =>
  route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "unavailable", message: "This store is unavailable right now." }),
  }),
);
await page.getByRole("button", { name: "Run again" }).click();
await page.getByText("This store is unavailable right now.").waitFor();
const stale = await page.locator(".journal-verdict").count();
if (stale !== 0) throw new Error(`the old verdict survived a failed check (${stale})`);
await page.screenshot({
  path: `${screens}/24-desktop-journal-stale-error.png`,
  animations: "disabled",
});
console.log(`verdict cards after a failed re-check: ${stale}`);
await browser.close();
