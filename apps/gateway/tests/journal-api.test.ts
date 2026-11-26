import { describe, expect, test } from "bun:test";
import { createGatewayApp } from "../src/app.ts";
import { createMigratedDatabase } from "../src/db/client.ts";
import { appendJournalEvent } from "../src/db/journal.ts";
import { users } from "../src/db/schema.ts";

describe("GET /api/journal/verify", () => {
  test("reports a clean result on an empty journal", async () => {
    const app = createGatewayApp(createMigratedDatabase(":memory:"), { auth: "disabled" });

    const response = await app.request("/api/journal/verify");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, checked: 0 });
  });

  test("recomputes the chain and reports the first broken sequence", async () => {
    const db = createMigratedDatabase(":memory:");
    db.insert(users).values({ id: "u", name: "U", createdAt: "2026-01-01T00:00:00.000Z" }).run();
    appendJournalEvent(db, { userId: "u", eventType: "a", payload: {} });
    appendJournalEvent(db, { userId: "u", eventType: "b", payload: {} });
    const app = createGatewayApp(db, { auth: "disabled" });

    expect(await (await app.request("/api/journal/verify")).json()).toEqual({ ok: true, checked: 2 });

    db.$client.query("UPDATE journal SET payload = '{\"x\":1}' WHERE seq = 1").run();

    expect(await (await app.request("/api/journal/verify")).json()).toEqual({ ok: false, checked: 0, firstBrokenSeq: 1 });
  });
});
