import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { humanClient } from "./demo-shared.ts";
import {
  agentKeyCreatedSchema,
  boundarySchema,
  catalogResponseSchema,
  catalogToolResponseSchema,
  connectorDetailSchema,
  connectorViewSchema,
} from "../packages/shared/src/index.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const base = process.env.GATEWAY_URL ?? "http://127.0.0.1:8787";
const mock = process.env.MOCK_URL ?? "http://127.0.0.1:4001";
// Secured path, so the demo also records vault use without ever exposing the token.
const calendarUrl = `${mock}/calendar-secure/mcp`;

const secretsPath = `${root}/.demo/secrets.json`;
const statePath = `${root}/.demo/agent.json`;

const secrets = await readFile(secretsPath, "utf8")
  .then((text) => JSON.parse(text) as { OWNER_PASSPHRASE: string })
  .catch(() => {
    throw new Error("Run `bun run demo:up` first; .demo/secrets.json is missing.");
  });

const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ passphrase: secrets.OWNER_PASSPHRASE }),
});
if (!login.ok) throw new Error(`owner login failed: ${login.status} ${await login.text()}`);
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (cookie === undefined) throw new Error("owner login did not set a cookie");

const human = humanClient(base, cookie);

console.log("1. Connectors");
const listed = await human(
  z.object({ connectors: z.array(connectorViewSchema) }),
  "/api/connectors",
);
let calendar = listed.connectors.find((row) => row.url === calendarUrl);
if (calendar === undefined) {
  const connected = await human(connectorDetailSchema, "/api/connectors", {
    method: "POST",
    body: JSON.stringify({
      name: "Calendar",
      url: calendarUrl,
      authType: "bearer",
      token: "calendar-demo-token",
    }),
  });
  calendar = connected.connector;
  console.log(`   connected ${calendar.name}: ${connected.summary.total} tools discovered`);
} else {
  console.log(`   ${calendar.name} already connected`);
}

const existingNotion = listed.connectors.find((row) => row.url === "https://mcp.notion.com/mcp");
console.log(
  existingNotion === undefined
    ? "   Notion: not connected yet (do it in the browser for the live demo)"
    : `   Notion: connected (${existingNotion.authStatus})`,
);

console.log("2. Expose only the job's tools");
const catalog = await human(catalogResponseSchema, "/api/catalog");
const exposure: Record<string, boolean> = {
  list_events: true,
  create_event: true,
  delete_event: false,
};
for (const tool of catalog.tools.filter((row) => row.connectorId === calendar.id)) {
  const requestable = exposure[tool.name] ?? false;
  if (tool.requestable === requestable) continue;
  const updated = await human(catalogToolResponseSchema, `/api/catalog/${tool.id}/requestable`, {
    method: "POST",
    body: JSON.stringify({ requestable }),
  });
  console.log(`   ${updated.tool.agentName}: requestable=${updated.tool.requestable}`);
}
for (const tool of catalog.tools.filter((row) => row.connectorId === calendar.id)) {
  console.log(`   ${tool.agentName}: ${tool.class}, requestable=${tool.requestable}`);
}

console.log("3. Agent key");
const issued = await human(agentKeyCreatedSchema, "/api/agent-keys", {
  method: "POST",
  body: JSON.stringify({ name: "Terminal agent" }),
});
console.log(`   issued ${issued.agentKey.name} (shown once, stored as a hash)`);

const boundary = await human(boundarySchema, "/api/boundary");
console.log(
  `4. Boundary: ${boundary.counts.discovered} discovered, ${boundary.counts.visible} the agent may name, ${boundary.counts.hidden} hidden`,
);
for (const tool of boundary.hidden) {
  console.log(`   hidden: ${tool.name} (${tool.reason})`);
}

await Bun.write(
  statePath,
  `${JSON.stringify({ base, key: issued.key, mcpUrl: issued.mcpUrl }, null, 2)}\n`,
);

console.log("");
console.log("  Ready. The agent key is in .demo/agent.json (gitignored).");
console.log("  Rehearse the whole agent pass:");
console.log("    bun run demo:agent -- --auto-approve");
console.log("  Live demo, with a human tap in the Slips screen:");
console.log("    bun run demo:agent");
console.log("");
console.log(`  ${issued.mcpUrl}`);
