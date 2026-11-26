import { afterEach, describe, expect, test } from "bun:test";
import { startMockServices } from "../src/server.ts";

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
});
