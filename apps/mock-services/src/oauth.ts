import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// A real authorization server, small enough to read: RFC 9728 discovery,
// RFC 8414 metadata, RFC 7591 dynamic registration, Authorization Code + PKCE
// (S256), RFC 9207 issuer response, and rotating refresh tokens.

export const MOCK_OAUTH_PATHS = {
  resource: "/oauth/mcp",
  authorization: "/oauth/authorize",
  token: "/oauth/token",
  registration: "/oauth/register",
  resourceMetadata: "/.well-known/oauth-protected-resource/oauth/mcp",
  authorizationMetadata: "/.well-known/oauth-authorization-server",
  revoke: "/mock/oauth/revoke",
  reset: "/mock/oauth/reset",
  state: "/mock/oauth/state",
  alwaysUnauthorized: "/mock/oauth/always-401",
} as const;

export const MOCK_OAUTH_SCOPE = "calendar.read";

type Client = {
  clientId: string;
  redirectUris: string[];
  clientName: string;
};

type AuthorizationCode = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  expiresAt: number;
  used: boolean;
};

type AccessToken = {
  clientId: string;
  refreshToken: string;
};

type RefreshToken = {
  clientId: string;
  generation: number;
};

type Counters = {
  registrations: number;
  authorizations: number;
  authorizationCodeGrants: number;
  refreshGrants: number;
  pkceFailures: number;
  refreshRotations: number;
};

const registrationSchema = z.object({
  redirect_uris: z.array(z.url()).min(1),
  client_name: z.string().max(120).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

const tokenRequestSchema = z.object({
  grant_type: z.string(),
  client_id: z.string().optional(),
  code: z.string().optional(),
  code_verifier: z.string().optional(),
  redirect_uri: z.string().optional(),
  refresh_token: z.string().optional(),
});

const controlSchema = z.object({ value: z.boolean() });

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function oauthError(error: string, description: string): Response {
  return json({ error, error_description: description }, 400);
}

function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function pkceMatches(verifier: string, challenge: string): boolean {
  const actual = Buffer.from(base64url(createHash("sha256").update(verifier).digest()));
  const expected = Buffer.from(challenge);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function consentPage(url: URL, clientName: string, scope: string): Response {
  const hidden = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "resource"]
    .map((name) => {
      const value = url.searchParams.get(name);
      if (value === null) return "";
      return `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
    })
    .join("\n");

  const body = `<!doctype html>
<meta charset="utf-8">
<title>Authorize Errand</title>
<body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto">
  <h1>Authorize ${escapeHtml(clientName)}</h1>
  <p>Errand is asking to read your calendar.</p>
  <p><strong>Scope:</strong> ${escapeHtml(scope)}</p>
  <form method="post" action="${escapeHtml(url.pathname)}">
    ${hidden}
    <button type="submit" style="padding: .6rem 1.2rem">Approve</button>
  </form>
</body>`;

  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export function createMockAuthorizationServer() {
  const clients = new Map<string, Client>();
  const codes = new Map<string, AuthorizationCode>();
  const accessTokens = new Map<string, AccessToken>();
  const refreshTokens = new Map<string, RefreshToken>();
  const counters: Counters = {
    registrations: 0,
    authorizations: 0,
    authorizationCodeGrants: 0,
    refreshGrants: 0,
    pkceFailures: 0,
    refreshRotations: 0,
  };
  let alwaysUnauthorized = false;

  function issueTokens(clientId: string, scope: string, generation = 1): Response {
    const accessToken = `at_${base64url(randomBytes(24))}`;
    const refreshToken = `rt_${base64url(randomBytes(24))}`;
    accessTokens.set(accessToken, { clientId, refreshToken });
    refreshTokens.set(refreshToken, { clientId, generation });
    return json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshToken,
      scope,
    });
  }

  function clientIdFrom(request: Request, form: URLSearchParams | undefined): string | undefined {
    const direct = form?.get("client_id") ?? undefined;
    if (direct !== undefined) return direct;
    const header = request.headers.get("authorization");
    const encoded = header?.match(/^Basic (.+)$/i)?.[1];
    if (encoded === undefined) return undefined;
    return Buffer.from(encoded, "base64").toString("utf8").split(":")[0];
  }

  async function register(request: Request): Promise<Response> {
    const parsed = registrationSchema.safeParse(await request.json());
    if (!parsed.success) return oauthError("invalid_client_metadata", "redirect_uris are required");
    const clientId = `client_${randomUUID()}`;
    clients.set(clientId, {
      clientId,
      redirectUris: parsed.data.redirect_uris,
      clientName: parsed.data.client_name ?? "client",
    });
    counters.registrations += 1;
    return json(
      {
        client_id: clientId,
        redirect_uris: parsed.data.redirect_uris,
        client_name: parsed.data.client_name,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      201,
    );
  }

  function authorize(request: Request, base: URL, form: URLSearchParams): Response {
    const clientId = form.get("client_id") ?? "";
    const redirectUri = form.get("redirect_uri") ?? "";
    const client = clients.get(clientId);
    if (client === undefined) return oauthError("invalid_client", "unknown client");
    const registered = client.redirectUris.some((uri) => uri === redirectUri);
    if (!registered) return oauthError("invalid_request", "redirect_uri is not registered exactly");

    if (form.get("response_type") !== "code") return oauthError("unsupported_response_type", "code only");
    const challenge = form.get("code_challenge");
    if (challenge === null || challenge === "") return oauthError("invalid_request", "PKCE is required");
    if (form.get("code_challenge_method") !== "S256") return oauthError("invalid_request", "S256 only");

    if (request.method === "GET") {
      return consentPage(new URL(request.url), client.clientName, form.get("scope") ?? MOCK_OAUTH_SCOPE);
    }

    const code = base64url(randomBytes(24));
    codes.set(code, {
      clientId,
      redirectUri,
      codeChallenge: challenge,
      scope: form.get("scope") ?? MOCK_OAUTH_SCOPE,
      expiresAt: Date.now() + 60_000,
      used: false,
    });
    counters.authorizations += 1;

    const callback = new URL(redirectUri);
    callback.searchParams.set("code", code);
    const state = form.get("state");
    if (state !== null) callback.searchParams.set("state", state);
    callback.searchParams.set("iss", base.origin);
    return new Response(null, { status: 302, headers: { location: callback.href, "cache-control": "no-store" } });
  }

  async function token(request: Request): Promise<Response> {
    const form = new URLSearchParams(await request.text());
    const parsed = tokenRequestSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return oauthError("invalid_request", "malformed token request");
    const body = parsed.data;
    const clientId = clientIdFrom(request, form);
    if (clientId === undefined || clients.get(clientId) === undefined) {
      return oauthError("invalid_client", "unknown client");
    }

    if (body.grant_type === "authorization_code") {
      counters.authorizationCodeGrants += 1;
      const code = body.code === undefined ? undefined : codes.get(body.code);
      if (code === undefined || code.used || code.expiresAt < Date.now()) {
        return oauthError("invalid_grant", "authorization code is invalid or already used");
      }
      if (code.clientId !== clientId) return oauthError("invalid_grant", "code was issued to another client");
      if (body.redirect_uri !== code.redirectUri) {
        return oauthError("invalid_grant", "redirect_uri does not match the authorization request");
      }
      if (body.code_verifier === undefined || !pkceMatches(body.code_verifier, code.codeChallenge)) {
        counters.pkceFailures += 1;
        return oauthError("invalid_grant", "PKCE verifier does not match the challenge");
      }
      code.used = true;
      codes.delete(body.code ?? "");
      return issueTokens(clientId, code.scope);
    }

    if (body.grant_type === "refresh_token") {
      counters.refreshGrants += 1;
      const current = body.refresh_token === undefined ? undefined : refreshTokens.get(body.refresh_token);
      if (current === undefined || current.clientId !== clientId) {
        return oauthError("invalid_grant", "refresh token is invalid, rotated or revoked");
      }
      refreshTokens.delete(body.refresh_token ?? "");
      counters.refreshRotations += 1;
      return issueTokens(clientId, MOCK_OAUTH_SCOPE, current.generation + 1);
    }

    return oauthError("unsupported_grant_type", "authorization_code and refresh_token only");
  }

  function unauthorized(base: URL, detail: string): Response {
    return new Response(detail, {
      status: 401,
      headers: {
        "www-authenticate": `Bearer realm="mock", resource_metadata="${base.origin}${MOCK_OAUTH_PATHS.resourceMetadata}"`,
      },
    });
  }

  // Returns undefined for paths this server does not own, so the caller can
  // fall through to the other mock services.
  async function fetch(request: Request, authorizedMcp: (request: Request) => Promise<Response>): Promise<Response | undefined> {
    const url = new URL(request.url);
    const base = new URL(url.origin);
    const { pathname } = url;

    if (pathname === MOCK_OAUTH_PATHS.resourceMetadata || pathname === "/.well-known/oauth-protected-resource") {
      return json({
        resource: `${base.origin}${MOCK_OAUTH_PATHS.resource}`,
        authorization_servers: [base.origin],
        scopes_supported: [MOCK_OAUTH_SCOPE],
        bearer_methods_supported: ["header"],
      });
    }
    if (pathname === MOCK_OAUTH_PATHS.authorizationMetadata) {
      return json({
        issuer: base.origin,
        authorization_endpoint: `${base.origin}${MOCK_OAUTH_PATHS.authorization}`,
        token_endpoint: `${base.origin}${MOCK_OAUTH_PATHS.token}`,
        registration_endpoint: `${base.origin}${MOCK_OAUTH_PATHS.registration}`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        authorization_response_iss_parameter_supported: true,
        scopes_supported: [MOCK_OAUTH_SCOPE],
      });
    }
    if (pathname === MOCK_OAUTH_PATHS.registration && request.method === "POST") {
      return register(request);
    }
    if (pathname === MOCK_OAUTH_PATHS.authorization && (request.method === "GET" || request.method === "POST")) {
      const form =
        request.method === "GET" ? url.searchParams : new URLSearchParams(await request.text());
      return authorize(request, base, form);
    }
    if (pathname === MOCK_OAUTH_PATHS.token && request.method === "POST") {
      return token(request);
    }
    if (pathname === MOCK_OAUTH_PATHS.resource) {
      const header = request.headers.get("authorization") ?? "";
      const token = header.match(/^Bearer (.+)$/i)?.[1];
      if (alwaysUnauthorized || token === undefined || !accessTokens.has(token)) {
        return unauthorized(base, "invalid or missing access token");
      }
      return authorizedMcp(request);
    }

    if (pathname === MOCK_OAUTH_PATHS.revoke && request.method === "POST") {
      const body = z.object({ accessTokens: z.boolean().optional(), refreshTokens: z.boolean().optional() }).safeParse(await request.json());
      if (!body.success) return json({ error: "invalid_body" }, 400);
      if (body.data.accessTokens === true) accessTokens.clear();
      if (body.data.refreshTokens === true) refreshTokens.clear();
      return json({ ok: true });
    }
    if (pathname === MOCK_OAUTH_PATHS.alwaysUnauthorized && request.method === "POST") {
      const body = controlSchema.safeParse(await request.json());
      if (!body.success) return json({ error: "invalid_body" }, 400);
      alwaysUnauthorized = body.data.value;
      return json({ ok: true });
    }
    if (pathname === MOCK_OAUTH_PATHS.state) {
      return json({
        ...counters,
        clients: clients.size,
        accessTokens: accessTokens.size,
        refreshTokens: refreshTokens.size,
        alwaysUnauthorized,
      });
    }
    if (pathname === MOCK_OAUTH_PATHS.reset && request.method === "POST") {
      clients.clear();
      codes.clear();
      accessTokens.clear();
      refreshTokens.clear();
      alwaysUnauthorized = false;
      for (const key of Object.keys(counters) as Array<keyof Counters>) counters[key] = 0;
      return json({ ok: true });
    }

    return undefined;
  }

  return { fetch };
}
