import type { ReceiptView, VerificationOutcome } from "@errand/shared";
import type { BadgeTone } from "./tone.ts";

type VerificationView = {
  label: string;
  tone: BadgeTone;
  detail: string;
};

export function verificationView(outcome: VerificationOutcome): VerificationView {
  if (outcome === "matched") {
    return {
      label: "Verified",
      tone: "ok",
      detail: "The verifier re-read the service and found the change.",
    };
  }
  if (outcome === "mismatched") {
    return {
      label: "Mismatched",
      tone: "danger",
      detail: "The verifier re-read the service and did not find the change.",
    };
  }
  return {
    label: "Unverified",
    tone: "muted",
    detail: "No verifier covers this service, so Errand does not claim it landed.",
  };
}

type UndoView = {
  state: "none" | "available" | "applied" | "failed";
  label: string;
  detail: string;
};

export function canUndo(receipt: ReceiptView): boolean {
  return receipt.undo !== null && receipt.undo.appliedAt === null;
}

export function undoView(receipt: ReceiptView): UndoView {
  const undo = receipt.undo;
  if (undo === null) {
    return receipt.irreversible
      ? { state: "none", label: "Cannot be undone", detail: "This kind of change has no inverse." }
      : {
          state: "none",
          label: "No undo available",
          detail: "Errand recorded no inverse for this change.",
        };
  }
  if (undo.appliedAt !== null) {
    return {
      state: "applied",
      label: "Undone",
      detail: undo.summary ?? "The inverse ran and its result was verified.",
    };
  }
  if (undo.verification === "mismatched") {
    return {
      state: "failed",
      label: "Undo did not verify",
      detail: undo.summary ?? "The inverse ran but the change is still there.",
    };
  }
  return {
    state: "available",
    label: "Undo available",
    detail: "Errand can run the inverse and verify it.",
  };
}

type VerificationTally = Record<VerificationOutcome, number>;

export function summariseVerifications(receipts: readonly ReceiptView[]): VerificationTally {
  const tally: VerificationTally = { matched: 0, mismatched: 0, unverified: 0 };
  for (const receipt of receipts) tally[receipt.verification] += 1;
  return tally;
}
