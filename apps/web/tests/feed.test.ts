import { describe, expect, test } from "bun:test";
import type { FeedEvent } from "@errand/shared";
import {
  describeFeedEvent,
  mergeFeedEvents,
  parseFeedFrame,
} from "../src/feed.ts";

function event(seq: number, eventType: string, payload: Record<string, unknown> = {}): FeedEvent {
  return { seq, eventType, createdAt: "2026-04-01T12:00:00.000Z", payload };
}

describe("describeFeedEvent", () => {
  test("turns approvals and trims into plain language", () => {
    const item = describeFeedEvent(
      event(4, "slip.approved", {
        call_cap: 4,
        spend_cap_cents: 1_000,
        trims: [
          { field: "call_cap", requested: 10, applied: 4, reason: "human_trim" },
          { field: "spend_cap_cents", requested: 5_000, applied: 1_000, reason: "human_trim" },
        ],
      }),
    );
    expect(item.title).toBe("Slip approved");
    expect(item.tone).toBe("ok");
    expect(item.detail).toContain("4 calls");
    expect(item.detail).toContain("$10.00");
    expect(item.detail).toContain("Calls 10 → 4 (tightened by you)");
  });

  test("covers denials, burns, calls, receipts and journal checks", () => {
    expect(
      describeFeedEvent(
        event(1, "slip.requested", {
          goal: "Find a dinner slot",
          clamped: [{ field: "calls", requested: 900, applied: 50, reason: "server_maximum" }],
        }),
      ),
    ).toMatchObject({
      title: "Slip requested",
      detail: "Find a dinner slot · Calls 900 → 50 (server maximum)",
      tone: "accent",
    });
    expect(describeFeedEvent(event(1, "slip.denied", { reason: "Not this week" }))).toMatchObject({
      title: "Slip denied",
      detail: "Not this week",
      tone: "danger",
    });
    expect(describeFeedEvent(event(2, "slip.burned", { reason: "decoy tool" }))).toMatchObject({
      title: "Slip burned",
      detail: "decoy tool",
      tone: "danger",
    });
    expect(
      describeFeedEvent(event(3, "call.allowed", { tool: "calendar__list_events", calls_remaining: 2 })),
    ).toMatchObject({ title: "Call allowed: calendar__list_events", tone: "ok" });
    expect(describeFeedEvent(event(4, "call.denied", { tool: "x__delete_all", reason: "decoy" }))).toMatchObject({
      title: "Call denied: x__delete_all",
      detail: "Decoy",
      tone: "danger",
    });
    expect(
      describeFeedEvent(
        event(10, "call.succeeded", {
          tool: "calendar__list_events",
          duration_ms: 19,
          result_bytes: 140,
          truncated: true,
        }),
      ),
    ).toMatchObject({
      title: "Call succeeded: calendar__list_events",
      detail: "19 ms · 140 bytes · truncated at the cap",
      tone: "ok",
    });
    expect(
      describeFeedEvent(
        event(11, "call.failed", { tool: "calendar__list_events", message: "The upstream timed out" }),
      ),
    ).toMatchObject({
      title: "Call failed: calendar__list_events",
      detail: "The upstream timed out",
      tone: "danger",
    });
    expect(
      describeFeedEvent(event(12, "call.not_forwarded", { tool: "calendar__create_event", reason: "send_outbox" })),
    ).toMatchObject({
      title: "Call not forwarded: calendar__create_event",
      detail: "Send outbox",
      tone: "muted",
    });
    expect(
      describeFeedEvent(event(5, "receipt.created", { summary: "Event created", verification: "matched" })),
    ).toMatchObject({ title: "Receipt", tone: "ok" });
    expect(
      describeFeedEvent(event(6, "receipt.created", { summary: "Event created", verification: "mismatched" })),
    ).toMatchObject({ tone: "danger" });
    expect(describeFeedEvent(event(7, "journal.verify", { ok: true, checked: 9 }))).toMatchObject({
      title: "Journal verified",
      detail: "9 entries intact",
      tone: "ok",
    });
    expect(
      describeFeedEvent(event(8, "journal.verify", { ok: false, checked: 4, firstBrokenSeq: 5 })),
    ).toMatchObject({ title: "Journal check failed", detail: "First broken sequence: 5", tone: "danger" });
    expect(describeFeedEvent(event(9, "connector.oauth_authorized"))).toMatchObject({
      title: "Connector oauth authorized",
      tone: "muted",
    });
  });
});

describe("mergeFeedEvents", () => {
  test("dedupes by sequence and keeps the newest first", () => {
    const merged = [event(2, "a"), event(4, "b")].reduce(
      (current, next) => mergeFeedEvents(current, next),
      [] as FeedEvent[],
    );
    expect(merged.map((row) => row.seq)).toEqual([4, 2]);
    expect(mergeFeedEvents(merged, event(2, "a"))).toBe(merged);
    expect(mergeFeedEvents(merged, event(5, "c")).map((row) => row.seq)).toEqual([5, 4, 2]);
    expect(mergeFeedEvents(merged, event(6, "d"), 2).map((row) => row.seq)).toEqual([6, 4]);
  });
});

describe("parseFeedFrame", () => {
  test("accepts a feed frame and refuses anything else", () => {
    expect(parseFeedFrame(JSON.stringify(event(3, "slip.requested")))).toEqual(event(3, "slip.requested"));
    expect(parseFeedFrame("{not json")).toBeUndefined();
    expect(parseFeedFrame(JSON.stringify({ seq: 0, eventType: "x", createdAt: "y", payload: {} }))).toBeUndefined();
    expect(parseFeedFrame(JSON.stringify({ seq: 1, eventType: "x", createdAt: "y", payload: "no" }))).toBeUndefined();
  });
});
