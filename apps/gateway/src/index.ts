import { createGatewayApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createMigratedDatabase } from "./db/client.ts";
import { VaultKeyring } from "./vault/keyring.ts";

const config = loadConfig(process.env);
const db = createMigratedDatabase(config.DATABASE_PATH);
const keyring = new VaultKeyring(
  config.VAULT_KEY,
  config.VAULT_KEY_PREVIOUS === undefined ? [] : [config.VAULT_KEY_PREVIOUS],
);
const app = createGatewayApp(db, {
  userId: "owner",
  keyring,
  discover: {
    allowLocalhostDev: config.ALLOW_LOCALHOST_DEV,
    timeoutMs: config.EGRESS_TIMEOUT_MS,
    maxResponseBytes: config.EGRESS_MAX_RESPONSE_BYTES,
  },
  maxConnectors: config.MAX_CONNECTORS_PER_USER,
});
const server = Bun.serve({ port: config.PORT, fetch: app.fetch });

console.log(`gateway listening on ${server.url}`);
