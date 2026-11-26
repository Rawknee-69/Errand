import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { startMockServices } from "@errand/mock-services";
import { z } from "zod";
import { createGatewayApp } from "../../src/app.ts";
import { createMigratedDatabase, type Db } from "../../src/db/client.ts";
import { connectors, credentials, journal, oauthAttempts, users } from "../../src/db/schema.ts";
import { verifyJournal } from "../../src/db/journal.ts";
import { Vault } from "../../src/vault/vault.ts";
import { VaultKeyring } from "../../src/vault/keyring.ts";
import { connectResponseSchema, oauthStartResponseSchema, readJson } from "./support.ts";

const TS = "2026-01-01T00:00:00.000Z";
const KEK = "vault-key-material-that-is-long-enough-for-aes";
const USER = "user-a";
const REDIRECT_URI = "http://127.0.0.1:8787/api/oauth/callback";

const mockStateSchema = z.object({
  registrations: z.number(),
  authorizations: z.number(),
  authorizationCodeGrants: z.number(),
  refreshGrants: z.number(),
  pkceFailures: z.number(),
  refreshRotations: z.number(),
  clients: z.number(),
  accessTokens: z.number(),
  refreshTokens: z.number(),
  alwaysUnauthorized: z.boolean(),
});

const storedSecretSchema = z.object({
  tokens: z
    .object({
      access_token: z.string(),
      refresh_token: z.string().optional(),
    })
    .optional(),
});

type MockState = z.infer<typeof mockStateSchema>;

let server: ReturnType<typeof startMockServices>;
let db: Db;
let keyring: VaultKeyring;
let app: ReturnType<typeof createGatewayApp>;

function baseUrl(): string {
  return `http://127.0.0.1:${server.port}`;
}

function mcpUrl(): string {
  return `${baseUrl()}/oauth/mcp`;
}

async function post(path: string, body: unknown): Promise<Response> {
  return await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function mockState(): Promise<MockState> {
  return mockStateSchema.parse(await (await fetch(`${baseUrl()}/mock/oauth/state`)).json());
}

async function control(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
}

async function storedTokens(connectorId: string) {
  const vault = new Vault(db, keyring, USER);
  return vault.withCredential(connectorId, (secret) => storedSecretSchema.parse(JSON.parse(secret)).tokens);
}

async function startFlow(name = "OAuth calendar") {
  const response = await post("/api/connectors/oauth/start", { name, url: mcpUrl() });
  expect(response.status).toBe(201);
  return readJson(response, oauthStartResponseSchema);
}

async function approve(authorizationUrl: string): Promise<URL> {
  const authorize = new URL(authorizationUrl);
  const page = await fetch(authorize);
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain("<form");

  const response = await fetch(`${authorize.origin}${authorize.pathname}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: authorize.searchParams.toString(),
    redirect: "manual",
  });
  expect(response.status).toBe(302);
  const location = response.headers.get("location");
  expect(location).not.toBeNull();
  return new URL(location ?? "");
}

function callbackPath(callback: URL): string {
  return `/api/oauth/callback${callback.search}`;
}

async function authorizeFlow(name?: string) {
  const started = await startFlow(name);
  const callback = await approve(started.authorizationUrl);
  const response = await app.request(callbackPath(callback));
  return { started, callback, response };
}

beforeAll(() => {
  server = startMockServices({ port: 0 });
});

afterAll(() => {
  server.stop(true);
});

beforeEach(async () => {
  await fetch(`${baseUrl()}/mock/oauth/reset`, { method: "POST" });
  db = createMigratedDatabase(":memory:");
  db.insert(users).values({ id: USER, name: "A", createdAt: TS }).run();
  keyring = new VaultKeyring(KEK);
  app = createGatewayApp(db, {
    userId: USER,
    keyring,
    discoverOptions: { allowLocalhostDev: true, timeoutMs: 5_000 },
    oauthRedirectUri: REDIRECT_URI,
  });
});

describe("OAuth 2.1 + PKCE via the SDK", () => {
  test("discovers, registers, authorizes and catalogues through the browser flow", async () => {
    const { started, callback, response } = await authorizeFlow();

    expect(started.connector.authType).toBe("oauth");
    expect(started.connector.authStatus).toBe("pending");

    const authorizationUrl = new URL(started.authorizationUrl);
    expect(authorizationUrl.pathname).toBe("/oauth/authorize");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect((authorizationUrl.searchParams.get("code_challenge") ?? "").length).toBeGreaterThan(20);
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(authorizationUrl.searchParams.get("state")).toBe(
      db.select().from(oauthAttempts).all()[0]?.state ?? "",
    );

    expect(callback.searchParams.get("code")).not.toBeNull();
    expect(callback.searchParams.get("iss")).toBe(baseUrl());

    expect(response.status).toBe(200);
    const body = await readJson(response, connectResponseSchema);
    expect(body.connector.authStatus).toBe("active");
    expect(body.connector.lastAuthError).toBeNull();
    expect(body.transport).toBe("streamable-http");
    expect(body.summary.new).toBe(3);
    expect(body.tools.some((tool) => tool.agentName === "oauth_calendar__list_events")).toBe(true);

    const state = await mockState();
    expect(state.registrations).toBe(1);
    expect(state.authorizations).toBe(1);
    expect(state.authorizationCodeGrants).toBe(1);
    expect(state.pkceFailures).toBe(0);

    expect(verifyJournal(db).ok).toBe(true);
    const eventTypes = db.select().from(journal).all().map((event) => event.eventType);
    expect(eventTypes).toContain("connector.oauth_started");
    expect(eventTypes).toContain("connector.oauth_authorized");

    const connectorRow = db.select().from(connectors).all()[0];
    expect(connectorRow?.authStatus).toBe("active");
  });

  test("stores the verifier encrypted with a ten-minute lifetime, never in the attempt row", async () => {
    const started = await startFlow();
    const attempt = db.select().from(oauthAttempts).all()[0];
    expect(attempt).toBeDefined();
    expect(Date.parse(attempt?.expiresAt ?? "") - Date.parse(attempt?.createdAt ?? "")).toBe(600_000);

    const attemptCredential = db
      .select()
      .from(credentials)
      .all()
      .find((row) => row.serviceId === `oauth_attempt:${started.attemptId}`);
    expect(attemptCredential).toBeDefined();
    expect(attemptCredential?.kind).toBe("oauth_attempt");
    expect(JSON.stringify(attempt)).not.toContain("codeVerifier");
    expect(JSON.stringify(attempt)).not.toContain("code_verifier");
    expect(JSON.stringify(db.select().from(credentials).all())).not.toContain("codeVerifier");
  });

  test("rejects an unknown, reused or expired state without touching the connector", async () => {
    const { started, callback } = await authorizeFlow();
    expect(started.attemptId).not.toBe("");

    const replay = await app.request(callbackPath(callback));
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error: string }).error).toBe("oauth_state");

    const unknown = await app.request(`/api/oauth/callback?state=nope&code=x`);
    expect(unknown.status).toBe(400);

    expect(db.select().from(connectors).all()[0]?.authStatus).toBe("active");
  });

  test("rejects a callback whose issuer is not the discovered authorization server", async () => {
    const started = await startFlow();
    const callback = await approve(started.authorizationUrl);
    callback.searchParams.set("iss", "https://evil.example");
    const response = await app.request(callbackPath(callback));

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("oauth_issuer");
    expect(db.select().from(connectors).all()[0]?.authStatus).toBe("needs_reauth");
  });

  test("rejects a callback delivered to a different redirect URI than the attempt", async () => {
    const started = await startFlow();
    const callback = await approve(started.authorizationUrl);
    const otherApp = createGatewayApp(db, {
      userId: USER,
      keyring,
      discoverOptions: { allowLocalhostDev: true, timeoutMs: 5_000 },
      oauthRedirectUri: "http://127.0.0.1:8787/api/oauth/other",
    });

    const response = await otherApp.request(callbackPath(callback));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("oauth_state");
  });

  test("refreshes under a per-connector lock and stores the rotated token", async () => {
    const { started, response } = await authorizeFlow();
    expect(response.status).toBe(200);
    const connectorId = started.connector.id;
    const before = await storedTokens(connectorId);

    const first = await post(`/api/connectors/${connectorId}/refresh`, {});
    expect(first.status).toBe(200);
    const after = await storedTokens(connectorId);
    expect(after?.access_token).not.toBe(before?.access_token);
    expect(after?.refresh_token).not.toBe(before?.refresh_token);
    expect((await mockState()).refreshRotations).toBe(1);

    const [a, b] = await Promise.all([
      post(`/api/connectors/${connectorId}/refresh`, {}),
      post(`/api/connectors/${connectorId}/refresh`, {}),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect((await mockState()).refreshRotations).toBe(3);
    expect(db.select().from(connectors).all()[0]?.authStatus).toBe("active");
  });

  test("invalid_grant marks needs_reauth and journals once instead of looping", async () => {
    const { started, response } = await authorizeFlow();
    expect(response.status).toBe(200);
    const connectorId = started.connector.id;
    await control("/mock/oauth/revoke", { refreshTokens: true });

    const refresh = await post(`/api/connectors/${connectorId}/refresh`, {});
    expect(refresh.status).toBe(409);
    expect(((await refresh.json()) as { error: string }).error).toBe("reauth");
    expect(db.select().from(connectors).all()[0]?.authStatus).toBe("needs_reauth");

    const state = await mockState();
    expect(state.refreshGrants).toBe(1);

    const needsReauth = db
      .select()
      .from(journal)
      .all()
      .filter((event) => event.eventType === "connector.needs_reauth");
    expect(needsReauth).toHaveLength(1);

    const again = await post(`/api/connectors/${connectorId}/refresh`, {});
    expect(again.status).toBe(409);
    expect(
      db.select().from(journal).all().filter((event) => event.eventType === "connector.needs_reauth"),
    ).toHaveLength(1);
  });

  test("a repeated 401 after a refresh marks needs_reauth and emits one event", async () => {
    const { started, response } = await authorizeFlow();
    expect(response.status).toBe(200);
    const connectorId = started.connector.id;
    await control("/mock/oauth/always-401", { value: true });

    const refresh = await post(`/api/connectors/${connectorId}/refresh`, {});
    expect(refresh.status).toBe(409);
    expect(db.select().from(connectors).all()[0]?.lastAuthError).toBe("upstream_401");
    expect(
      db.select().from(journal).all().filter((event) => event.eventType === "connector.needs_reauth"),
    ).toHaveLength(1);
  });
});
