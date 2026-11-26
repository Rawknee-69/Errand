import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWebServer, readWebConfig, type WebServer } from "../src/serve.ts";

let root: string;
let server: WebServer;

const get = (path: string) => server.fetch(new Request(`http://web.test${path}`));

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "errand-web-"));
  await mkdir(join(root, "assets"), { recursive: true });
  await Bun.write(join(root, "index.html"), '<!doctype html><div id="root"></div>');
  await Bun.write(join(root, "assets", "app-abc123.js"), "console.log('built');");
  server = createWebServer(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("web config", () => {
  test("defaults the port and derives the build directory", () => {
    const config = readWebConfig({});

    expect(config.port).toBe(3000);
    expect(config.root.replaceAll("\\", "/")).toEndWith("apps/web/dist");
  });

  test("rejects a port that is not a whole number in range", () => {
    expect(() => readWebConfig({ WEB_PORT: "abc" })).toThrow(/WEB_PORT/);
    expect(() => readWebConfig({ WEB_PORT: "70000" })).toThrow(/WEB_PORT/);
  });
});

describe("web server", () => {
  test("serves the SPA shell for an unknown route", async () => {
    const response = await get("/slips");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('id="root"');
    expect(response.headers.get("cache-control")).toBe("no-cache");
  });

  test("serves a built asset with an immutable cache", async () => {
    const response = await get("/assets/app-abc123.js");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("console.log('built')");
    expect(response.headers.get("content-type")).toContain("javascript");
    expect(response.headers.get("cache-control")).toContain("immutable");
  });

  test("HEAD reports the same metadata as GET without a body", async () => {
    const response = await server.fetch(
      new Request("http://web.test/assets/app-abc123.js", { method: "HEAD" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    expect(response.headers.get("content-length")).toBe(String("console.log('built');".length));
    expect(await response.text()).toBe("");
  });

  test("a missing asset is a 404, not the SPA shell", async () => {
    const response = await get("/assets/missing.js");

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('id="root"');
  });

  test("an encoded path outside the build root is a 404", async () => {
    expect((await get("/%2e%2e/package.json")).status).toBe(404);
    expect((await get("/..%2fpackage.json")).status).toBe(404);
  });

  test("rejects methods that would imply a write", async () => {
    const response = await server.fetch(new Request("http://web.test/", { method: "POST" }));

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });
});
