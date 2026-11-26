// Correction: a fresh worktree reported four unrelated typecheck failures
// because dependencies had not been installed. Fail once, with the fix.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { root, type Violation } from "./_shared";

export const name = "installed";

export function run(): Violation[] {
  if (existsSync(join(root, "node_modules"))) return [];
  return [
    {
      file: "package.json",
      line: 1,
      column: 1,
      message: "dependencies not installed in this worktree — run `bun install`",
    },
  ];
}
