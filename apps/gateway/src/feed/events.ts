import { journalPayload, type FeedEvent } from "@errand/shared";
import { and, asc, eq, gt } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { journal } from "../db/schema.ts";

export function toFeedEvent(row: typeof journal.$inferSelect): FeedEvent {
  let raw: unknown = {};
  try {
    raw = JSON.parse(row.payload);
  } catch {
    raw = {};
  }
  return {
    seq: row.seq,
    eventType: row.eventType,
    createdAt: row.createdAt,
    payload: journalPayload(row.eventType, raw),
  };
}

// The feed is the journal, scoped at the query layer: no second event store.
export function listFeedEvents(db: Db, userId: string, afterSeq: number): FeedEvent[] {
  return db
    .select()
    .from(journal)
    .where(and(eq(journal.userId, userId), gt(journal.seq, afterSeq)))
    .orderBy(asc(journal.seq))
    .all()
    .map(toFeedEvent);
}
