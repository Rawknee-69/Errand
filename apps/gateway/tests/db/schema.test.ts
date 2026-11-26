import { describe, expect, test } from "bun:test";
import { createMigratedDatabase, runMigrations } from "../../src/db/client.ts";

const EXPECTED_TABLES = [
  "users",
  "agent_keys",
  "connectors",
  "credentials",
  "oauth_attempts",
  "tools",
  "slips",
  "calls",
  "receipts",
  "undo_actions",
  "trust",
  "journal",
];

describe("migrations", () => {
  test("create every table in the data model", () => {
    const db = createMigratedDatabase(":memory:");
    const rows = db.$client
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'")
      .all() as Array<{ name: string }>;
    const tables = rows.map((r) => r.name).sort();

    expect(tables).toEqual([...EXPECTED_TABLES].sort());
  });

  test("are idempotent on an already-migrated database", () => {
    const db = createMigratedDatabase(":memory:");
    expect(() => runMigrations(db)).not.toThrow();
  });
});
