import { createHash } from "node:crypto";
import { canonicalJson } from "../db/journal.ts";

// Goal text is excluded on purpose: the trust ledger keys on the kind of work,
// not the wording of one request (GLOSSARY.md).
export function errandTypeFor(tools: readonly string[], constraintKeys: readonly string[]): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        constraint_shape: [...new Set(constraintKeys)].sort(),
        tools: [...tools].sort(),
      }),
    )
    .digest("hex");
}
