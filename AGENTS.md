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
- Reuse before writing: a second caller extracts a shared helper instead of
  copying. No near-duplicate code, no dead code.
- Comments only where code cannot explain itself, one or two lines.
- Anything only the human can do stops the session with a single marked
  `HUMAN ACTION` block and one URL. Never poll; never fake the step.
