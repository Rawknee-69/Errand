import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { egressRequest } from "../../src/egress/guard.ts";
import { egressRefusal as refusal } from "../support/refusals.ts";

let server: ReturnType<typeof Bun.serve>;
let base = "";

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === "/echo") {
        return Response.json({
          method: request.method,
          authorization: request.headers.get("authorization"),
          apiKey: request.headers.get("x-api-key"),
          body: await request.text(),
        });
      }
      if (pathname === "/see-other") {
        return new Response(null, { status: 303, headers: { location: "/echo" } });
      }
      if (pathname === "/temporary") {
        return new Response(null, { status: 307, headers: { location: "/echo" } });
      }
      if (pathname === "/stream") {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("event: message\n"));
              controller.enqueue(new TextEncoder().encode("data: hello\n\n"));
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      if (pathname === "/redirect-metadata") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/latest/meta-data" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

const dev = { allowLocalhostDev: true };

describe("egressRequest", () => {
  test("sends a POST body and caller headers through the guard", async () => {
    const response = await egressRequest(
      `${base}/echo`,
      {
        method: "POST",
        headers: { authorization: "Bearer secret-token", "x-api-key": "header-secret" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "initialize" }),
      },
      dev,
    );

    expect(await response.json()).toEqual({
      method: "POST",
      authorization: "Bearer secret-token",
      apiKey: "header-secret",
      body: '{"jsonrpc":"2.0","method":"initialize"}',
    });
  });

  test("follows a 303 redirect as a bodyless GET", async () => {
    const response = await egressRequest(
      `${base}/see-other`,
      { method: "POST", body: "payload" },
      dev,
    );

    const echoed = (await response.json()) as { method: string; body: string };
    expect(echoed.method).toBe("GET");
    expect(echoed.body).toBe("");
  });

  test("replays the method and body on a 307 redirect", async () => {
    const response = await egressRequest(
      `${base}/temporary`,
      { method: "POST", body: "payload" },
      dev,
    );

    const echoed = (await response.json()) as { method: string; body: string };
    expect(echoed.method).toBe("POST");
    expect(echoed.body).toBe("payload");
  });

  test("returns a streaming response without buffering it", async () => {
    const response = await egressRequest(`${base}/stream`, { method: "GET" }, dev);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(await response.text()).toBe("event: message\ndata: hello\n\n");
  });

  test("re-validates a redirect before following it", async () => {
    const error = await refusal(egressRequest(`${base}/redirect-metadata`, { method: "GET" }, dev));
    expect(error.code).toBe("blocked-address");
  });

  test("honours a caller abort signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      egressRequest(`${base}/echo`, { method: "GET", signal: controller.signal }, dev),
    ).rejects.toBeDefined();
  });
});
