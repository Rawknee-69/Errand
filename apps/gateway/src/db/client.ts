import { Database } from "bun:sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.ts";

export type Db = BunSQLiteDatabase<typeof schema> & { $client: Database };

export function createDatabase(path: string): Db {
  const sqlite = new Database(path, { create: true });
  sqlite.exec("PRAGMA foreign_keys = ON;");
  return drizzle(sqlite, { schema });
}

const defaultMigrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export function runMigrations(db: Db, migrationsFolder: string = defaultMigrationsFolder): void {
  migrate(db, { migrationsFolder });
}

// Fresh migrated database; `:memory:` for tests, a file path for production.
export function createMigratedDatabase(path: string, migrationsFolder?: string): Db {
  const db = createDatabase(path);
  runMigrations(db, migrationsFolder);
  return db;
}
