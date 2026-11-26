import {
  CLEAN_RUNS_FOR_LICENSE,
  capTrimSchema,
  feedEventSchema,
  limitClampSchema,
  trustCapsSchema,
  type CapTrim,
  type FeedEvent,
} from "@errand/shared";
import { formatCalls, formatMoney } from "./format.ts";
import { describeTrims } from "./slips.ts";
import { capsSummary } from "./trust.ts";

export type FeedTone = "ok" | "danger" | "accent" | "muted";

export type FeedItem = {
  seq: number;
  at: string;
  title: string;
  detail: string;
  tone: FeedTone;
};

function text(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function count(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function trimsOf(payload: Record<string, unknown>): CapTrim[] {
  const parsed = capTrimSchema.array().safeParse(payload.trims);
  return parsed.success ? parsed.data : [];
}

function clampsOf(payload: Record<string, unknown>): string | null {
  const parsed = limitClampSchema.array().safeParse(payload.clamped);
  if (!parsed.success || parsed.data.length === 0) return null;
  return parsed.data
    .map((clamp) => {
      const field = clamp.field === "spend_cents" ? "Spend" : clamp.field === "minutes" ? "Time" : "Calls";
      const show = (value: number) =>
        clamp.field === "spend_cents" ? formatMoney(value) : String(value);
      return `${field} ${show(clamp.requested)} → ${show(clamp.applied)} (server maximum)`;
    })
    .join("; ");
}

function verificationTone(verification: string | null): FeedTone {
  if (verification === "matched") return "ok";
  if (verification === "mismatched") return "danger";
  return "muted";
}

function humanise(value: string): string {
  const words = value.replace(/[._-]+/g, " ").trim();
  return words === "" ? "Event" : words.charAt(0).toUpperCase() + words.slice(1);
}

function detail(parts: (string | null)[]): string {
  return parts.filter((part): part is string => part !== null && part !== "").join(" · ");
}

export function describeFeedEvent(event: FeedEvent): FeedItem {
  const { payload } = event;
  const tool = text(payload, "tool");
  const reason = text(payload, "reason");
  const goal = text(payload, "goal");
  const trims = trimsOf(payload);
  const item = (title: string, detailText: string, tone: FeedTone): FeedItem => ({
    seq: event.seq,
    at: event.createdAt,
    title,
    detail: detailText,
    tone,
  });

  switch (event.eventType) {
    case "slip.requested":
      return item(
        "Slip requested",
        detail([goal ?? "An agent asked for permission", clampsOf(payload)]),
        "accent",
      );
    case "slip.approved": {
      const callCap = count(payload, "call_cap");
      const spendCap = count(payload, "spend_cap_cents");
      return item(
        "Slip approved",
        detail([
          callCap === null ? null : formatCalls(callCap),
          spendCap === null ? null : formatMoney(spendCap),
          trims.length > 0 ? describeTrims(trims) : null,
        ]) || "Signed and ready",
        "ok",
      );
    }
    case "slip.denied":
      return item("Slip denied", reason ?? goal ?? "The agent was told no", "danger");
    case "slip.burned":
      return item("Slip burned", reason ?? "The slip is revoked and its capability is dead", "danger");
    case "call.allowed": {
      const callsLeft = count(payload, "calls_remaining");
      const spendLeft = count(payload, "spend_remaining_cents");
      return item(
        `Call allowed: ${tool ?? "a tool"}`,
        detail([
          callsLeft === null ? null : `${formatCalls(callsLeft)} left`,
          spendLeft === null ? null : `${formatMoney(spendLeft)} left`,
        ]),
        "ok",
      );
    }
    case "call.denied":
      return item(`Call denied: ${tool ?? "a tool"}`, humanise(reason ?? "refused"), "danger");
    case "call.succeeded": {
      const duration = count(payload, "duration_ms");
      const bytes = count(payload, "result_bytes");
      const upstreamError = payload.upstream_is_error === true;
      return item(
        `Call succeeded: ${tool ?? "a tool"}`,
        detail([
          duration === null ? null : `${duration} ms`,
          bytes === null ? null : `${bytes} bytes`,
          payload.truncated === true ? "truncated at the cap" : null,
          upstreamError ? "upstream reported an error" : null,
        ]),
        upstreamError ? "danger" : "ok",
      );
    }
    case "call.failed":
      return item(
        `Call failed: ${tool ?? "a tool"}`,
        text(payload, "message") ?? humanise(reason ?? "failed"),
        "danger",
      );
    case "call.not_forwarded":
      return item(
        `Call not forwarded: ${tool ?? "a tool"}`,
        humanise(reason ?? "not sent"),
        "muted",
      );
    case "outbox.held":
      return item(
        `Send held: ${tool ?? "a tool"}`,
        "30 seconds to stop it before it goes",
        "accent",
      );
    case "outbox.needs_human": {
      const amount = count(payload, "amount_cents");
      return item(
        `Spend needs your tap: ${tool ?? "a tool"}`,
        amount === null ? "No money moves without you" : `${formatMoney(amount)} · no money moves without you`,
        "accent",
      );
    }
    case "outbox.confirmed": {
      const amount = count(payload, "amount_cents");
      return item(
        `Spend tapped: ${tool ?? "a tool"}`,
        amount === null ? "Running after your tap" : `${formatMoney(amount)} · running after your tap`,
        "accent",
      );
    }
    case "outbox.completed": {
      const amount = count(payload, "amount_cents");
      const failed = text(payload, "outcome") === "failed";
      return item(
        failed ? `Spend failed: ${tool ?? "a tool"}` : `Spend settled: ${tool ?? "a tool"}`,
        failed
          ? (reason ?? "The upstream call failed; nothing moved")
          : amount === null
            ? "The money moved after your tap"
            : `${formatMoney(amount)} moved after your tap`,
        failed ? "danger" : "ok",
      );
    }
    case "outbox.released": {
      const failed = text(payload, "outcome") === "failed";
      return item(
        failed ? `Send failed: ${tool ?? "a tool"}` : `Send released: ${tool ?? "a tool"}`,
        failed ? (reason ?? "The upstream call failed") : "The cancel window closed and it was sent",
        failed ? "danger" : "ok",
      );
    }
    case "outbox.cancelled":
      return item(
        `Stopped: ${tool ?? "a tool"}`,
        reason === null || reason === "human_cancelled" ? "You stopped it; nothing was sent" : humanise(reason),
        "muted",
      );
    case "outbox.expired":
      return item(
        `Expired, never fired: ${tool ?? "a tool"}`,
        reason === null ? "The window closed before it could run" : humanise(reason),
        "danger",
      );
    case "call.scope_violation":
      return item(
        `Scope violation: ${tool ?? "a tool"}`,
        reason === null ? "The call was outside the slip" : humanise(reason),
        "danger",
      );
    case "receipt.created": {
      const verification = text(payload, "verification");
      return item(
        "Receipt",
        detail([text(payload, "summary"), verification === null ? null : `verification: ${verification}`]),
        verificationTone(verification),
      );
    }
    case "receipt.verified": {
      const verification = text(payload, "verification");
      return item(
        verification === "mismatched" ? "Receipt mismatched" : "Receipt verified",
        detail([text(payload, "summary"), verification]),
        verificationTone(verification),
      );
    }
    case "trust.run_clean": {
      const cleanRuns = count(payload, "clean_runs");
      return item(
        "Clean run counted",
        cleanRuns === null
          ? "The run verified clean"
          : `${cleanRuns} of ${CLEAN_RUNS_FOR_LICENSE} clean runs toward a license`,
        "ok",
      );
    }
    case "trust.run_unclean":
      return item("Unclean run", humanise(reason ?? "not clean"), "danger");
    case "trust.license_offered": {
      const cleanRuns = count(payload, "clean_runs");
      return item(
        "License offered",
        cleanRuns === null
          ? "Clean runs are complete; auto-approval is yours to accept"
          : `${cleanRuns} clean runs · auto-approval is yours to accept`,
        "accent",
      );
    }
    case "trust.license_accepted": {
      const caps = trustCapsSchema.safeParse(payload.caps);
      return item("License accepted", caps.success ? capsSummary(caps.data) : "Caps saved", "ok");
    }
    case "trust.license_used": {
      const caps = trustCapsSchema.safeParse(payload.caps);
      return item(
        "License used",
        caps.success ? `Auto-approved inside ${capsSummary(caps.data)}` : "Auto-approved inside your caps",
        "accent",
      );
    }
    case "trust.demoted": {
      const fromTier = text(payload, "from_tier");
      const fromRuns = count(payload, "from_clean_runs");
      return item(
        "Trust demoted",
        detail([
          humanise(reason ?? "demoted"),
          fromTier === null ? null : `from ${humanise(fromTier)}`,
          fromRuns === null ? null : `${fromRuns} clean runs`,
        ]),
        "danger",
      );
    }
    case "undo.applied":
      return item(
        "Undo applied",
        text(payload, "summary") ?? "The inverse ran and verified",
        "ok",
      );
    case "undo.mismatched":
      return item(
        "Undo did not verify",
        text(payload, "summary") ?? "The change is still there",
        "danger",
      );
    case "undo.failed":
      return item("Undo failed", text(payload, "message") ?? "The inverse did not run", "danger");
    case "agent_key.created":
      return item("Agent key created", text(payload, "name") ?? "A new key was issued", "accent");
    case "agent_key.revoked":
      return item("Agent key revoked", "That key can no longer connect", "muted");
    case "journal.verify":
    case "journal.verified": {
      const ok = payload.ok === true;
      const checked = count(payload, "checked");
      const broken = count(payload, "firstBrokenSeq");
      return item(
        ok ? "Journal verified" : "Journal check failed",
        ok
          ? checked === null
            ? "The hash chain is intact"
            : `${checked} entries intact`
          : broken === null
            ? "The hash chain is broken"
            : `First broken sequence: ${broken}`,
        ok ? "ok" : "danger",
      );
    }
    default:
      return item(humanise(event.eventType), "", "muted");
  }
}

export function mergeFeedEvents(current: FeedEvent[], incoming: FeedEvent, limit = 200): FeedEvent[] {
  if (current.some((event) => event.seq === incoming.seq)) return current;
  return [incoming, ...current].sort((left, right) => right.seq - left.seq).slice(0, limit);
}

export function parseFeedFrame(data: string): FeedEvent | undefined {
  try {
    const parsed: unknown = JSON.parse(data);
    const result = feedEventSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
