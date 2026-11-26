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
      describeFeedEvent(event(13, "outbox.held", { tool: "pay__send_receipt" })),
    ).toMatchObject({
      title: "Send held: pay__send_receipt",
      detail: "30 seconds to stop it before it goes",
      tone: "accent",
    });
    expect(
      describeFeedEvent(event(14, "outbox.needs_human", { tool: "pay__charge_card", amount_cents: 500 })),
    ).toMatchObject({
      title: "Spend needs your tap: pay__charge_card",
      detail: "$5.00 · no money moves without you",
      tone: "accent",
    });
    expect(
      describeFeedEvent(event(15, "outbox.confirmed", { tool: "pay__charge_card", amount_cents: 500 })),
    ).toMatchObject({ title: "Spend tapped: pay__charge_card", tone: "accent" });
    expect(
      describeFeedEvent(
        event(19, "outbox.completed", {
          tool: "pay__charge_card",
          amount_cents: 500,
          outcome: "succeeded",
        }),
      ),
    ).toMatchObject({ title: "Spend settled: pay__charge_card", tone: "ok" });
    expect(
      describeFeedEvent(
        event(20, "outbox.completed", {
          tool: "pay__charge_card",
          outcome: "failed",
          reason: "The upstream call failed",
        }),
      ),
    ).toMatchObject({ title: "Spend failed: pay__charge_card", tone: "danger" });
    expect(
      describeFeedEvent(event(16, "outbox.released", { tool: "pay__send_receipt", outcome: "succeeded" })),
    ).toMatchObject({ title: "Send released: pay__send_receipt", tone: "ok" });
    expect(
      describeFeedEvent(event(17, "outbox.cancelled", { tool: "pay__send_receipt", reason: "human_cancelled" })),
    ).toMatchObject({
      title: "Stopped: pay__send_receipt",
      detail: "You stopped it; nothing was sent",
      tone: "muted",
    });
    expect(
      describeFeedEvent(event(18, "outbox.expired", { tool: "pay__send_receipt", reason: "burned" })),
    ).toMatchObject({ title: "Expired, never fired: pay__send_receipt", detail: "Burned", tone: "danger" });
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

  test("explains trust, undo and agent-key events instead of showing the event name", () => {
    expect(
      describeFeedEvent(event(21, "trust.run_clean", { clean_runs: 3, errand_type: "abc" })),
    ).toMatchObject({
      title: "Clean run counted",
      detail: "3 of 5 clean runs toward a license",
      tone: "ok",
    });
    expect(
      describeFeedEvent(
        event(22, "trust.run_unclean", { reason: "receipt_mismatched", errand_type: "abc" }),
      ),
    ).toMatchObject({ title: "Unclean run", detail: "Receipt mismatched", tone: "danger" });
    expect(
      describeFeedEvent(event(23, "trust.license_offered", { clean_runs: 5, errand_type: "abc" })),
    ).toMatchObject({
      title: "License offered",
      detail: "5 clean runs · auto-approval is yours to accept",
      tone: "accent",
    });
    expect(
      describeFeedEvent(
        event(24, "trust.license_accepted", {
          caps: { callCap: 2, spendCapCents: 1_500, minutes: 5 },
        }),
      ),
    ).toMatchObject({ title: "License accepted", detail: "2 calls · $15.00 · 5 min", tone: "ok" });
    expect(
      describeFeedEvent(
        event(25, "trust.license_used", {
          caps: { callCap: 2, spendCapCents: 1_500, minutes: 5 },
        }),
      ),
    ).toMatchObject({
      title: "License used",
      detail: "Auto-approved inside 2 calls · $15.00 · 5 min",
      tone: "accent",
    });
    expect(
      describeFeedEvent(
        event(26, "trust.demoted", {
          reason: "mismatch",
          from_tier: "license",
          from_clean_runs: 7,
        }),
      ),
    ).toMatchObject({
      title: "Trust demoted",
      detail: "Mismatch · from License · 7 clean runs",
      tone: "danger",
    });
    expect(
      describeFeedEvent(event(27, "undo.applied", { summary: "Deleted the event." })),
    ).toMatchObject({ title: "Undo applied", detail: "Deleted the event.", tone: "ok" });
    expect(
      describeFeedEvent(event(28, "undo.mismatched", { summary: "The event is still there." })),
    ).toMatchObject({
      title: "Undo did not verify",
      detail: "The event is still there.",
      tone: "danger",
    });
    expect(
      describeFeedEvent(event(29, "undo.failed", { message: "The connector timed out" })),
    ).toMatchObject({ title: "Undo failed", detail: "The connector timed out", tone: "danger" });
    expect(
      describeFeedEvent(event(30, "agent_key.created", { name: "Claude Code" })),
    ).toMatchObject({ title: "Agent key created", detail: "Claude Code", tone: "accent" });
    expect(describeFeedEvent(event(31, "agent_key.revoked", { agent_key_id: "k1" }))).toMatchObject({
      title: "Agent key revoked",
      detail: "That key can no longer connect",
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
