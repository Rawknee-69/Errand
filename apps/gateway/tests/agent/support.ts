import type { Db } from "../../src/db/client.ts";
import { connectors, tools, type ToolClass, type ToolState } from "../../src/db/schema.ts";
import { TS } from "../support/fixtures.ts";

export { TS, userDb } from "../support/fixtures.ts";

export type SeededTool = {
  id: string;
  connectorId: string;
  name: string;
  agentName: string;
  description?: string;
  class?: ToolClass;
  requestable?: boolean;
  state?: ToolState;
};

export function seedConnector(db: Db, userId: string, id: string, name: string): void {
  db.insert(connectors)
    .values({
      id,
      userId,
      name,
      url: `http://127.0.0.1:9/${id}/mcp`,
      transport: "streamable-http",
      authType: "none",
      createdAt: TS,
      updatedAt: TS,
    })
    .run();
}

export function seedTool(db: Db, userId: string, tool: SeededTool): void {
  const description = tool.description ?? "";
  db.insert(tools)
    .values({
      id: tool.id,
      userId,
      connectorId: tool.connectorId,
      name: tool.name,
      agentName: tool.agentName,
      description,
      observedDescription: description,
      class: tool.class ?? "read",
      definitionHash: `hash-${tool.id}`,
      observedHash: `hash-${tool.id}`,
      state: tool.state ?? "active",
      requestable: tool.requestable ?? true,
      createdAt: TS,
      updatedAt: TS,
    })
    .run();
}
