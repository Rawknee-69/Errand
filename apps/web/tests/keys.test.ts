import { describe, expect, test } from "bun:test";
import type { AgentKeyView } from "@errand/shared";
import { keyStatusView, splitAgentKeys } from "../src/keys.ts";

function key(id: string, revokedAt: string | null = null): AgentKeyView {
  return { id, name: id, createdAt: "2026-01-01T00:00:00.000Z", revokedAt };
}

describe("agent key status", () => {
  test("distinguishes an active key from a revoked one", () => {
    expect(keyStatusView(key("one"))).toEqual({ label: "Active", tone: "ok" });
    expect(keyStatusView(key("two", "2026-01-02T00:00:00.000Z"))).toEqual({
      label: "Revoked",
      tone: "muted",
    });
  });

  test("lists active keys before revoked ones and keeps their order", () => {
    expect(splitAgentKeys([key("a"), key("b", "x"), key("c")])).toEqual({
      active: [key("a"), key("c")],
      revoked: [key("b", "x")],
    });
  });
});
