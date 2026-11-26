import { createMigratedDatabase, type Db } from "../../src/db/client.ts";
import { connectors, tools, users } from "../../src/db/schema.ts";

export const TS = "2026-01-01T00:00:00.000Z";
export const KEK = "vault-key-material-that-is-long-enough-for-aes";

export type SeededTool = {
  id: string;
  connectorId: string;
  name: string;
  agentName: string;
  description?: string;
  class?: "read" | "write" | "send" | "delete" | "spend" | "unknown";
  requestable?: boolean;
  state?: "new" | "active" | "changed" | "removed";
};

export function userDb(userIds: string[] = ["user-a"]): Db {
  const db = createMigratedDatabase(":memory:");
  for (const id of userIds) {
    db.insert(users).values({ id, name: id, createdAt: TS }).run();
  }
  return db;
}

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
