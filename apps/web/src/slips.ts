import type { CapTrim, SlipApprovalInput, SlipState } from "@errand/shared";
import { formatMoney } from "./format.ts";

type CapEdits = { callCap: string; spendDollars: string };

type CapParseResult =
  | { ok: true; input: SlipApprovalInput }
  | { ok: false; message: string };

export function describeTrim(trim: CapTrim): string {
  const field = trim.field === "call_cap" ? "Calls" : "Spend";
  const show = (value: number) => (trim.field === "call_cap" ? String(value) : formatMoney(value));
  return `${field} ${show(trim.requested)} → ${show(trim.applied)} (tightened by you)`;
}

export function describeTrims(trims: CapTrim[]): string {
  return trims.map(describeTrim).join("; ");
}

export function slipStateView(state: SlipState): {
  label: string;
  tone: "ok" | "danger" | "muted" | "accent";
} {
  if (state === "pending") return { label: "Waiting for you", tone: "accent" };
  if (state === "approved") return { label: "Approved", tone: "ok" };
  if (state === "denied") return { label: "Denied", tone: "danger" };
  if (state === "expired") return { label: "Expired", tone: "muted" };
  return { label: "Burned", tone: "danger" };
}

export function parseCapEdits(
  edits: CapEdits,
  requested: { callCap: number; spendCapCents: number },
): CapParseResult {
  const callCap = Number(edits.callCap);
  if (!Number.isInteger(callCap) || callCap < 1) {
    return { ok: false, message: "The call cap must be a whole number of at least 1." };
  }
  if (callCap > requested.callCap) {
    return {
      ok: false,
      message: `The agent asked for at most ${requested.callCap} ${requested.callCap === 1 ? "call" : "calls"}; a cap cannot be raised.`,
    };
  }

  const spend = Number(edits.spendDollars.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(spend) || spend < 0) {
    return { ok: false, message: "The spend cap must be a dollar amount of 0 or more." };
  }
  const spendCapCents = Math.round(spend * 100);
  if (spendCapCents > requested.spendCapCents) {
    return {
      ok: false,
      message: `The agent asked for at most ${formatMoney(requested.spendCapCents)}; a cap cannot be raised.`,
    };
  }
  return { ok: true, input: { callCap, spendCapCents } };
}
