import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const demoDir = join(root, ".demo");
const pidPath = join(demoDir, "demo-up.pid");

const pid = await readFile(pidPath, "utf8")
  .then((text) => Number(text.trim()))
  .catch(() => undefined);

async function free(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) });
    return false;
  } catch {
    return true;
  }
}

if (pid !== undefined && Number.isInteger(pid)) {
  if (process.platform === "win32") {
    await Bun.spawn(["taskkill", "/PID", String(pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
    }).exited;
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
  }
}

await rm(pidPath, { force: true });

const ports = [8787, 5173, 4001];

// A previous crash can leave a port bound without a pid file; clear those too.
async function killPortOwners(): Promise<void> {
  if (process.platform !== "win32") return;
  const proc = Bun.spawn(
    [
      "powershell",
      "-NoProfile",
      "-Command",
      "Get-NetTCPConnection -LocalPort 8787,5173,4001 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique",
    ],
    { stdout: "pipe", stderr: "ignore" },
  );
  const text = await new Response(proc.stdout).text();
  const pids = text
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
  for (const owner of pids) {
    await Bun.spawn(["taskkill", "/PID", String(owner), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
    }).exited;
  }
}

const deadline = Date.now() + 10_000;
for (;;) {
  const states = await Promise.all(ports.map(free));
  if (states.every(Boolean)) break;
  if (Date.now() > deadline - 7_000) await killPortOwners();
  if (Date.now() > deadline) {
    console.error("Some demo ports are still in use: " + ports.filter((_, i) => !states[i]).join(", "));
    process.exit(1);
  }
  await Bun.sleep(200);
}

console.log("Demo stopped. Ports 8787, 5173 and 4001 are free.");
