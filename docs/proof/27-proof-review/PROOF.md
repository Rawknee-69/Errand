# Proof — #27 Review the proof, not the diff

Environment: Windows, bun 1.4.4, worktree `D:\errand-proof`, branch
`ticket/27-proof-review` based on `integration` @ `8f5b581`.

No UI exists yet (the web app is a Vite placeholder until P7), so this ticket's
proof is the gate itself: the closure guard was driven through its three real
states via the CLI, and the repository's own typecheck and test suite were run
in the same window.

## Steps driven

1. Closed a ticket with a report that has no `Proof` section → refused.
2. Closed a ticket with a `Proof` section naming a file that does not exist →
   refused.
3. Closed a ticket with a `Proof` section naming a real artifact → accepted
   (dry run).
4. `bun run typecheck` and `bun test` over the whole worktree.

Transcripts: `logs/checks.txt`, `logs/repo.txt`.

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| 1 | low | Guard output includes PowerShell's wrapper noise around stderr, which makes the transcript harder to scan | logs/checks.txt | open, cosmetic |
| 2 | low | The artifact check is path-based: a report can satisfy it by naming any existing file under `docs/proof/`, not necessarily one that shows the change | logs/checks.txt | open, by design; a human still reads `PROOF.md` |

No blocker or high findings.

## Verdict

Verdict: pass.

Not proven: browser-driven UI proof, because there is no UI yet. The first UI
ticket (P7) is where `screens/` and, if motion matters, `video/` appear. The
same rule applies to API tickets from P2 onward, where the proof is a real MCP
client or `curl` transcript rather than a test suite.
