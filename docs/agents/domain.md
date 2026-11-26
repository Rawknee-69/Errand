# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout: single-context

`GLOSSARY.md` at the repo root, and ADRs under `docs/adr/`. The repo is a
bun-workspaces monorepo (`apps/gateway`, `apps/web`, `apps/mock-services`,
`packages/shared`), but it is one bounded context with one vocabulary —
Errand's — so per-package glossaries would duplicate it.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

If either doesn't exist, **proceed silently**. Don't flag the absence; don't
suggest creating them upfront. The `/domain-modeling` skill creates them lazily
when terms or decisions actually get resolved.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor
proposal, a hypothesis, a test name), use the term as defined in
`GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

The Errand vocabulary is load-bearing, not decorative: words like *slip*,
*tier*, *catalog*, *connector* and *decoy* each name a distinct thing, and
several pairs are easily confused (*errand* vs *slip*, *Gateway* vs *bottom
layer*). Using them loosely produces specs that read correctly and build the
wrong thing.

If the concept you need isn't in the glossary yet, that's a signal: either
you're inventing language the project doesn't use (reconsider) or there's a
real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than
silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
