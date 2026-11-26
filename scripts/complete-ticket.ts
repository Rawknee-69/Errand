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

type Issue = {
  number: number;
  title: string;
  body: string;
  state: string;
  blockedBy: { nodes: Array<{ state: string }> } | null;
};

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const [issueArg, reportPath] = args.filter((a) => a !== "--dry");
const issue = Number(issueArg);

if (!Number.isInteger(issue) || issue <= 0) {
  console.error("usage: bun run scripts/complete-ticket.ts <issue> [report.md] [--dry]");
  process.exit(1);
}

const gh = (params: string[]): string =>
  execFileSync("gh", params, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();

const repo = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
const issueJson = (n: number) =>
  JSON.parse(gh(["issue", "view", String(n), "--json", "number,title,body,state,blockedBy"])) as Issue;

function frontier(closed?: number): void {
  const open = JSON.parse(
    gh([
      "issue", "list", "--state", "open", "--limit", "100",
      "--json", "number,title,blockedBy,subIssuesSummary",
    ]),
  ) as Array<Issue & { subIssuesSummary?: { total: number } }>;
  const ready = open.filter(
    (i) =>
      // A parent issue tracks children; it is never implementable itself.
      (i.subIssuesSummary?.total ?? 0) === 0 &&
      (i.blockedBy?.nodes ?? []).every((b) => b.state !== "OPEN"),
  );

  console.log(closed ? `\nClosed #${closed}. Now runnable:` : "\nRunnable now:");
  if (!ready.length) {
    console.log("  none — the frontier is empty; check the phase gate.");
    return;
  }
  for (const i of ready) console.log(`  /implement ${i.number}  (${i.title})`);
}

const current = issueJson(issue);

if (current.state === "CLOSED") {
  console.log(`#${issue} is already closed; reporting the frontier only.`);
  frontier();
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

frontier(issue);
