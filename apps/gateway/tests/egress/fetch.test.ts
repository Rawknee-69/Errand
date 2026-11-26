import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { egressFetch, EgressRefusal } from "../../src/egress/guard.ts";

const hits: string[] = [];
let server: ReturnType<typeof Bun.serve>;
let base = "";

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const { pathname } = new URL(request.url);
      hits.push(pathname);

      if (pathname === "/ok" || pathname === "/final") {
        return new Response("hello from upstream");
      }
      if (pathname.startsWith("/hop/") || pathname.startsWith("/far/")) {
        const [, kind, step] = pathname.split("/");
        const next = Number(step) + 1;
        const last = kind === "hop" ? 3 : 4;
        if (next <= last) {
          return new Response(null, { status: 302, headers: { location: `/${kind}/${next}` } });
        }
        return new Response("done");
      }
      if (pathname === "/relative") {
        return new Response(null, { status: 301, headers: { location: "/ok" } });
      }
      if (pathname === "/redirect-metadata") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/latest/meta-data" },
        });
      }
      if (pathname === "/redirect-private") {
        return new Response(null, { status: 307, headers: { location: "https://10.255.255.1/" } });
      }
      if (pathname === "/redirect-file") {
        return new Response(null, { status: 302, headers: { location: "file:///etc/passwd" } });
      }
      if (pathname === "/no-location") {
        return new Response(null, { status: 302 });
      }
      if (pathname === "/large-declared") {
        return new Response("x".repeat(4096));
      }
      if (pathname === "/large-stream") {
        return new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new TextEncoder().encode("x".repeat(512)));
            },
          }),
        );
      }
      if (pathname === "/small-stream") {
        return new Response(
          new ReadableStream({
            start(controller) {
              for (let index = 0; index < 4; index++) {
                controller.enqueue(new TextEncoder().encode("x".repeat(512)));
              }
              controller.close();
            },
          }),
        );
      }
      if (pathname === "/slow") {
        return Bun.sleep(250).then(() => new Response("late"));
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

async function refusal(promise: Promise<unknown>): Promise<EgressRefusal> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EgressRefusal) return error;
    throw error;
  }
  throw new Error("expected an EgressRefusal");
}

describe("egressFetch", () => {
  test("fetches a local dev server and returns its body", async () => {
    const response = await egressFetch(`${base}/ok`, dev);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello from upstream");
  });

  test("refuses a plain http local URL when the dev flag is off", async () => {
    const error = await refusal(egressFetch(`${base}/ok`, {}));
    expect(error.code).toBe("scheme");
  });

  test("follows a relative redirect after re-validating it", async () => {
    const response = await egressFetch(`${base}/relative`, dev);
    expect(await response.text()).toBe("hello from upstream");
    expect(hits).toContain("/relative");
  });

  test("allows exactly three redirects", async () => {
    const response = await egressFetch(`${base}/hop/0`, dev);
    expect(await response.text()).toBe("done");
  });

  test("refuses a fourth redirect", async () => {
    const error = await refusal(egressFetch(`${base}/far/0`, dev));
    expect(error.code).toBe("redirect-limit");
  });

  test("refuses a redirect to the cloud metadata address and never requests it", async () => {
    const error = await refusal(egressFetch(`${base}/redirect-metadata`, dev));
    expect(error.code).toBe("blocked-address");
    expect(error.message).toContain("169.254.169.254");
    expect(hits).not.toContain("/latest/meta-data");
  });

  test("refuses a redirect into a private range", async () => {
    const error = await refusal(egressFetch(`${base}/redirect-private`, dev));
    expect(error.code).toBe("blocked-address");
    expect(error.message).toContain("10.255.255.1");
  });

  test("refuses a redirect to a non-http scheme", async () => {
    const error = await refusal(egressFetch(`${base}/redirect-file`, dev));
    expect(error.code).toBe("scheme");
  });

  test("refuses a redirect without a location", async () => {
    const error = await refusal(egressFetch(`${base}/no-location`, dev));
    expect(error.code).toBe("redirect-without-location");
  });

  test("refuses a declared response larger than the cap", async () => {
    const error = await refusal(egressFetch(`${base}/large-declared`, { ...dev, maxResponseBytes: 1024 }));
    expect(error.code).toBe("response-too-large");
  });

  test("stops a streamed response that grows past the cap", async () => {
    const response = await egressFetch(`${base}/large-stream`, { ...dev, maxResponseBytes: 4096 });
    const error = await refusal(response.text());
    expect(error.code).toBe("response-too-large");
  });

  test("reads a streamed response under the cap", async () => {
    const response = await egressFetch(`${base}/small-stream`, { ...dev, maxResponseBytes: 4096 });
    expect((await response.arrayBuffer()).byteLength).toBe(2048);
  });

  test("refuses a server that outlasts the timeout", async () => {
    const error = await refusal(egressFetch(`${base}/slow`, { ...dev, timeoutMs: 50 }));
    expect(error.code).toBe("timeout");
  });
});
