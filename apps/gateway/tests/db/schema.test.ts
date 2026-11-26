import { describe, expect, test } from "bun:test";
import { z } from "zod";
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
    const rows = z
      .array(z.object({ name: z.string() }))
      .parse(
        db.$client
          .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'")
          .all(),
      );
    const tables = rows.map((r) => r.name).sort();

    expect(tables).toEqual([...EXPECTED_TABLES].sort());
  });

  test("are idempotent on an already-migrated database", () => {
    const db = createMigratedDatabase(":memory:");
    expect(() => runMigrations(db)).not.toThrow();
  });
});
