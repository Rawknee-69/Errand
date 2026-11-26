import { afterEach, describe, expect, test } from "bun:test";
import { createGatewayApp } from "../../src/app.ts";
import { appendJournalEvent } from "../../src/db/journal.ts";
import { calls, connectors, journal, receipts, slips, tools } from "../../src/db/schema.ts";
import { openSse, readSseUntil } from "../support/sse.ts";
import { SEEDED_SECRET, TS, vaultFixture } from "./support.ts";

const SECRET = `${SEEDED_SECRET}-leak-proof`;

function captureConsole(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const methods = ["log", "info", "warn", "error"] as const;
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  const record = (...args: unknown[]): void => {
    lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  };
  for (const method of methods) console[method] = record;
  return {
    lines,
    restore: () => {
      for (const method of methods) console[method] = original[method];
    },
  };
}

// An SSE route never completes; read one replay frame, then hang up.
async function readSseSample(response: Response, timeoutMs = 500): Promise<string> {
  const sse = openSse(response);
  try {
    return await readSseUntil(sse, (text) => text.includes("event: feed"), timeoutMs);
  } finally {
    await sse.cancel();
  }
}

describe("vault leak boundary", () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  test("a seeded secret never appears in responses, journal, receipts, tools, logs or stored rows", async () => {
    const fixture = vaultFixture();
    fixture.db.insert(connectors)
      .values({ id: "conn", userId: "user-a", name: "Notion", url: "https://notion.example/mcp", transport: "streamable-http", authType: "bearer", createdAt: TS, updatedAt: TS })
      .run();
    fixture.store.store({ serviceId: "notion", kind: "api_key", secret: SECRET, connectorId: "conn" });

    let forwardedAuthorization = "";
    const upstream = Bun.serve({
      port: 0,
      fetch(request) {
        forwardedAuthorization = request.headers.get("authorization") ?? "";
        return new Response("ok");
      },
    });
    const captured = captureConsole();
    restore = captured.restore;

    const artifacts: Record<string, string> = {};
    try {
      await fixture.vault.withCredential("notion", async (secret) => {
        await fetch(upstream.url, { headers: { authorization: `Bearer ${secret}` } });
      });

      fixture.db.insert(slips)
        .values({ id: "slip", userId: "user-a", errandType: "calendar", state: "approved", tier: "learner", expiresAt: TS, createdAt: TS, updatedAt: TS })
        .run();
      fixture.db.insert(calls)
        .values({ id: "call", userId: "user-a", slipId: "slip", connectorId: "conn", tool: "notion__search", createdAt: TS })
        .run();
      fixture.db.insert(receipts)
        .values({ id: "receipt", userId: "user-a", slipId: "slip", callId: "call", errandType: "calendar", verification: "unverified", summary: "Searched Notion", createdAt: TS })
        .run();
      fixture.db.insert(tools)
        .values({ id: "tool", userId: "user-a", connectorId: "conn", name: "notion__search", definitionHash: "h", createdAt: TS, updatedAt: TS })
        .run();
      appendJournalEvent(fixture.db, {
        userId: "user-a",
        eventType: "call.forwarded",
        payload: { tool: "notion__search", serviceId: "notion", status: 200 },
      });

      const app = createGatewayApp(fixture.db, { auth: "disabled", userId: "user-a" });
      for (const route of app.routes.filter((candidate) => candidate.method === "GET")) {
        const response = await app.request(route.path);
        const streaming = (response.headers.get("content-type") ?? "").includes("text/event-stream");
        const text = streaming ? await readSseSample(response) : await response.text();
        artifacts[`response ${route.path}`] = `${response.status} ${text}`;
      }

      artifacts["journal payloads"] = JSON.stringify(fixture.db.select().from(journal).all());
      artifacts["receipts"] = JSON.stringify(fixture.db.select().from(receipts).all());
      artifacts["tools"] = JSON.stringify(fixture.db.select().from(tools).all());
      artifacts["stored credential rows"] = JSON.stringify(fixture.db.$client.query("SELECT * FROM credentials").all());
    } finally {
      upstream.stop(true);
    }

    expect(forwardedAuthorization).toBe(`Bearer ${SECRET}`);

    artifacts["captured logs"] = captured.lines.join("\n");
    for (const [name, text] of Object.entries(artifacts)) {
      expect(text, `secret leaked into ${name}`).not.toContain(SECRET);
    }
  });
});
