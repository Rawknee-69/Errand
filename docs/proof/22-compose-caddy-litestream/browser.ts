import { chromium, type Browser, type Page } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:8088";
const OUT = "docs/proof/22-compose-caddy-litestream";
const PASSPHRASE = process.env.OWNER_PASSPHRASE;
if (!PASSPHRASE) throw new Error("OWNER_PASSPHRASE must be set");

const consoleLines: string[] = [];
const networkLines: string[] = [];

function watch(page: Page, label: string): void {
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleLines.push(`${label} ${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => consoleLines.push(`${label} pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      networkLines.push(`${label} ${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    networkLines.push(`${label} FAILED ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`);
  });
}

async function login(page: Page): Promise<void> {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.locator('input[type="password"]').fill(PASSPHRASE);
  await page.getByRole("button", { name: "Open control panel" }).click();
  await page.getByText("Sign out").waitFor();
  await page.waitForLoadState("networkidle");
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${OUT}/screens/${name}.png`, fullPage: true });
}

const browser: Browser = await chromium.launch();

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();
  watch(page, "desktop");

  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await shoot(page, "01-desktop-login");
  await login(page);
  await shoot(page, "02-desktop-connect");

  await page.goto(`${BASE}/connectors`, { waitUntil: "networkidle" });
  await page.getByText("stack-probe").first().waitFor();
  await shoot(page, "03-desktop-connectors");

  await page.goto(`${BASE}/journal`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Run the journal check" }).click();
  await page.getByText("Verified").waitFor();
  await shoot(page, "04-desktop-journal");

  await page.goto(`${BASE}/slips`, { waitUntil: "networkidle" });
  await shoot(page, "05-desktop-slips");

  await page.locator("button.nav-item", { hasText: "Keys" }).click();
  await page.getByRole("button", { name: "Create agent key" }).waitFor();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phonePage = await phone.newPage();
  watch(phonePage, "phone");
  await phonePage.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await shoot(phonePage, "06-phone-login");
  await login(phonePage);
  await phonePage.goto(`${BASE}/slips`, { waitUntil: "networkidle" });
  await shoot(phonePage, "07-phone-slips");

  await Bun.write(`${OUT}/logs/browser-console.txt`, `${consoleLines.join("\n")}\n`);
  await Bun.write(`${OUT}/logs/browser-network.txt`, `${networkLines.join("\n")}\n`);
  await Bun.write(
    `${OUT}/logs/browser-window.txt`,
    `${JSON.stringify({ base: BASE, desktop: "1440x900", phone: "390x844", consoleLines: consoleLines.length, failedOrErrorResponses: networkLines.length }, null, 2)}\n`,
  );
} finally {
  await browser.close();
}
