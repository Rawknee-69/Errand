import { describe, expect, test } from "bun:test";
import {
  assertConnectorQuota,
  ConnectorLimitError,
  countConnectors,
} from "../../src/connectors/quota.ts";
import { createMigratedDatabase, type Db } from "../../src/db/client.ts";
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

function refusal(fn: () => void): ConnectorLimitError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConnectorLimitError) return error;
    throw error;
  }
  throw new Error("expected a ConnectorLimitError");
}

describe("connector quota", () => {
  test("counts only the named user's connectors", () => {
    const db = createMigratedDatabase(":memory:");
    seedUser(db, "user-a", 2);
    seedUser(db, "user-b", 5);

    expect(countConnectors(db, "user-a")).toBe(2);
    expect(countConnectors(db, "user-b")).toBe(5);
  });

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

    const error = refusal(() => assertConnectorQuota(db, "user-a", 1));
    expect(error.count).toBe(2);
    expect(error.limit).toBe(1);
    expect(error.message).toContain("2 of 1");
  });

  test("allows the first connector for a user with none", () => {
    const db = createMigratedDatabase(":memory:");
    seedUser(db, "user-a", 0);

    expect(() => assertConnectorQuota(db, "user-a")).not.toThrow();
  });
});
