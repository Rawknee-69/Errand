import { beforeEach, describe, expect, test } from "bun:test";
import { createGatewayApp } from "../../src/app.ts";
import { DEFAULT_OWNER_ID } from "../../src/auth/owner.ts";
import { createMigratedDatabase, type Db } from "../../src/db/client.ts";
import { journal, users } from "../../src/db/schema.ts";
import { VaultKeyring } from "../../src/vault/keyring.ts";

const PASSPHRASE = "correct horse battery staple";
const KEK = "vault-key-material-that-is-long-enough-for-aes";

let now = 1_000_000;
let db: Db;
let app: ReturnType<typeof createGatewayApp>;

function createApp(demoMode = false): ReturnType<typeof createGatewayApp> {
  return createGatewayApp(db, {
    userId: DEFAULT_OWNER_ID,
    keyring: new VaultKeyring(KEK),
    discoverOptions: { allowLocalhostDev: true, timeoutMs: 1_000 },
    auth: {
      passphrase: PASSPHRASE,
      sessionSecret: "j".repeat(32),
      demoMode,
      sessionTtlSeconds: 3_600,
      sessionCookieSecure: true,
      rateLimit: { maxAttempts: 3, windowMs: 60_000 },
      now: () => now,
    },
  });
}

async function login(body: unknown) {
  return app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sessionCookie(response: Response): string {
  return response.headers.get("set-cookie") ?? "";
}

beforeEach(() => {
  now = 1_000_000;
  db = createMigratedDatabase(":memory:");
  app = createApp();
});

describe("login", () => {
  test("rejects an API read without a session", async () => {
    const response = await app.request("/api/connectors");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  test("signs the owner in and sets an httpOnly, secure, same-site cookie", async () => {
    const response = await login({ passphrase: PASSPHRASE });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authenticated: true,
      demoMode: false,
      user: { id: DEFAULT_OWNER_ID, name: DEFAULT_OWNER_ID },
    });
    const cookie = sessionCookie(response);
    expect(cookie).toContain("errand_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain(PASSPHRASE);

    const session = await app.request("/api/auth/session", { headers: { cookie } });
    expect(await session.json()).toMatchObject({ authenticated: true, demoMode: false });
    expect((await app.request("/api/connectors", { headers: { cookie } })).status).toBe(200);
  });

  test("refuses a wrong passphrase and sets no cookie", async () => {
    const response = await login({ passphrase: "the wrong passphrase" });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "invalid_credentials" });
    expect(sessionCookie(response)).toBe("");
  });

  test("rate limits repeated failures, even for the right passphrase", async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      expect((await login({ passphrase: "wrong" })).status).toBe(401);
    }

    const limited = await login({ passphrase: PASSPHRASE });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");

    now += 60_000;
    expect((await login({ passphrase: PASSPHRASE })).status).toBe(200);
  });

  test("clears the session on logout", async () => {
    const cookie = sessionCookie(await login({ passphrase: PASSPHRASE }));

    const response = await app.request("/api/auth/logout", { method: "POST", headers: { cookie } });

    expect(response.status).toBe(200);
    expect(sessionCookie(response)).toContain("errand_session=;");
    expect((await app.request("/api/auth/session", { headers: { cookie } })).status).toBe(200);
  });

  test("rejects a tampered session cookie", async () => {
    const cookie = sessionCookie(await login({ passphrase: PASSPHRASE }));
    const pair = cookie.split(";")[0]!;
    const value = pair.slice(pair.indexOf("=") + 1);
    const index = value.length - 5;
    const flipped = value[index] === "a" ? "b" : "a";
    const tampered = `errand_session=${value.slice(0, index)}${flipped}${value.slice(index + 1)}`;

    const response = await app.request("/api/auth/session", { headers: { cookie: tampered } });

    expect(await response.json()).toMatchObject({ authenticated: false, user: null });
  });
});

describe("demo mode", () => {
  test("is off unless enabled", async () => {
    const response = await login({ demoUser: "Maya" });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "demo_disabled" });
    expect(db.select().from(users).all()).toHaveLength(1);
    expect(db.select().from(journal).all()).toHaveLength(0);
  });

  test("journals each demo login and signs in as the chosen person", async () => {
    app = createApp(true);

    const response = await login({ demoUser: "Maya Chen" });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      authenticated: true,
      demoMode: true,
      user: { id: "demo-maya-chen", name: "Maya Chen" },
    });
    expect(db.select().from(users).all().map((user) => user.id)).toContain("demo-maya-chen");
    const entry = db
      .select()
      .from(journal)
      .all()
      .find((row) => row.eventType === "demo.login");
    expect(entry?.userId).toBe("demo-maya-chen");
    expect(entry?.payload).toContain('"name":"Maya Chen"');
  });

  test("invalidates a demo session when demo mode is turned off", async () => {
    app = createApp(true);
    const cookie = sessionCookie(await login({ demoUser: "Maya" }));
    app = createApp(false);

    const session = await app.request("/api/auth/session", { headers: { cookie } });
    expect(await session.json()).toMatchObject({ authenticated: false, demoMode: false, user: null });
    expect((await app.request("/api/connectors", { headers: { cookie } })).status).toBe(401);
  });

  test("rate limits repeated demo sign-ins", async () => {
    app = createApp(true);

    for (let attempt = 1; attempt <= 3; attempt++) {
      expect((await login({ demoUser: `Guest ${attempt}` })).status).toBe(200);
    }

    expect((await login({ demoUser: "Guest 4" })).status).toBe(429);
  });

  test("keeps demo users scoped to their own connectors", async () => {
    app = createApp(true);
    const mayaCookie = sessionCookie(await login({ demoUser: "Maya" }));
    const samCookie = sessionCookie(await login({ demoUser: "Sam" }));

    const maya = await app.request("/api/connectors", { headers: { cookie: mayaCookie } });
    const sam = await app.request("/api/connectors", { headers: { cookie: samCookie } });

    expect(await maya.json()).toEqual({ connectors: [] });
    expect(await sam.json()).toEqual({ connectors: [] });
    expect(db.select().from(users).all().map((user) => user.id)).toEqual([
      DEFAULT_OWNER_ID,
      "demo-maya",
      "demo-sam",
    ]);
  });
});
