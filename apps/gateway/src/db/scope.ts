import { and, eq } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "./client.ts";

// One home for per-user scoping: every read filters `user_id = ?` at the query layer.
export function scopedList<TTable extends SQLiteTable>(
  db: Db,
  table: TTable,
  userColumn: SQLiteColumn,
  userId: string,
) {
  return db.select().from(table).where(eq(userColumn, userId)).all();
}

export function scopedGet<TTable extends SQLiteTable>(
  db: Db,
  table: TTable,
  userColumn: SQLiteColumn,
  userId: string,
  idColumn: SQLiteColumn,
  id: string | number,
) {
  return db
    .select()
    .from(table)
    .where(and(eq(userColumn, userId), eq(idColumn, id)))
    .all()[0];
}
