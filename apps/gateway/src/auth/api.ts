import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { loginRequestSchema, type SessionView } from "@errand/shared";
import type { Db } from "../db/client.ts";
import { recordEvent } from "../db/events.ts";
import { users } from "../db/schema.ts";
import { getUser } from "../db/scoped-reads.ts";
import { DEFAULT_OWNER_ID } from "./owner.ts";
import { passphraseMatches } from "./passphrase.ts";
import { DEFAULT_RATE_LIMIT, LoginRateLimiter, type RateLimitOptions } from "./rate-limit.ts";
import { issueSession, readSession, SESSION_COOKIE, type SessionClaims } from "./session.ts";

export type GatewayEnv = {
  Variables: {
    session: SessionClaims | undefined;
  };
};

export type AuthOptions = {
  passphrase: string;
  sessionSecret: string;
  demoMode: boolean;
  sessionTtlSeconds?: number;
  sessionCookieSecure?: boolean;
  rateLimit?: RateLimitOptions;
  now?: () => number;
};

type AuthDeps = {
  db: Db;
  options: AuthOptions;
  limiter: LoginRateLimiter;
  now: () => number;
};

function sessionView(deps: AuthDeps, claims: SessionClaims | undefined): SessionView {
  const user = claims === undefined ? undefined : getUser(deps.db, claims.userId);
  if (user === undefined) {
    return { authenticated: false, demoMode: deps.options.demoMode, user: null };
  }
  return {
    authenticated: true,
    demoMode: deps.options.demoMode,
    user: { id: user.id, name: user.name },
  };
}

function demoUserId(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `demo-${slug}`;
}

function sessionCookieOptions(deps: AuthDeps) {
  return {
    httpOnly: true,
    secure: deps.options.sessionCookieSecure ?? true,
    sameSite: "Lax" as const,
    path: "/",
    maxAge: deps.options.sessionTtlSeconds ?? 12 * 60 * 60,
  };
}

async function currentClaims(deps: AuthDeps, c: Context<GatewayEnv>): Promise<SessionClaims | undefined> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token === undefined) return undefined;
  const claims = await readSession(deps.options.sessionSecret, token, deps.now());
  if (claims === undefined || (claims.demo && !deps.options.demoMode)) return undefined;
  return getUser(deps.db, claims.userId) === undefined ? undefined : claims;
}

async function signIn(c: Context<GatewayEnv>, deps: AuthDeps, claims: SessionClaims): Promise<Response> {
  const token = await issueSession(
    deps.options.sessionSecret,
    claims,
    deps.options.sessionTtlSeconds ?? 12 * 60 * 60,
    deps.now(),
  );
  setCookie(c, SESSION_COOKIE, token, sessionCookieOptions(deps));
  return c.json(sessionView(deps, claims));
}

function rateLimited(c: Context<GatewayEnv>, retryAfter: number): Response {
  return c.json(
    { error: "rate_limited", message: `Try again in ${retryAfter} seconds` },
    429,
    { "retry-after": String(retryAfter) },
  );
}

async function login(c: Context<GatewayEnv>, deps: AuthDeps): Promise<Response> {
  const body = loginRequestSchema.parse(await c.req.json());

  if (body.demoUser !== undefined && !deps.options.demoMode) {
    return c.json({ error: "demo_disabled", message: "Demo mode is not enabled" }, 403);
  }

  const retryAfter = deps.limiter.retryAfterSeconds();
  if (retryAfter !== undefined) return rateLimited(c, retryAfter);

  if (body.demoUser !== undefined) {
    const id = demoUserId(body.demoUser);
    if (id === "demo-") {
      return c.json({ error: "invalid_request", message: "Choose a name with letters or digits" }, 400);
    }
    if (getUser(deps.db, id) === undefined) {
      deps.db
        .insert(users)
        .values({ id, name: body.demoUser, createdAt: new Date(deps.now()).toISOString() })
        .run();
    }
    deps.limiter.recordAttempt();
    recordEvent(deps.db, {
      userId: id,
      eventType: "demo.login",
      payload: { user_id: id, name: body.demoUser },
    });
    return signIn(c, deps, { userId: id, demo: true });
  }

  if (!passphraseMatches(deps.options.passphrase, body.passphrase ?? "")) {
    deps.limiter.recordAttempt();
    return c.json({ error: "invalid_credentials", message: "That passphrase is not correct" }, 401);
  }
  deps.limiter.reset();
  const owner = getUser(deps.db, DEFAULT_OWNER_ID);
  if (owner === undefined) throw new Error("The owner user is missing");
  return signIn(c, deps, { userId: owner.id, demo: false });
}

export function registerAuth(app: Hono<GatewayEnv>, db: Db, options: AuthOptions): void {
  const now = options.now ?? Date.now;
  const deps: AuthDeps = {
    db,
    options,
    limiter: new LoginRateLimiter(options.rateLimit ?? DEFAULT_RATE_LIMIT, now),
    now,
  };

  app.use("/api/*", async (c, next) => {
    if (c.req.path.startsWith("/api/auth/")) return next();
    const claims = await currentClaims(deps, c);
    if (claims === undefined) {
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
      return c.json({ error: "unauthenticated" }, 401);
    }
    c.set("session", claims);
    await next();
  });

  app.get("/api/auth/session", async (c) => {
    const claims = await currentClaims(deps, c);
    if (claims === undefined) deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json(sessionView(deps, claims));
  });

  app.post("/api/auth/login", (c) => login(c, deps));

  app.post("/api/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });
}

export function requestUserId(c: Context<GatewayEnv>, fallback: string): string {
  return c.get("session")?.userId ?? fallback;
}
