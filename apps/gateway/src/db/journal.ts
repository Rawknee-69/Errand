import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./client.ts";
import { journal } from "./schema.ts";

// Append-only, hash-chained journal (GLOSSARY.md). The first event's
// prev_hash is 64 zeros; verify recomputes the chain and finds tampering.
export const GENESIS_HASH = "0".repeat(64);

export type JournalEvent = typeof journal.$inferSelect;

export type JournalEventInput = {
  userId: string;
  eventType: string;
  payload?: unknown;
};

export type JournalVerifyResult =
  | { ok: true; checked: number }
  | { ok: false; checked: number; firstBrokenSeq: number };

// Canonical JSON: object keys sorted recursively, arrays keep order.
// The byte-exact form that is hashed and stored (slip canonicalisation reuses this contract).
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function hashJournalEvent(event: {
  seq: number;
  userId: string;
  eventType: string;
  payload: string;
  prevHash: string;
  createdAt: string;
}): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        seq: event.seq,
        user_id: event.userId,
        event_type: event.eventType,
        payload: event.payload,
        prev_hash: event.prevHash,
        created_at: event.createdAt,
      }),
    )
    .digest("hex");
}

// Append one event in a transaction: chain seq + prev_hash from the last event.
export function appendJournalEvent(db: Db, event: JournalEventInput): JournalEvent {
  return db.transaction((tx) => {
    const last = tx.select().from(journal).orderBy(desc(journal.seq)).limit(1).all()[0];
    const seq = (last?.seq ?? 0) + 1;
    const prevHash = last?.hash ?? GENESIS_HASH;
    const createdAt = new Date().toISOString();
    const payload = canonicalJson(event.payload ?? {});
    const row = {
      seq,
      userId: event.userId,
      eventType: event.eventType,
      payload,
      prevHash,
      hash: hashJournalEvent({
        seq,
        userId: event.userId,
        eventType: event.eventType,
        payload,
        prevHash,
        createdAt,
      }),
      createdAt,
    };
    tx.insert(journal).values(row).run();
    return row;
  });
}

// Recompute the whole chain; report the first broken sequence number, if any.
export function verifyJournal(db: Db): JournalVerifyResult {
  const rows = db.select().from(journal).orderBy(journal.seq).all();
  let prevHash = GENESIS_HASH;
  let expectedSeq = 1;
  let checked = 0;
  for (const row of rows) {
    const intact =
      row.seq === expectedSeq &&
      row.prevHash === prevHash &&
      row.hash ===
        hashJournalEvent({
          seq: row.seq,
          userId: row.userId,
          eventType: row.eventType,
          payload: row.payload,
          prevHash: row.prevHash,
          createdAt: row.createdAt,
        });
    if (!intact) return { ok: false, checked, firstBrokenSeq: row.seq };
    prevHash = row.hash;
    expectedSeq = row.seq + 1;
    checked++;
  }
  return { ok: true, checked };
}

// Per-user read, scoped by user id at the query layer.
export function listJournalEvents(db: Db, userId: string): JournalEvent[] {
  return db.select().from(journal).where(eq(journal.userId, userId)).orderBy(journal.seq).all();
}

export function getJournalEvent(db: Db, userId: string, seq: number): JournalEvent | undefined {
  return db
    .select()
    .from(journal)
    .where(and(eq(journal.userId, userId), eq(journal.seq, seq)))
    .all()[0];
}
