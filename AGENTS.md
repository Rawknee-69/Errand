## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `Rawknee-69/Errand`, driven with the
`gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles map one-to-one to labels of the same name
(`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`,
`wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` at the repo root, ADRs under `docs/adr/`. See
`docs/agents/domain.md`.

### Build workflow

Read `docs/agents/workflow.md` before touching code. Non-negotiable summary:

- Branch per ticket (`ticket/NN-slug`) off `integration`; `main` moves only at
  a phase gate. Never commit directly to `main` or `integration`.
- One ticket per session. When the ticket is done and reviewed, stop and report
  the next runnable ticket; never start it in the same session.
- Completion is evidence, not a status change: tick the criteria, attach the
  §31 report and close with `bun run scripts/complete-ticket.ts <issue> <report>`.
  Never close a ticket without a passing suite; closing unblocks dependents.
- `/code-review` on every ticket, `/improve-codebase-architecture` at every
  phase gate.
- Review the proof, not the diff. Drive the running app in a browser, click
  every route and button, capture console/network logs and screenshots under
  `docs/proof/<NN>-<slug>/`, and give each finding the artifact that shows it.
  The diff is read only to locate a cause. A diff over ~300 lines means split
  the ticket. Details in `docs/proof/README.md`.
- Reuse before writing: a second caller extracts a shared helper instead of
  copying. No near-duplicate code, no dead code.
- Comments only where code cannot explain itself, one or two lines.
- Anything only the human can do stops the session with a single marked
  `HUMAN ACTION` block and one URL. Never poll; never fake the step.

### Type safety

`any` is a bug, not a shortcut: it means the shape of the data is unknown at a
point where the code pretends to know it.

- No `any` anywhere in first-party code, in any position: parameter, return,
  generic argument, cast.
- No `@ts-ignore`, and no `as unknown as` double assertion. Both smuggle the
  same untyped value past the compiler.
- `unknown` is allowed and expected at untrusted boundaries — upstream MCP
  responses, request bodies, parsed JSON — but it must be narrowed by a schema
  or a type guard before any property is read.
- No type assertions to bypass a mismatch. Fix the type at its source; if a
  library's types are wrong, isolate the correction in one adapter.
- `bun run typecheck` runs `scripts/check.ts`, which discovers every check in
  `scripts/checks/`. A violation fails the build. See `docs/adr/0001-ban-any.md`.

### Corrections become checks

A correction is a check, never a new paragraph. Adding a line to this file does
not prevent the mistake recurring, and a future agent can quote it back.

When review finds a mistake:

1. **Can a machine detect it?** Add `scripts/checks/<name>.ts` exporting `name`
   and `run()`. The runner discovers it; do not edit the runner. The check's
   header names the correction that created it.
2. **Can the type system express it?** Make it a type, a branded type or a
   schema, so the mistake stops compiling.
3. **Neither?** Restructure the code until the mistake is impossible. Prose is
   for direction, not enforcement.

Comments are not a place to store fixes. A note saying "quick fix" or "for now"
is a bug that outlives its author, and the next change gets built on top of it.
Write the fix in code; if a comment is needed to explain a decision, the code
is not yet clear enough.
