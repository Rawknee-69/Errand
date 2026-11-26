import { AGENT_LIMITS, CLEAN_RUNS_FOR_LICENSE, type Tier, type TrustCaps } from "@errand/shared";
import { formatMoney } from "./format.ts";
import type { BadgeTone } from "./tone.ts";

export type TierView = {
  label: string;
  tone: BadgeTone;
  detail: string;
};

export function tierView(tier: Tier): TierView {
  return tier === "license"
    ? {
        label: "License",
        tone: "ok",
        detail: "Runs without a tap inside the caps you set.",
      }
    : {
        label: "Learner",
        tone: "accent",
        detail: "Every slip needs your tap before it runs.",
      };
}

export function cleanRunView(cleanRuns: number): { remaining: number; label: string } {
  return {
    remaining: Math.max(0, CLEAN_RUNS_FOR_LICENSE - cleanRuns),
    label: `${cleanRuns} of ${CLEAN_RUNS_FOR_LICENSE} clean runs`,
  };
}

export function capsSummary(caps: TrustCaps | null): string {
  if (caps === null) return "No caps set";
  const calls = `${caps.callCap} ${caps.callCap === 1 ? "call" : "calls"}`;
  return `${calls} · ${formatMoney(caps.spendCapCents)} · ${caps.minutes} min`;
}

export type TrustCapEdits = {
  calls: string;
  spendDollars: string;
  minutes: string;
};

export function trustCapInputs(caps: TrustCaps | null): TrustCapEdits {
  if (caps === null) return { calls: "5", spendDollars: "10.00", minutes: "10" };
  return {
    calls: String(caps.callCap),
    spendDollars: (caps.spendCapCents / 100).toFixed(2),
    minutes: String(caps.minutes),
  };
}

export type TrustCapsParseResult =
  | { ok: true; caps: TrustCaps }
  | { ok: false; message: string };

export function parseTrustCapsEdit(edits: TrustCapEdits): TrustCapsParseResult {
  const callCap = Number(edits.calls);
  if (!Number.isInteger(callCap) || callCap < 1 || callCap > AGENT_LIMITS.calls) {
    return {
      ok: false,
      message: `Calls must be a whole number from 1 to ${AGENT_LIMITS.calls}.`,
    };
  }

  const spend = Number(edits.spendDollars.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(spend) || spend < 0) {
    return { ok: false, message: "The spend cap must be a dollar amount of 0 or more." };
  }
  const spendCapCents = Math.round(spend * 100);
  if (spendCapCents > AGENT_LIMITS.spendCents) {
    return {
      ok: false,
      message: `The spend cap cannot exceed ${formatMoney(AGENT_LIMITS.spendCents)}.`,
    };
  }

  const minutes = Number(edits.minutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > AGENT_LIMITS.minutes) {
    return {
      ok: false,
      message: `Minutes must be a whole number from 1 to ${AGENT_LIMITS.minutes}.`,
    };
  }

  return { ok: true, caps: { callCap, spendCapCents, minutes } };
}
