import { createGatewayApp, DEFAULT_OAUTH_REDIRECT_URI, DEFAULT_OWNER_ID } from "./app.ts";
import { GATEWAY_IDLE_TIMEOUT_SECONDS, loadConfig } from "./config.ts";
import { createMigratedDatabase } from "./db/client.ts";
import { VaultKeyring } from "./vault/keyring.ts";

const config = loadConfig(process.env);
const db = createMigratedDatabase(config.DATABASE_PATH);
const keyring = new VaultKeyring(
  config.VAULT_KEY,
  config.VAULT_KEY_PREVIOUS === undefined ? [] : [config.VAULT_KEY_PREVIOUS],
);
const app = createGatewayApp(db, {
  userId: DEFAULT_OWNER_ID,
  keyring,
  discoverOptions: {
    allowLocalhostDev: config.ALLOW_LOCALHOST_DEV,
    timeoutMs: config.EGRESS_TIMEOUT_MS,
    maxResponseBytes: config.EGRESS_MAX_RESPONSE_BYTES,
  },
  maxConnectors: config.MAX_CONNECTORS_PER_USER,
  oauthRedirectUri: config.OAUTH_REDIRECT_URI ?? DEFAULT_OAUTH_REDIRECT_URI,
  ...(config.WEB_ORIGIN === undefined ? {} : { webOrigin: config.WEB_ORIGIN }),
  hmacKey: config.HMAC_KEY,
  callTimeoutMs: config.CALL_TIMEOUT_MS,
  connectorConcurrency: config.CONNECTOR_CONCURRENCY,
  outboxReleaseIntervalMs: 1_000,
  auth: {
    passphrase: config.OWNER_PASSPHRASE,
    sessionSecret: config.JWT_SECRET,
    demoMode: config.DEMO_MODE,
    sessionTtlSeconds: config.SESSION_TTL_HOURS * 60 * 60,
    sessionCookieSecure: config.SESSION_COOKIE_SECURE,
  },
});
const server = Bun.serve({
  port: config.PORT,
  fetch: app.fetch,
  idleTimeout: GATEWAY_IDLE_TIMEOUT_SECONDS,
});

console.log(`gateway listening on ${server.url}`);
