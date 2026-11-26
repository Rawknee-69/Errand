import { describe, expect, test } from "bun:test";
import { createMigratedDatabase, type Db } from "../../src/db/client.ts";
import { appendJournalEvent, canonicalJson, GENESIS_HASH, getJournalEvent, listJournalEvents, verifyJournal } from "../../src/db/journal.ts";
import { users } from "../../src/db/schema.ts";

function freshDb(): Db {
  const db = createMigratedDatabase(":memory:");
  db.insert(users).values({ id: "user-a", name: "A", createdAt: "2026-01-01T00:00:00.000Z" }).run();
  db.insert(users).values({ id: "user-b", name: "B", createdAt: "2026-01-01T00:00:00.000Z" }).run();
  return db;
}

describe("canonical JSON", () => {
  test("sorts object keys recursively, keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 }, e: [{ z: 1, y: 2 }, 1] })).toBe('{"a":{"c":3,"d":2},"b":1,"e":[{"y":2,"z":1},1]}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
});

describe("hash-chained journal", () => {
  test("appending chains hash from the previous event, genesis hash is 64 zeros", () => {
    const db = freshDb();

    const first = appendJournalEvent(db, { userId: "user-a", eventType: "slip.requested", payload: { b: 1, a: 2 } });
    const second = appendJournalEvent(db, { userId: "user-a", eventType: "slip.approved", payload: {} });

    expect(first.seq).toBe(1);
    expect(first.prevHash).toBe("0".repeat(64));
    expect(first.prevHash).toBe(GENESIS_HASH);
    expect(GENESIS_HASH).toHaveLength(64);

    expect(second.seq).toBe(2);
    expect(second.prevHash).toBe(first.hash);

    // canonical payload: key order does not change the stored bytes
    expect(first.payload).toBe('{"a":2,"b":1}');

    expect(verifyJournal(db)).toEqual({ ok: true, checked: 2 });
  });

  test("verify recomputes the chain and reports a clean result", () => {
    const db = freshDb();
    expect(verifyJournal(db)).toEqual({ ok: true, checked: 0 });

    for (let i = 0; i < 5; i++) {
      appendJournalEvent(db, { userId: i % 2 === 0 ? "user-a" : "user-b", eventType: `event.${i}`, payload: { i } });
    }

    expect(verifyJournal(db)).toEqual({ ok: true, checked: 5 });
  });

  test("a test tampers one row and verify reports exactly that seq", () => {
    const db = freshDb();
    for (let i = 0; i < 5; i++) {
      appendJournalEvent(db, { userId: "user-a", eventType: `event.${i}`, payload: { i } });
    }
    expect(verifyJournal(db)).toEqual({ ok: true, checked: 5 });

    const tamperedSeq = 3;
    db.$client
      .query("UPDATE journal SET payload = ? WHERE seq = ?")
      .run('{"i":999}', tamperedSeq);

    expect(verifyJournal(db)).toEqual({ ok: false, checked: 2, firstBrokenSeq: tamperedSeq });
  });

  test("tampering with a row's hash is reported at that seq", () => {
    const db = freshDb();
    appendJournalEvent(db, { userId: "user-a", eventType: "a", payload: {} });
    appendJournalEvent(db, { userId: "user-a", eventType: "b", payload: {} });
    appendJournalEvent(db, { userId: "user-a", eventType: "c", payload: {} });

    db.$client.query("UPDATE journal SET hash = ? WHERE seq = ?").run("f".repeat(64), 2);

    expect(verifyJournal(db)).toEqual({ ok: false, checked: 1, firstBrokenSeq: 2 });
  });

  test("tampering with prev_hash linkage is reported at that seq", () => {
    const db = freshDb();
    appendJournalEvent(db, { userId: "user-a", eventType: "a", payload: {} });
    appendJournalEvent(db, { userId: "user-a", eventType: "b", payload: {} });

    db.$client.query("UPDATE journal SET prev_hash = ? WHERE seq = ?").run("f".repeat(64), 2);

    expect(verifyJournal(db)).toEqual({ ok: false, checked: 1, firstBrokenSeq: 2 });
  });

  test("a deleted row breaks contiguity at the gap", () => {
    const db = freshDb();
    appendJournalEvent(db, { userId: "user-a", eventType: "a", payload: {} });
    appendJournalEvent(db, { userId: "user-a", eventType: "b", payload: {} });
    appendJournalEvent(db, { userId: "user-a", eventType: "c", payload: {} });

    db.$client.query("DELETE FROM journal WHERE seq = ?").run(2);

    const result = verifyJournal(db);
    expect(result.ok).toBe(false);
  });

  test("journal reads are scoped by user id at the query layer", () => {
    const db = freshDb();
    appendJournalEvent(db, { userId: "user-a", eventType: "a", payload: { secret: "for-a" } });
    appendJournalEvent(db, { userId: "user-b", eventType: "b", payload: { secret: "for-b" } });
    appendJournalEvent(db, { userId: "user-a", eventType: "a2", payload: {} });

    const aEvents = listJournalEvents(db, "user-a");
    expect(aEvents.map((e) => e.eventType)).toEqual(["a", "a2"]);
    expect(aEvents.every((e) => e.userId === "user-a")).toBe(true);

    const bEvents = listJournalEvents(db, "user-b");
    expect(bEvents.map((e) => e.eventType)).toEqual(["b"]);

    // the global chain still verifies even though per-user reads are scoped
    expect(verifyJournal(db)).toEqual({ ok: true, checked: 3 });

    // by-seq read is scoped by user id at the query layer
    const aSeq1 = listJournalEvents(db, "user-a")[0]!.seq;
    expect(getJournalEvent(db, "user-a", aSeq1)?.userId).toBe("user-a");
    expect(getJournalEvent(db, "user-b", aSeq1)).toBeUndefined();
  });
});
