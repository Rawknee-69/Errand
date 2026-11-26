# ADR-0002: Corrections become checks, never prose

**Status:** Accepted (2026-11-26)

## Context

A mistake found in review is usually "fixed" by adding a sentence to the agent
instructions or the spec: a rule about naming, a warning about a pattern. That
sentence does not run. It is enforced by whoever remembers it, and the next
agent may read it as permission, quote it back, or ignore it. Worse, the
instruction grows every time something goes wrong, so the file meant to guide
becomes a sediment of past incidents that nobody can hold in their head.

The same failure happens one level down with comments. A quick fix recorded as
a comment — "for now", "temporary", "hack" — survives the fix. The next change
reads the comment as a statement about how the code *is*, builds on it, and the
workaround becomes architecture.

## Decision

1. **A correction is a check, a type, or a restructure.** In that order of
   preference:
   - a check in `scripts/checks/`, discovered by `scripts/check.ts`, which
     fails the build;
   - a type or schema that makes the mistake uncompilable;
   - a restructure that makes the mistake impossible.
2. **Never a new paragraph.** AGENTS.md, the workflow and the spec give
   direction, not enforcement. A rule added there that a check could express is
   a deviation to fix, not a policy to follow.
3. **Each check names its correction** in a header comment, so the suite is the
   register of mistakes the project has already paid for.
4. **Comments do not store fixes.** No unreferenced TODO/FIXME/HACK/workaround/
   quick-fix/for-now language, no commented-out code, and no file that is more
   comment than code (20% of non-blank lines).
5. **Deleting a check is a decision**, recorded in an ADR. Deleting it because
   it fails is not allowed.

## Consequences

- A correction costs more to make: writing a check is slower than writing a
  sentence. That cost is the point, and it is paid once per mistake kind.
- Some corrections become type or interface changes that ripple further than a
  comment would. That ripple is the mistake's real size becoming visible.
- A check can be wrong: too broad, or detecting the surface instead of the
  cause. Fixing the check is allowed; weakening it to pass is not, which is why
  the runner prints "Fix the cause, not the check."
- The comment-density limit will occasionally flag a legitimately comment-heavy
  file, such as a security note. The answer is to move the reasoning into a
  named check or an ADR, which is where it belongs anyway.
- The checks themselves are exempt from the checks they define, because they
  must name the patterns they forbid. That exemption is one directory wide and
  is visible in `scripts/checks/_shared.ts`.
