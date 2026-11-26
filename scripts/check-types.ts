// Fails the build on `any`, `@ts-ignore` and `as unknown as` double
// assertions: the three ways an untyped value enters first-party code.
// TypeScript 7 is the native compiler and exposes no JS AST, so this scans
// source with comments and string literals blanked out, preserving line numbers.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const skip = new Set(["node_modules", "dist", ".git", ".agents", ".claude"]);
// This file names the banned constructs, so scanning it would flag itself.
const self = relative(root, import.meta.path).replaceAll("\\", "/");

const rules: Array<{ name: string; pattern: RegExp }> = [
  { name: "any", pattern: /\bany\b/g },
  { name: "as unknown as", pattern: /\bas\s+unknown\s+as\b/g },
];

const blank = (text: string) => text.replace(/[^\n]/g, " ");
const strip = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/`(?:[^`\\]|\\.)*`/g, blank)
    .replace(/"(?:[^"\\\n]|\\.)*"/g, blank)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, blank)
    .replace(/\/\/[^\n]*/g, blank);

function collect(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collect(path, files);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) files.push(path);
  }
  return files;
}

type Violation = { file: string; line: number; column: number; rule: string };
const violations: Violation[] = [];
let checked = 0;

for (const path of collect(root)) {
  const file = relative(root, path).replaceAll("\\", "/");
  if (file === self) continue;
  const text = readFileSync(path, "utf8");
  checked += 1;

  const at = (index: number, rule: string) => {
    const before = text.slice(0, index).split("\n");
    violations.push({
      file,
      line: before.length,
      column: (before.at(-1)?.length ?? 0) + 1,
      rule,
    });
  };

  const code = strip(text);
  for (const { name, pattern } of rules) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(code); match; match = pattern.exec(code)) at(match.index, name);
  }
  for (const match of text.matchAll(/@ts-ignore\b/g)) at(match.index ?? 0, "@ts-ignore");
}

if (violations.length) {
  console.error(`✗ ${violations.length} type-rule violation(s) across ${checked} files:\n`);
  for (const v of violations) console.error(`  ${v.file}:${v.line}:${v.column}  ${v.rule}`);
  console.error(
    "\nUse the real type, a schema-derived type, or `unknown` narrowed immediately. Fix the error instead of `@ts-ignore`.",
  );
  process.exit(1);
}

console.log(`✓ no any, @ts-ignore or double assertions in ${checked} files`);
