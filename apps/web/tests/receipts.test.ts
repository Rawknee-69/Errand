import { describe, expect, test } from "bun:test";
import type { ReceiptView } from "@errand/shared";
import {
  canUndo,
  errandTypeLabel,
  summariseVerifications,
  undoView,
  verificationView,
} from "../src/receipts.ts";

function receipt(overrides: Partial<ReceiptView> = {}): ReceiptView {
  return {
    id: "r1",
    slipId: "s1",
    callId: "c1",
    errandType: "0123456789abcdef",
    verification: "matched",
    summary: "Created the event.",
    toolClass: "write",
    irreversible: false,
    undo: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("verification badges", () => {
  test("never claim more than the verifier found", () => {
    expect(verificationView("matched")).toEqual({
      label: "Verified",
      tone: "ok",
      detail: "The verifier re-read the service and found the change.",
    });
    expect(verificationView("mismatched")).toEqual({
      label: "Mismatched",
      tone: "danger",
      detail: "The verifier re-read the service and did not find the change.",
    });
    expect(verificationView("unverified")).toEqual({
      label: "Unverified",
      tone: "muted",
      detail: "No verifier covers this service, so Errand does not claim it landed.",
    });
  });
});

describe("undo availability", () => {
  test("says plainly when a change has no inverse", () => {
    expect(undoView(receipt({ irreversible: true, toolClass: "send" }))).toEqual({
      state: "none",
      label: "Cannot be undone",
      detail: "This kind of change has no inverse.",
    });
    expect(undoView(receipt())).toEqual({
      state: "none",
      label: "No undo available",
      detail: "Errand recorded no inverse for this change.",
    });
  });

  test("offers only a stored, unapplied inverse", () => {
    const pending = receipt({
      undo: { id: "u1", appliedAt: null, verification: null, summary: null },
    });
    expect(canUndo(pending)).toBe(true);
    expect(undoView(pending)).toEqual({
      state: "available",
      label: "Undo available",
      detail: "Errand can run the inverse and verify it.",
    });
    expect(canUndo(receipt())).toBe(false);
  });

  test("reports an applied undo and a failed one differently", () => {
    const applied = receipt({
      undo: {
        id: "u1",
        appliedAt: "2026-01-01T00:01:00.000Z",
        verification: "matched",
        summary: "Deleted the event.",
      },
    });
    expect(canUndo(applied)).toBe(false);
    expect(undoView(applied)).toEqual({
      state: "applied",
      label: "Undone",
      detail: "Deleted the event.",
    });

    const failed = receipt({
      undo: {
        id: "u1",
        appliedAt: null,
        verification: "mismatched",
        summary: "The event is still there.",
      },
    });
    expect(canUndo(failed)).toBe(true);
    expect(undoView(failed)).toEqual({
      state: "failed",
      label: "Undo did not verify",
      detail: "The event is still there.",
    });
  });
});

describe("receipt summaries", () => {
  test("tallies each verification outcome", () => {
    expect(
      summariseVerifications([
        receipt({ id: "a", verification: "matched" }),
        receipt({ id: "b", verification: "unverified" }),
        receipt({ id: "c", verification: "mismatched" }),
        receipt({ id: "d", verification: "matched" }),
      ]),
    ).toEqual({ matched: 2, mismatched: 1, unverified: 1 });
  });

  test("shortens an errand type for a label but keeps a short one whole", () => {
    expect(errandTypeLabel("0123456789abcdef")).toBe("01234567…cdef");
    expect(errandTypeLabel("short")).toBe("short");
  });
});
