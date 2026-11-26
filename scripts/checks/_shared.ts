// Shared helpers for the check suite. Each check is a small module exporting
// `name` and `run()`, discovered by scripts/check.ts — adding a check never
// means editing the runner.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type Violation = {
  file: string;
  line: number;
  column: number;
  message: string;
};

export const root = process.cwd();

const skipDirs = new Set(["node_modules", "dist", ".git", ".agents", ".claude"]);
// Checks name the patterns they forbid, so scanning them would flag themselves.
export const exempt = ["scripts/checks/", "scripts/check.ts"];

export function isExempt(file: string): boolean {
  return exempt.some((prefix) => file.startsWith(prefix));
}

export function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (skipDirs.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) files.push(path);
    }
  };
  walk(root);
  return files.map((path) => relative(root, path).replaceAll("\\", "/"));
}

export function read(file: string): string {
  return readFileSync(join(root, file), "utf8");
}

export function at(file: string, text: string, index: number, message: string): Violation {
  const before = text.slice(0, index).split("\n");
  return {
    file,
    line: before.length,
    column: (before.at(-1)?.length ?? 0) + 1,
    message,
  };
}

const blank = (text: string) => text.replace(/[^\n]/g, " ");

/** Comments and strings removed, line numbers preserved. */
export function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/`(?:[^`\\]|\\.)*`/g, blank)
    .replace(/"(?:[^"\\\n]|\\.)*"/g, blank)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, blank)
    .replace(/\/\/[^\n]*/g, blank);
}

export type Comment = { line: number; body: string };

/** Comments with strings blanked, so `"http://x"` is not a comment. */
export function comments(text: string): Comment[] {
  const lines = text
    .replace(/`(?:[^`\\]|\\.)*`/g, blank)
    .replace(/"(?:[^"\\\n]|\\.)*"/g, blank)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, blank)
    .split("\n");

  const found: Comment[] = [];
  let block = false;

  lines.forEach((line, index) => {
    if (block) {
      const end = line.indexOf("*/");
      found.push({ line: index + 1, body: end === -1 ? line : line.slice(0, end) });
      if (end !== -1) block = false;
      return;
    }
    const slash = line.indexOf("//");
    const open = line.indexOf("/*");
    if (open !== -1 && (slash === -1 || open < slash)) {
      found.push({ line: index + 1, body: line.slice(open) });
      block = line.indexOf("*/", open + 2) === -1;
      return;
    }
    if (slash !== -1) found.push({ line: index + 1, body: line.slice(slash) });
  });

  return found;
}
