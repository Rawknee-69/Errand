import type { AgentKeyView } from "@errand/shared";
import type { BadgeTone } from "./tone.ts";

export function isActiveKey(key: AgentKeyView): boolean {
  return key.revokedAt === null;
}

export function keyStatusView(key: AgentKeyView): { label: string; tone: BadgeTone } {
  return isActiveKey(key)
    ? { label: "Active", tone: "ok" }
    : { label: "Revoked", tone: "muted" };
}

export function splitAgentKeys(keys: readonly AgentKeyView[]): {
  active: AgentKeyView[];
  revoked: AgentKeyView[];
} {
  return {
    active: keys.filter(isActiveKey),
    revoked: keys.filter((key) => !isActiveKey(key)),
  };
}
