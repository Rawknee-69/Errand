import { describe, expect, test } from "bun:test";
import { assertConnectorQuota } from "../../src/connectors/quota.ts";
import { createMigratedDatabase, type Db } from "../../src/db/client.ts";
import { connectorLimitRefusal } from "../support/refusals.ts";
import { connectors, users } from "../../src/db/schema.ts";

const TS = "2026-01-01T00:00:00.000Z";

function seedUser(db: Db, userId: string, connectorCount: number): void {
  db.insert(users).values({ id: userId, name: userId, createdAt: TS }).run();
  for (let index = 0; index < connectorCount; index++) {
    db.insert(connectors)
      .values({
        id: `${userId}-${index}`,
        userId,
        name: `connector-${index}`,
        url: "https://example.com/sse",
        transport: "streamable-http",
        authType: "none",
        createdAt: TS,
        updatedAt: TS,
      })
      .run();
  }
}

describe("connector quota", () => {
  test("allows a new connector while the user is under the limit", () => {
    const db = createMigratedDatabase(":memory:");
    seedUser(db, "user-a", 2);
    seedUser(db, "user-b", 5);

    expect(() => assertConnectorQuota(db, "user-a", 3)).not.toThrow();
  });

  test("refuses a new connector at the limit without counting another user", () => {
    const db = createMigratedDatabase(":memory:");
    seedUser(db, "user-a", 2);
    seedUser(db, "user-b", 5);

    const error = connectorLimitRefusal(() => assertConnectorQuota(db, "user-a", 1));
    expect(error.count).toBe(2);
    expect(error.limit).toBe(1);
    expect(error.message).toContain("2 of 1");
    expect(() => assertConnectorQuota(db, "user-b", 6)).not.toThrow();
  });

  test("allows the first connector for a user with none", () => {
    const db = createMigratedDatabase(":memory:");
    seedUser(db, "user-a", 0);

    expect(() => assertConnectorQuota(db, "user-a")).not.toThrow();
  });
});
