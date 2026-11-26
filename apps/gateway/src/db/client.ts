import { Database } from "bun:sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.ts";

export type Db = BunSQLiteDatabase<typeof schema> & { $client: Database };

function createDatabase(path: string): Db {
  const sqlite = new Database(path, { create: true });
  sqlite.exec("PRAGMA foreign_keys = ON;");
  return drizzle(sqlite, { schema });
}

const defaultMigrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: defaultMigrationsFolder });
}

// A worker opening a file another process already migrated must not race the migrator.
export function openDatabase(path: string): Db {
  return createDatabase(path);
}

// Fresh migrated database; `:memory:` for tests, a file path for production.
export function createMigratedDatabase(path: string): Db {
  const db = createDatabase(path);
  runMigrations(db);
  return db;
}
