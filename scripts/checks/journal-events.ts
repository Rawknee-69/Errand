// Correction: a producer that appends to the Journal directly can write a
// payload no schema knows, so every reader has to guess its keys. Producers use
// db/events.ts, which checks the payload against the shared event catalogue.
import { at, codeOnly, isExempt, read, sourceFiles, type Violation } from "./_shared";

export const name = "journal-events";

const calls = [/appendJournalEvent\s*\(/g, /appendJournalEventIn\s*\(/g];

export function run(): Violation[] {
  const violations: Violation[] = [];

  for (const file of sourceFiles()) {
    if (isExempt(file)) continue;
    if (file.startsWith("scripts/") || file.startsWith("docs/")) continue;
    if (file.includes("/tests/")) continue;
    if (file.startsWith("apps/gateway/src/db/")) continue;

    const text = read(file);
    const code = codeOnly(text);
    for (const pattern of calls) {
      pattern.lastIndex = 0;
      for (let match = pattern.exec(code); match; match = pattern.exec(code)) {
        violations.push(
          at(
            file,
            text,
            match.index,
            "direct journal append — use recordEvent/recordEventIn so the payload is checked",
          ),
        );
      }
    }
  }

  return violations;
}
