import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { startMockServices } from "../src/server.ts";

let server: ReturnType<typeof startMockServices>;

function base(): string {
  return `http://127.0.0.1:${server.port}`;
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function register(redirectUri: string): Promise<string> {
  const response = await fetch(`${base()}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      client_name: "test-client",
      grant_types: ["authorization_code", "refresh_token"],
    }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { client_id: string };
  return body.client_id;
}

async function authorize(clientId: string, redirectUri: string, challenge: string): Promise<URL> {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "state-1",
    scope: "calendar.read",
  });
  const page = await fetch(`${base()}/oauth/authorize?${params.toString()}`);
  expect(page.status).toBe(200);
  expect(await page.text()).toContain("<form");

  const response = await fetch(`${base()}/oauth/authorize`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    redirect: "manual",
  });
  expect(response.status).toBe(302);
  const location = response.headers.get("location");
  expect(location).not.toBeNull();
  return new URL(location ?? "");
}

async function exchange(body: Record<string, string>): Promise<Response> {
  return fetch(`${base()}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
}

beforeAll(() => {
  server = startMockServices({ port: 0 });
});

afterAll(() => {
  server.stop(true);
});

describe("mock authorization server", () => {
  test("advertises RFC 9728 and RFC 8414 metadata", async () => {
    const resource = await fetch(`${base()}/.well-known/oauth-protected-resource/oauth/mcp`);
    expect(resource.status).toBe(200);
    const resourceBody = (await resource.json()) as { resource: string; authorization_servers: string[] };
    expect(resourceBody.resource).toBe(`${base()}/oauth/mcp`);
    expect(resourceBody.authorization_servers).toEqual([base()]);

    const metadata = await fetch(`${base()}/.well-known/oauth-authorization-server`);
    const metadataBody = (await metadata.json()) as {
      issuer: string;
      registration_endpoint: string;
      code_challenge_methods_supported: string[];
    };
    expect(metadataBody.issuer).toBe(base());
    expect(metadataBody.registration_endpoint).toBe(`${base()}/oauth/register`);
    expect(metadataBody.code_challenge_methods_supported).toEqual(["S256"]);
  });

  test("registers a client and refuses an unregistered redirect URI", async () => {
    const clientId = await register("http://127.0.0.1:8787/cb");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: "http://127.0.0.1:9999/other",
      code_challenge: pkce().challenge,
      code_challenge_method: "S256",
    });
    const response = await fetch(`${base()}/oauth/authorize?${params.toString()}`);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("invalid_request");
  });

  test("requires the PKCE verifier, burns the code once and rotates refresh tokens", async () => {
    const redirectUri = "http://127.0.0.1:8787/cb";
    const clientId = await register(redirectUri);
    const { verifier, challenge } = pkce();
    const callback = await authorize(clientId, redirectUri, challenge);
    const code = callback.searchParams.get("code") ?? "";
    expect(callback.searchParams.get("state")).toBe("state-1");
    expect(callback.searchParams.get("iss")).toBe(base());

    const wrong = await exchange({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: "not-the-verifier",
      redirect_uri: redirectUri,
    });
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: string }).error).toBe("invalid_grant");

    const right = await exchange({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });
    expect(right.status).toBe(200);
    const tokens = (await right.json()) as { access_token: string; refresh_token: string };
    expect(tokens.access_token).toStartWith("at_");
    expect(tokens.refresh_token).toStartWith("rt_");

    const replay = await exchange({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error: string }).error).toBe("invalid_grant");

    const refresh = await exchange({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: tokens.refresh_token,
    });
    expect(refresh.status).toBe(200);
    const rotated = (await refresh.json()) as { refresh_token: string };
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);

    const stale = await exchange({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: tokens.refresh_token,
    });
    expect(stale.status).toBe(400);
    expect(((await stale.json()) as { error: string }).error).toBe("invalid_grant");

    const state = (await (await fetch(`${base()}/mock/oauth/state`)).json()) as {
      refreshRotations: number;
      pkceFailures: number;
    };
    expect(state.refreshRotations).toBe(1);
    expect(state.pkceFailures).toBe(1);
  });
});
