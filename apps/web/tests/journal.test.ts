import { describe, expect, test } from "bun:test";
import { journalVerdict } from "../src/journal.ts";

describe("journal verdict", () => {
  test("reports a clean chain with how many entries were recomputed", () => {
    expect(journalVerdict({ ok: true, checked: 12 })).toEqual({
      tone: "ok",
      title: "Chain intact",
      detail: "12 entries recomputed; every hash matches.",
      brokenSeq: null,
    });
    expect(journalVerdict({ ok: true, checked: 1 }).detail).toBe(
      "1 entry recomputed; every hash matches.",
    );
    expect(journalVerdict({ ok: true, checked: 0 }).detail).toBe(
      "0 entries recomputed; every hash matches.",
    );
  });

  test("names the first broken sequence and what it means", () => {
    expect(journalVerdict({ ok: false, checked: 3, firstBrokenSeq: 4 })).toEqual({
      tone: "danger",
      title: "Chain broken at sequence 4",
      detail: "3 entries before it are intact. The journal was altered or an entry is missing.",
      brokenSeq: 4,
    });
  });
});
