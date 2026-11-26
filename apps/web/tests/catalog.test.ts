import { describe, expect, test } from "bun:test";
import type { CatalogToolView } from "@errand/shared";
import {
  blockedToolCount,
  exposedToolCount,
  toolsForConnector,
} from "../src/catalog.ts";

function tool(overrides: Partial<CatalogToolView> & Pick<CatalogToolView, "id">): CatalogToolView {
  return {
    connectorId: "conn-1",
    name: overrides.id,
    agentName: `calendar__${overrides.id}`,
    description: "",
    inputSchema: "{}",
    annotations: "{}",
    class: "read",
    definitionHash: "hash",
    observedDescription: "",
    observedInputSchema: "{}",
    observedAnnotations: "{}",
    observedClass: "read",
    observedHash: "hash",
    state: "active",
    requestable: true,
    changedAt: null,
    removedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("catalog screen helpers", () => {
  test("keeps a connector's tools together without losing the others", () => {
    const tools = [tool({ id: "a" }), tool({ id: "b", connectorId: "conn-2" })];
    expect(toolsForConnector(tools, "conn-2").map((row) => row.id)).toEqual(["b"]);
  });

  test("a blocked definition is never counted as exposed", () => {
    const tools = [
      tool({ id: "live" }),
      tool({ id: "changed", state: "changed" }),
      tool({ id: "removed", state: "removed" }),
    ];
    expect(blockedToolCount(tools)).toBe(2);
    expect(exposedToolCount(tools)).toBe(1);
  });
});
