import { chromium } from "playwright-core";

const base = "http://127.0.0.1:5302";
const repo = "C:/Users/Rem/.local/share/opencode/worktree/5e3805/tidy-star";
const screens = `${repo}/docs/proof/19-receipts-trust-journal-keys/screens`;
const executablePath =
  "C:/Users/Rem/AppData/Local/ms-playwright/chromium-1255/chrome-win64/chrome.exe";

const failure = {
  status: 503,
  contentType: "application/json",
  body: JSON.stringify({ error: "unavailable", message: "This store is unavailable right now." }),
};

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

await page.goto(`${base}/receipts`, { waitUntil: "networkidle" });
if (await page.getByText("Owner passphrase").count()) {
  await page.locator("input[type=password]").fill("proof-passphrase-19");
  await page.getByRole("button", { name: "Open control panel" }).click();
  await page.waitForURL("**/connect");
}

for (const [path, apiPath, filename] of [
  ["/receipts", "**/api/receipts", "18-desktop-receipts-error.png"],
  ["/trust", "**/api/trust", "19-desktop-trust-error.png"],
  ["/keys", "**/api/agent-keys", "20-desktop-keys-error.png"],
] as const) {
  await page.route(apiPath, (route) => route.fulfill(failure));
  await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
  await page.getByText("This store is unavailable right now.").waitFor();
  await page.screenshot({ path: `${screens}/${filename}`, animations: "disabled" });
  await page.unroute(apiPath);
}

await page.route("**/api/journal/verify", (route) => route.fulfill(failure));
await page.goto(`${base}/journal`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Run the journal check" }).click();
await page.getByText("This store is unavailable right now.").waitFor();
await page.screenshot({
  path: `${screens}/21-desktop-journal-error.png`,
  animations: "disabled",
});
await page.unroute("**/api/journal/verify");

await browser.close();
console.log("error states captured");
