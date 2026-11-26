// Correction: ticket #15 found tests asserting "the last journal event"; when a
// new concern appended its own event they failed without any behaviour change.
// A test selects the event it means by type, never by position.
import { read, sourceFiles, type Violation } from "./_shared";

export const name = "journal-last-event";

const directLast = /listJournalEvents\([^)]*\)\s*\.at\(-1\)/;

export function run(): Violation[] {
  const violations: Violation[] = [];
  for (const file of sourceFiles()) {
    if (!file.includes("/tests/")) continue;
    const lines = read(file).split("\n");
    lines.forEach((line, index) => {
      const match = directLast.exec(line);
      if (match === null) return;
      violations.push({
        file,
        line: index + 1,
        column: match.index + 1,
        message: "asserts the last journal event — filter by event type and select that instead",
      });
    });
  }
  return violations;
}
