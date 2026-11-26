# Build workflow

How work moves from a ticket to `main`. Every `/implement` session reads this
before touching code.

## Branches

| Branch | Purpose | Who writes |
|---|---|---|
| `main` | Phase-gate approved, deployable | Only the phase-gate merge |
| `integration` | The build; every ticket merges here | Ticket PRs |
| `ticket/NN-slug` | Exactly one ticket, cut from `integration` | One agent, one session |

- Cut from `integration`, never from `main`.
- Rebase on `integration` before opening the PR.
- Squash-merge: one ticket history entry, message = ticket title.
- `main` moves only at a phase gate, tagged `pNN`, after the gate's report.
- Direct commits to `main` or `integration` are forbidden. The phase merge is
  itself a PR.

## Parallel agents

- Only tickets with **every** blocker closed may be claimed. Check with
  `gh api repos/Rawknee-69/Errand/issues/N --jq .issue_dependencies_summary.blocked_by`
  and require `0`.
- One branch per agent, one git worktree per branch. Never two sessions in the
  same working copy.
- The agent that started later rebases. A conflict is never resolved by
  discarding the other ticket's work.
- If a ticket turns out to need work outside its own scope, stop and file a
  new ticket rather than widening this one.

## Session close — the stop rule

A session ends when its ticket is done, and **does not start another**.

Done means, in order: implementation complete, full suite green, typecheck
clean, proof captured under `docs/proof/<NN>-<slug>/` with a `pass` verdict,
`/code-review` run and its findings addressed, PR opened, and — if CI is
green with no conflicts — squash-merged into `integration`.

Closing is part of done, and it is a command rather than a memory:

```
bun run scripts/complete-ticket.ts <issue> <report.md>
```

That ticks the acceptance criteria, attaches the report, closes as completed,
and prints the tickets that just became runnable. A `--dry` run shows what it
would do.

Never close a ticket whose criteria are unmet, and never close one without a
report. Closing releases every dependent ticket, so a false close is a false
green: an agent starts work on a foundation nobody built. If a ticket is partly
done, leave it open, comment what remains, and say so in the report.

Then report in the brief's §31 format: files built, exact commands, pasted test
output, versions changed, anything unverified, and a final line naming the next
runnable ticket:

```
Next: /implement <number>  (branch ticket/<NN>-<slug>)
```

If more than one ticket is unblocked, list them all with their numbers so the
next session can pick. Then stop. Do not begin the next ticket, do not
"just" fix something adjacent, and do not leave uncommitted work behind.

## Human in the loop (the phone protocol)

The human is often away and reaches the session from a phone over Tailscale.
Anything only they can do stops the session and becomes one clearly marked
block:

```
HUMAN ACTION — <one line: what and why>
URL: <single URL, no secrets in it>
Reply "done" when finished, or paste the error.
```

Rules:

- One action per stop. Do not stack three URLs and hope.
- Never put a secret, token or key in the URL or the chat. Credentials are
  entered in the web app or `.env`, never here.
- Then **stop**. Do not poll, sleep, or re-ask; the session resumes when the
  human replies.
- If an OAuth flow is needed, give the authorization URL and say what will
  appear on screen. The callback lands in the gateway; the human's reply is
  what resumes the work.
- A blocked session is a valid end state. Report what is blocked and why; never
  simulate the unavailable step.

## Proof review — the gate

The gate is the running system, not the diff. Nobody can read 300 lines of
change and predict which button breaks, so approval comes from driving the
thing and capturing what happened.

Before a ticket merges:

1. Bring the real app up, with real services or the mock services — not
   stubs. Drive it in the in-app browser; use the Playwright MCP server when a
   flow needs recording.
2. Do the full pass, not the happy path: every route, every button, cancel and
   deny, refresh mid-flow, empty / loading / error states, phone viewport
   390×844 and desktop 1440×900. Capture console, failed requests and SSE
   frames for the window.
3. Write `docs/proof/<NN>-<slug>/PROOF.md` with the environment, the steps
   driven, findings as a table, and a verdict. Save the screenshots and logs
   beside it. Layout and limits are in `docs/proof/README.md`.
4. Every finding names the artifact that shows it. A fixing agent works from
   that evidence, not from a description of it.
5. `Verdict: fail` blocks the merge. Fix in the branch or file a ticket, then
   re-run the steps that failed and capture them again.

The diff is read only to locate the cause once proof fails. It is never the
basis of approval.

A diff over roughly 300 changed lines means the ticket was too big: split it
rather than reviewing harder. Generated files and lockfiles do not count.

Passing tests are necessary and never sufficient — they prove the paths
someone thought of.

## Review gates

- **Every ticket:** proof review above, then `/code-review` against the
  ticket's acceptance criteria (Spec axis) and this file's coding standards
  (Standards axis). `/code-review` is the second pass, not the gate.
- **Every phase gate:** `/improve-codebase-architecture` over the phase's
  diff. Record each real finding as a ticket; fix the ones that block the next
  phase before starting it.
- Reviews are not optional because a demo is close. A skipped review is
  recorded as a deviation with a reason.
- **A finding closes by becoming a check.** If the same class of mistake could
  recur — a wrong assumption, a forgotten guard, a stale note — add
  `scripts/checks/<name>.ts` naming the correction in its header, and make it
  fail the build. A code-review comment that only exists in review is a
  reminder, not a fix.

## Coding standards

These are what `/code-review` enforces. They are deliberately narrow so a
disagreement is about a rule, not taste.

1. **One home per behaviour.** A second caller extracts the logic into a shared
   module; it never copies it. Extract on the second real use, not in advance.
2. **No near-duplicates.** Two functions that differ by one flag become one
   parameterised function or two clearly named ones. Never a pasted variant.
3. **`packages/shared` owns shared types and schemas.** Gateway and web never
   restate the same shape. Zod for our data, Ajv for upstream tool schemas;
   they never mix.
4. **Comments are for what code cannot say** — a security invariant, a
   protocol quirk, a non-obvious ordering constraint. One or two lines. No
   restating the next line, no banner blocks, no commented-out code, no `TODO`
   without an issue number. A fix is never a comment: "for now", "quick fix"
   and "temporary" notes outlive the fix and become the next change's
   foundation. If the code needs that note, change the code.
5. **Prefer a type to a comment.** If a comment explains a shape, write the
   type instead.
6. **Names come from `GLOSSARY.md`.** `slip`, not "permission object";
   `connector`, not "integration".
7. **Navigability.** One responsibility per module, directory layout matching
   the module map, `index` files only re-export. A reader should guess where a
   behaviour lives from its name and be right.
8. **No dead code, no unused exports, no speculative abstraction.** Delete
   rather than comment out.
9. **Tests assert behaviour, not internals.** A test that breaks when a private
   function is renamed is wrong.
10. **No `any`, no `@ts-ignore`, no `as unknown as`.** `any` means the shape is
    unknown where the code claims otherwise, which is a bug in waiting.
    `unknown` is correct at an untrusted boundary, then narrowed by a schema
    before use. `bun run typecheck` enforces this and fails the build. See
    `docs/adr/0001-ban-any.md`.
11. **Every correction becomes a check.** A mistake found once is closed by a
    check in `scripts/checks/` (discovered by `scripts/check.ts`), by a type
    that makes it uncompilable, or by a restructure — in that order. Never by a
    new paragraph in AGENTS.md or the spec: those give direction, the checks
    enforce. Deleting a check is an ADR, not a judgement call. See
    `docs/adr/0002-corrections-become-checks.md`.

## Notifications

There is no external push channel. A session that needs the human ends with the
`HUMAN ACTION` block above and nothing else; the human finds it by opening the
session from their phone over Tailscale.

Consequence to design around: a blocked session produces no alert, so blocking
is the last resort, not the first. Do the part that can be done without the
human before stopping, and say in the report which step is waiting on them.
