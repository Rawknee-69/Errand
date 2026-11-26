import { describe, expect, test } from "bun:test";
import { createGatewayApp } from "../src/app.ts";

describe("GET /health", () => {
  test("answers and reports the gateway version", async () => {
    const response = await createGatewayApp(undefined, { auth: "disabled" }).request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: "gateway",
      status: "ok",
      version: "0.1.0",
    });
  });
});
