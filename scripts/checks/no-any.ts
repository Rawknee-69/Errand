// Correction: an explicit `any` is a bug — the shape is unknown where the code
// claims otherwise. Rejects `any`, `@ts-ignore` and `as unknown as`.
import { at, codeOnly, isExempt, read, sourceFiles, type Violation } from "./_shared";

export const name = "no-any";

const patterns = [/\bany\b/g, /\bas\s+unknown\s+as\b/g];

export function run(): Violation[] {
  const violations: Violation[] = [];
  for (const file of sourceFiles()) {
    if (isExempt(file)) continue;
    const text = read(file);
    const code = codeOnly(text);
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (let match = pattern.exec(code); match; match = pattern.exec(code)) {
        violations.push(at(file, text, match.index, `\`${match[0]}\` — use the real type or narrow \`unknown\``));
      }
    }
    for (const match of text.matchAll(/@ts-ignore\b/g)) {
      violations.push(at(file, text, match.index ?? 0, "`@ts-ignore` — fix the error instead"));
    }
  }
  return violations;
}
