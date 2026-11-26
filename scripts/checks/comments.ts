// Correction: a quick fix recorded as a comment becomes the foundation of the
// next change, so the note outlives the fix. Rejects unreferenced notes,
// commented-out code, and a file that is more comment than code.
import { comments, isExempt, read, sourceFiles, type Violation } from "./_shared";

export const name = "comments";

const note = /\b(TODO|FIXME|XXX|HACK)\b|\b(workaround|quick fix|for now|temporarily)\b/i;
const code = /^\s*\/\/\s*(const|let|var|return|if|else|for|while|function|import|export|await|class|try|switch)\b/;
const issueRef = /#\d+/;
const maxDensity = 0.2;

export function run(): Violation[] {
  const violations: Violation[] = [];

  for (const file of sourceFiles()) {
    if (isExempt(file)) continue;
    const text = read(file);
    const found = comments(text);

    for (const comment of found) {
      if (note.test(comment.body) && !issueRef.test(comment.body)) {
        violations.push({
          file,
          line: comment.line,
          column: 1,
          message: "note without an issue reference — fix it or cite the ticket",
        });
      }
      if (code.test(comment.body)) {
        violations.push({
          file,
          line: comment.line,
          column: 1,
          message: "commented-out code — delete it; git remembers",
        });
      }
    }

    const lines = text.split("\n").filter((line) => line.trim().length > 0).length;
    if (lines >= 10 && found.length / lines > maxDensity) {
      violations.push({
        file,
        line: 1,
        column: 1,
        message: `${Math.round((found.length / lines) * 100)}% comments (limit ${maxDensity * 100}%) — let the code speak`,
      });
    }
  }

  return violations;
}
