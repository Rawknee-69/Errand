// Closes one ticket the same way every time: tick its acceptance criteria,
// attach the phase report, close as completed, then name what is now runnable.
//
//   bun run scripts/complete-ticket.ts <issue> [report.md] [--dry]
//
// The report must contain the brief's §31 evidence (commands, pasted test
// output). Closing is what unblocks dependents, so a dry run is available.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const [issueArg, reportPath] = args.filter((a) => a !== "--dry");
const issue = Number(issueArg);

if (!Number.isInteger(issue) || issue <= 0) {
  console.error("usage: bun run scripts/complete-ticket.ts <issue> [report.md] [--dry]");
  process.exit(1);
}

const gh = (params: string[], input?: string): string =>
  execFileSync("gh", params, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] }).trim();

const repo = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
const current = JSON.parse(gh(["issue", "view", String(issue), "--json", "title,body,state,number"]));

if (current.state === "CLOSED") {
  console.error(`#${issue} is already closed — nothing to do.`);
  process.exit(0);
}

const unchecked = (current.body.match(/^- \[ \]/gm) ?? []).length;
const ticked = current.body.replace(/^- \[ \]/gm, "- [x]");

if (reportPath) {
  const raw = readFileSync(reportPath);
  // Windows shells default to UTF-16, sometimes with a BOM; decode what it is.
  const utf16 = (raw[0] === 0xff && raw[1] === 0xfe) || raw[1] === 0;
  const text = utf16 ? raw.toString("utf16le") : raw.toString("utf8");
  const report = text.replace(/^\uFEFF/, "").trim();
  const missing = ["test", "command"].filter((word) => !report.toLowerCase().includes(word));
  if (missing.length) {
    console.error(
      `Report does not look like a §31 report (no mention of: ${missing.join(", ")}). Refusing to close without evidence.`,
    );
    process.exit(1);
  }
}

console.log(`#${issue} ${current.title}`);
console.log(`  tick ${unchecked} acceptance criteria`);
console.log(`  comment ${reportPath ? reportPath : "(no report — refusing in a real run)"}`);
console.log(`  close as completed in ${repo}`);

if (dry) {
  console.log("\n--dry: no changes made.");
  process.exit(0);
}
if (!reportPath) {
  console.error("\nA completion comment is required: pass the report file.");
  process.exit(1);
}

const bodyFile = join(tmpdir(), `ticket-${issue}-body.md`);
writeFileSync(bodyFile, ticked);
try {
  gh(["issue", "edit", String(issue), "--body-file", bodyFile]);
} finally {
  rmSync(bodyFile, { force: true });
}
gh(["issue", "comment", String(issue), "--body-file", reportPath]);
gh(["issue", "close", String(issue), "--reason", "completed"]);

const open = JSON.parse(
  gh(["issue", "list", "--state", "open", "--limit", "100", "--json", "number,title,blockedBy"]),
) as Array<{ number: number; title: string; blockedBy: Array<{ state: string }> }>;

const ready = open.filter((i) => i.number !== issue && i.blockedBy.every((b) => b.state !== "OPEN"));

console.log(`\nClosed #${issue}. Now runnable:`);
if (!ready.length) {
  console.log("  none — the frontier is empty; check the phase gate.");
} else {
  for (const i of ready) console.log(`  /implement ${i.number}  (${i.title})`);
}
