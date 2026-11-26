import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

// Hashing first gives both operands the same length, so timingSafeEqual never
// throws and comparison time does not depend on the candidate's length.
export function passphraseMatches(expected: string, presented: string): boolean {
  return timingSafeEqual(digest(expected), digest(presented));
}
