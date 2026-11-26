// Runs every check in scripts/checks/. A correction belongs here, not in prose:
// a check that fails the build, a type that makes the mistake impossible, or a
// restructure — never a new paragraph an agent can quote back.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Violation } from "./checks/_shared";

type Check = { name: string; run: () => Violation[] };

const dir = join(import.meta.dir, "checks");
const files = readdirSync(dir).filter((file) => file.endsWith(".ts") && !file.startsWith("_"));
const checks = (await Promise.all(files.map((file) => import(pathToFileURL(join(dir, file)).href)))) as Check[];

let total = 0;
for (const check of checks) {
  const violations = check.run();
  if (!violations.length) continue;
  total += violations.length;
  console.error(`\n✗ ${check.name}: ${violations.length} violation(s)`);
  for (const v of violations) console.error(`  ${v.file}:${v.line}:${v.column}  ${v.message}`);
}

if (total) {
  console.error(`\n${total} violation(s). Fix the cause, not the check.`);
  process.exit(1);
}

console.log(`✓ ${checks.length} checks passed: ${checks.map((c) => c.name).join(", ")}`);
