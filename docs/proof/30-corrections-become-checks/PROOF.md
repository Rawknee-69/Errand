# Proof — #30 Corrections become checks

Environment: Windows, bun 1.4.4, worktree `D:\errand-checks`, branch
`ticket/30-corrections-become-checks` based on `integration` @ `5cd1e7f`.

No UI until P7, so the proof is the check suite itself, driven through its real
states from the CLI.

## Steps driven

1. Suite clean on the repo.
2. Seeded `const leak: any = 1;` → rejected with file, line and column.
3. Seeded `// TODO: tidy this up` and `// const old = 1;` → both rejected:
   an unreferenced note and commented-out code.
4. Removed the seeds → clean again.
5. Ran the suite from an empty directory with no `node_modules` → the new
   `installed` check failed with the actual fix.
6. `bun run typecheck` and `bun test` over the worktree.

## Transcripts

- `logs/checks.txt` — steps 1–5.
- `logs/repo.txt` — step 6, including the first failed attempt described below.

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| 1 | medium | A fresh worktree reported four unrelated typecheck failures (`tsc` not found) and two failing tests (`zod`, `hono` not found) because dependencies were not installed | logs/repo.txt | closed — `scripts/checks/installed.ts` fails once with "run `bun install`" |
| 2 | low | The check suite is exempt from its own patterns, because it must name the things it forbids | scripts/checks/_shared.ts | open, by design and one directory wide |
| 3 | low | Comment density is a proxy, not a measure of comment quality: a file can pass at 19% and still carry a useless comment | logs/checks.txt | open, documented in ADR-0002; the pattern checks catch the harmful categories |

## Verdict

Verdict: pass.

Not proven: nothing browser-based; the suite is a build-time gate and was
driven as one. Finding 1 is the rule working as intended — a mistake found
during this ticket became a check before the ticket closed, not a sentence in
a markdown file.
