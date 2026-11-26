import { afterEach, describe, expect, test } from "bun:test";
import { MOCK_AUTH, MOCK_PATHS, startMockServices } from "../src/server.ts";

let server: ReturnType<typeof startMockServices> | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

describe("mock services HTTP surface", () => {
  test("answers /health", async () => {
    server = startMockServices({ port: 0 });

    const response = await fetch(new URL("/health", server.url));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: "mock-services",
      status: "ok",
    });
  });

  test("answers 404 for an unknown path", async () => {
    server = startMockServices({ port: 0 });

    const response = await fetch(new URL("/nope", server.url));

    expect(response.status).toBe(404);
  });

  test("challenges bearer and custom-header auth", async () => {
    server = startMockServices({ port: 0 });

    const bearer = await fetch(new URL(MOCK_PATHS.calendarSecure, server.url));
    expect(bearer.status).toBe(401);
    expect(bearer.headers.get("www-authenticate")).toContain("Bearer");

    const pay = await fetch(new URL(MOCK_PATHS.pay, server.url));
    expect(pay.status).toBe(401);
    expect(pay.headers.get("www-authenticate")).toContain("ApiKey");
  });

  test("serves legacy SSE behind basic auth and rejects a POST on that URL", async () => {
    server = startMockServices({ port: 0 });
    const basic = `Basic ${Buffer.from(`${MOCK_AUTH.dineOutUser}:${MOCK_AUTH.dineOutPassword}`).toString("base64")}`;
    const sseUrl = new URL(MOCK_PATHS.dineOutSse, server.url);

    const rejected = await fetch(sseUrl, { headers: { authorization: "Basic wrong" } });
    expect(rejected.status).toBe(401);

    const posted = await fetch(sseUrl, { method: "POST", headers: { authorization: basic } });
    expect(posted.status).toBe(405);

    const stream = await fetch(sseUrl, { headers: { authorization: basic } });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body!.getReader();
    const first = await reader.read();
    await reader.cancel();
    expect(new TextDecoder().decode(first.value)).toContain("event: endpoint");
  });
});
