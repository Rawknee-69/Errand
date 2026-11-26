# ADR-0001: No `any`, and the strictest compiler settings the code passes

**Status:** Accepted (2026-11-26)

## Context

The gateway decides whether to forward a call, how to count a cap, and which
credential to use. Every one of those decisions depends on knowing the exact
shape of the data in hand. `any` removes the compiler from that job, so a
mistyped field, a renamed upstream property or a `null` that was assumed away
becomes a runtime failure in the one component that must not fail silently.

TypeScript's `strict` is necessary but not sufficient. It permits explicit
`any`, and it permits `@ts-ignore` and `as unknown as`, which are the same
escape hatch spelled differently.

The brief's "no extra frameworks" rules out adding ESLint purely for
`no-explicit-any`, and TypeScript 7 is the native compiler, which exposes no
JavaScript AST for a custom rule.

## Decision

1. `any` is banned in all first-party TypeScript, in every position.
2. `@ts-ignore` and `as unknown as` are banned for the same reason.
3. `unknown` is the correct type at an untrusted boundary, and must be
   narrowed by a schema or type guard before use.
4. `bun run typecheck` runs a repository check (`scripts/check-types.ts`) after
   the workspace typechecks, so a violation fails the build rather than
   surviving review.
5. The compiler runs with `strict`, `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`,
   `noUnusedLocals`, `noUnusedParameters`, `allowUnreachableCode: false` and
   `allowUnusedLabels: false`.

## Consequences

- A library with inaccurate types now needs one local adapter that converts
  its values into a typed shape, instead of casts scattered at call sites.
- Some refactors surface real `undefined` cases that `any` used to hide; those
  are the bugs the rule exists to find.
- The check is textual after blanking comments and strings, because no AST is
  available. It is deliberately narrow — it flags the token `any`, the
  directive `@ts-ignore` and the phrase `as unknown as` — so its false
  positives are limited to those exact spellings in code.
- Reversing this decision means deleting a rule from the standards, the check
  and this ADR; it is not something to relax quietly in one file.
