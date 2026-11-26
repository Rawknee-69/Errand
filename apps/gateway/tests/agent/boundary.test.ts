import { describe, expect, test } from "bun:test";
import { boundarySchema } from "@errand/shared";
import { boundaryView } from "../../src/agent/catalog.ts";
import { createGatewayApp } from "../../src/app.ts";
import { seedConnector, seedTool, userDb } from "./support.ts";

function seeded() {
  const db = userDb();
  seedConnector(db, "user-a", "conn-notion", "Notion");
  seedTool(db, "user-a", {
    id: "tool-search",
    connectorId: "conn-notion",
    name: "notion_search",
    agentName: "notion__notion_search",
    class: "read",
  });
  seedTool(db, "user-a", {
    id: "tool-delete",
    connectorId: "conn-notion",
    name: "notion_delete_pages",
    agentName: "notion__notion_delete_pages",
    class: "delete",
    requestable: false,
  });
  seedTool(db, "user-a", {
    id: "tool-changed",
    connectorId: "conn-notion",
    name: "notion_update_page",
    agentName: "notion__notion_update_page",
    class: "write",
    state: "changed",
  });
  seedTool(db, "user-a", {
    id: "tool-decoy",
    connectorId: "conn-notion",
    name: "export_all_contacts",
    agentName: "notion__export_all_contacts",
    class: "read",
  });
  return db;
}

describe("boundary view", () => {
  test("top layer is what the agent endpoint serves; every gap has a reason", () => {
    const view = boundaryView(seeded(), "user-a");

    expect(view.visible.map((tool) => tool.name)).toEqual(["notion__notion_search"]);
    expect(view.hidden.map((tool) => [tool.name, tool.reason])).toEqual([
      ["notion__export_all_contacts", "decoy"],
      ["notion__notion_delete_pages", "not_requestable"],
      ["notion__notion_update_page", "definition_changed"],
    ]);
    expect(view.counts).toEqual({
      connectors: 1,
      discovered: 4,
      visible: 1,
      hidden: 3,
      decoys: 1,
      blocked: 1,
      notRequestable: 1,
    });
    expect(view.connectors[0]).toMatchObject({ name: "Notion", discovered: 4, visible: 1 });
    expect(view.limits.tools).toBeGreaterThan(0);
  });

  test("the contract is a schema, not a promise", () => {
    expect(() => boundarySchema.parse(boundaryView(seeded(), "user-a"))).not.toThrow();
  });

  test("GET /api/boundary returns the same view over HTTP", async () => {
    const db = seeded();
    const app = createGatewayApp(db, { userId: "user-a", auth: "disabled" });

    const response = await app.request("/api/boundary");
    expect(response.status).toBe(200);
    expect(boundarySchema.parse(await response.json())).toEqual(boundaryView(db, "user-a"));
  });
});
