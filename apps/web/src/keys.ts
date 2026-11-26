import type { AgentKeyView } from "@errand/shared";
import type { BadgeTone } from "./tone.ts";

export function keyStatusView(key: AgentKeyView): { label: string; tone: BadgeTone } {
  return key.revokedAt === null
    ? { label: "Active", tone: "ok" }
    : { label: "Revoked", tone: "muted" };
}

export function splitAgentKeys(keys: readonly AgentKeyView[]): {
  active: AgentKeyView[];
  revoked: AgentKeyView[];
} {
  return {
    active: keys.filter((key) => key.revokedAt === null),
    revoked: keys.filter((key) => key.revokedAt !== null),
  };
}
