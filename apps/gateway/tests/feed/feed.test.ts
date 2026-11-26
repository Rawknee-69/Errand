import { afterEach, describe, expect, test } from "bun:test";
import { feedEventSchema, type FeedEvent } from "@errand/shared";
import { createGatewayApp } from "../../src/app.ts";
import { GATEWAY_IDLE_TIMEOUT_SECONDS } from "../../src/config.ts";
import { appendJournalEvent } from "../../src/db/journal.ts";
import { listFeedEvents, toFeedEvent } from "../../src/feed/events.ts";
import { DEFAULT_FEED_OPTIONS } from "../../src/feed/stream.ts";
import { userDb } from "../support/fixtures.ts";
import { openSse, readSseUntil } from "../support/sse.ts";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function openStream(
  app: ReturnType<typeof createGatewayApp>,
  path: string,
  init?: RequestInit,
) {
  const response = await app.request(path, init);
  const sse = openSse(response);
  cleanups.push(() => sse.cancel());
  return { response, sse };
}

function feedFrames(text: string): FeedEvent[] {
  return text
    .split("\n\n")
    .filter((frame) => frame.includes("event: feed"))
    .map((frame) => {
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      return feedEventSchema.parse(JSON.parse(data));
    });
}

describe("feed events", () => {
  test("the server idle timeout outlives several heartbeats", () => {
    expect(GATEWAY_IDLE_TIMEOUT_SECONDS * 1_000).toBeGreaterThan(DEFAULT_FEED_OPTIONS.heartbeatMs * 3);
  });

  test("lists only the user's journal entries in chain order", () => {
    const db = userDb(["user-a", "user-b"]);
    const first = appendJournalEvent(db, { userId: "user-a", eventType: "slip.requested", payload: { slip_id: "one" } });
    appendJournalEvent(db, { userId: "user-b", eventType: "slip.requested", payload: { slip_id: "other" } });
    const third = appendJournalEvent(db, { userId: "user-a", eventType: "slip.approved", payload: { slip_id: "one" } });

    expect(listFeedEvents(db, "user-a", 0)).toEqual([
      { seq: first.seq, eventType: "slip.requested", createdAt: first.createdAt, payload: { slip_id: "one" } },
      { seq: third.seq, eventType: "slip.approved", createdAt: third.createdAt, payload: { slip_id: "one" } },
    ]);
    expect(listFeedEvents(db, "user-a", first.seq).map((event) => event.eventType)).toEqual(["slip.approved"]);
    expect(listFeedEvents(db, "user-b", 0).map((event) => event.seq)).toEqual([first.seq + 1]);
  });

  test("keeps a parsed payload and falls back to an empty one", () => {
    const db = userDb();
    const row = appendJournalEvent(db, {
      userId: "user-a",
      eventType: "call.allowed",
      payload: { tool: "calendar__list_events", calls_remaining: 2 },
    });

    expect(toFeedEvent(row).payload).toEqual({ tool: "calendar__list_events", calls_remaining: 2 });
    expect(toFeedEvent({ ...row, payload: "not json" }).payload).toEqual({});
  });
});

describe("GET /api/events", () => {
  test("replays after Last-Event-ID, streams new events and beats while idle", async () => {
    const db = userDb();
    const first = appendJournalEvent(db, {
      userId: "user-a",
      eventType: "slip.requested",
      payload: { slip_id: "slip-1", goal: "Find a dinner slot" },
    });
    const app = createGatewayApp(db, {
      userId: "user-a",
      auth: "disabled",
      feed: { pollMs: 10, heartbeatMs: 40, retryMs: 10 },
    });

    const { response, sse } = await openStream(app, "/api/events", {
      headers: { "last-event-id": String(first.seq) },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const opening = await readSseUntil(sse, (text) => text.includes("event: ready"));
    expect(opening).toContain(`data: {"since":${first.seq}}`);
    expect(opening).toContain("retry: 10");

    const second = appendJournalEvent(db, {
      userId: "user-a",
      eventType: "slip.approved",
      payload: { slip_id: "slip-1", call_cap: 4, trims: [] },
    });
    const live = await readSseUntil(sse, (text) => text.includes(`id: ${second.seq}`));
    expect(feedFrames(live)).toContainEqual({
      seq: second.seq,
      eventType: "slip.approved",
      createdAt: second.createdAt,
      payload: { slip_id: "slip-1", call_cap: 4, trims: [] },
    });

    const idle = await readSseUntil(sse, (text) => text.includes(": keep-alive"));
    expect(idle).toContain(": keep-alive");
  });

  test("does not send another user's events and refuses a malformed cursor", async () => {
    const db = userDb(["user-a", "user-b"]);
    appendJournalEvent(db, { userId: "user-b", eventType: "slip.requested", payload: { slip_id: "other" } });
    const own = appendJournalEvent(db, {
      userId: "user-a",
      eventType: "call.denied",
      payload: { reason: "out_of_scope" },
    });
    const app = createGatewayApp(db, { userId: "user-a", auth: "disabled", feed: { pollMs: 10, heartbeatMs: 1_000 } });

    const { sse } = await openStream(app, "/api/events");
    const text = await readSseUntil(sse, (value) => value.includes("event: feed"));
    const frames = feedFrames(text);
    expect(frames).toEqual([
      { seq: own.seq, eventType: "call.denied", createdAt: own.createdAt, payload: { reason: "out_of_scope" } },
    ]);

    const bad = await app.request("/api/events?since=nope");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "invalid_request" });
  });
});
