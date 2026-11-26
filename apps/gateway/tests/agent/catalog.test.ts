import { describe, expect, test } from "bun:test";
import { agentCatalog } from "../../src/agent/catalog.ts";
import { seedConnector, seedTool, userDb } from "./support.ts";

describe("agent catalog", () => {
  test("lists only requestable tools with Errand labels and sanitised descriptions", () => {
    const db = userDb();
    seedConnector(db, "user-a", "conn-1", "Calendar");
    seedTool(db, "user-a", {
      id: "tool-1",
      connectorId: "conn-1",
      name: "list_events",
      agentName: "calendar__list_events",
      description: "<b>List</b> events\u202e in a range",
      class: "read",
    });
    seedTool(db, "user-a", {
      id: "tool-2",
      connectorId: "conn-1",
      name: "delete_event",
      agentName: "calendar__delete_event",
      class: "delete",
      requestable: false,
    });
    seedTool(db, "user-a", {
      id: "tool-3",
      connectorId: "conn-1",
      name: "changed_event",
      agentName: "calendar__changed_event",
      state: "changed",
      requestable: false,
    });

    expect(agentCatalog(db, "user-a")).toEqual([
      {
        name: "calendar__list_events",
        label: "Calendar: list events",
        description: "List events in a range",
        class: "read",
        connector: "Calendar",
      },
    ]);
  });

  test("never shows a decoy, even if a row says it is requestable", () => {
    const db = userDb();
    seedConnector(db, "user-a", "conn-1", "Notion");
    seedTool(db, "user-a", {
      id: "tool-1",
      connectorId: "conn-1",
      name: "export_all_contacts",
      agentName: "notion__export_all_contacts",
      requestable: true,
    });

    expect(agentCatalog(db, "user-a")).toEqual([]);
  });

  test("one user's catalog never contains another user's connectors", () => {
    const db = userDb(["user-a", "user-b"]);
    seedConnector(db, "user-a", "conn-a", "Calendar");
    seedTool(db, "user-a", {
      id: "tool-a",
      connectorId: "conn-a",
      name: "list_events",
      agentName: "calendar__list_events",
    });
    seedConnector(db, "user-b", "conn-b", "Notion");
    seedTool(db, "user-b", {
      id: "tool-b",
      connectorId: "conn-b",
      name: "search_pages",
      agentName: "notion__search_pages",
    });

    expect(agentCatalog(db, "user-a").map((tool) => tool.name)).toEqual(["calendar__list_events"]);
    expect(agentCatalog(db, "user-b").map((tool) => tool.name)).toEqual(["notion__search_pages"]);
  });
});
