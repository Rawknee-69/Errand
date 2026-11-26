# Ticket #13 — P5 · Decoys, burns and scope-violation escalation

## Files built

- `apps/gateway/src/policy/burn.ts` — `recordViolation`: the first scope
  violation is counted and journaled; a decoy or a second scope violation burns
  the slip in the same transaction. Burning sets `state = burned`, clears
  `capabilityHash`, stamps `burnedAt`/`burnedReason`, demotes the errand type's
  trust row to `learner` with `cleanRuns = 0`, and appends `slip.burned`.
- `apps/gateway/src/db/schema.ts`, `apps/gateway/drizzle/0007_green_sleeper.sql`
  — `slips.scope_violations`, the per-slip escalation counter.
- `apps/gateway/src/agent/call.ts` — the decision boundary routes decoy and
  out-of-scope denials through `recordViolation`; every other denial still
  journals as before.
- `apps/gateway/src/policy/pipeline.ts` — a burned denial carries the slip's
  burn reason and timestamp.
- `apps/gateway/src/agent/mcp.ts` — the burned refusal now includes
  `slip_state`, `burned_reason` and `burned_at` alongside the error code.
- `apps/gateway/src/agent/status.ts` — `errand_status` reports `burnedAt` and
  `burnedReason`, and never a capability for a burned slip.
- `apps/gateway/tests/agent/call.test.ts` — all three decoys burn and demote,
  the first vs second scope violation, capability revocation, the structured
  burned error, and the status view.
- `apps/gateway/tests/policy/burn-proof-drive.ts` — the live MCP/SSE driver.
- `docs/proof/13-decoys-burns/` — `PROOF.md`, transcript, server logs,
  screenshots, test and typecheck output.

## Commands run

```
bun install
apps/gateway/node_modules/.bin/drizzle-kit generate      # from apps/gateway
bun run typecheck
bun test
$env:PORT=4123; bun run apps/mock-services/src/index.ts
$env:PORT=8843; DATABASE_PATH=docs/proof/13-decoys-burns/proof.db ...
bun run apps/gateway/src/index.ts
$env:OWNER_PASSPHRASE=proof-passphrase; bun apps/gateway/tests/policy/burn-proof-drive.ts \
  http://127.0.0.1:8843 docs/proof/13-decoys-burns/proof.db http://127.0.0.1:4123
$env:GATEWAY_URL=http://127.0.0.1:8843; bun run --cwd apps/web dev
```

The gateway ran with `ALLOW_LOCALHOST_DEV=true` and
`SESSION_COOKIE_SECURE=false` for the loopback proof.

## Test output

```
$ bun run typecheck
@errand/shared typecheck: Exited with code 0
@errand/mock-services typecheck: Exited with code 0
@errand/web typecheck: Exited with code 0
@errand/gateway typecheck: Exited with code 0
✓ 4 checks passed: comments, installed, no-any, oauth-verifier

$ bun test
 367 pass
 0 fail
 1241 expect() calls
Ran 367 tests across 45 files.
```

## Proof

- `docs/proof/13-decoys-burns/PROOF.md` — environment, steps, findings,
  verdict, and what was not proven.
- `docs/proof/13-decoys-burns/logs/burn-transcript.txt` — the live MCP client
  transcript: three decoy burns, demotion, revoked capabilities, structured
  burned errors, the first/second scope escalation, four live SSE burn frames
  and `{ok:true, checked:24}` from `/api/journal/verify`.
- `docs/proof/13-decoys-burns/screens/01-slips-burned.png` — the control panel
  listing four burned slips with their reasons.
- `docs/proof/13-decoys-burns/screens/02-live-feed-burns.png` — the live feed
  showing the burns and scope violations without a refresh.
- `docs/proof/13-decoys-burns/logs/gateway-server.txt`,
  `logs/mock-services.txt`, `logs/web-server.txt` — the same window.
- `docs/proof/13-decoys-burns/logs/test-output.txt`,
  `logs/typecheck.txt` — the full suite and typecheck above.

## Review

`/code-review` against `origin/integration...HEAD` with two independent
sub-agents.

### Standards

> 1. **`agent/call.ts` — dead code + second home.** After the early `return` on
>    `decoy`/`out_of_scope`, the `out_of_scope → call.scope_violation` branch can
>    never fire. The violation→event mapping lived in both `call.ts` and
>    `burn.ts`.
> 2. **Stale comment.** "every admission and every denial reaches the journal …
>    in one place" became false once violations journaled from `burn.ts`.
> 3. **Re-implemented scoped reads.** Hand-written `select…where(userId, id)`
>    in `burn.ts` duplicated `getSlip`/`getTrust`.
> 4. **Unused exports / speculative abstraction.** `BurnReason`,
>    `ViolationKind`, `ViolationInput`, `ViolationResult` were exported but not
>    imported; the result was discarded by its only caller.
> 5. **Proof logs.** `PROOF.md` claimed no console errors without a
>    `console.log`/`network.log`; the transcript was committed as binary
>    (UTF-16), not readable text.
> 6. **Diff size.** ~870 non-generated changed lines against the ~300 guidance.
>
> Judgement calls: duplicated update/journal blocks and repeated
> `kind === "decoy"` switches in `burn.ts`; `{reason, at}` primitive clump;
> `kind: "scope"` vs `reason: "out_of_scope"`; unreachable missing-row branch;
> optional chaining for a value guaranteed by the reason; hand-rolled test
> trust query.

### Spec

> 1. **Only `out_of_scope` counts as a scope violation.** `class_mismatch`,
>    `constraint_denied`, `missing_allowlist` and `tool_unavailable` never
>    escalate.
> 2. **Demotion leaves `trust.caps` intact**, so a licence-era capability set
>    survives the demotion.
> 3. **A missing trust row is created, not demoted**, fabricating trust history.
> 4. Not asked for: `errand_status` burn fields, the 264-line proof driver under
>    `tests/policy`, and an unused `ViolationResult`.
> 5. **Dead branch** and stale comment (same as Standards 1–2).
> 6. **Clock split:** `burnedAt` used the injected `now`, while the journal
>    stamped its own real time, so the row and its audit event could disagree.
> 7. **The burning call reported no burn:** only the next call saw
>    `slip_state`/`burned_reason`; the decoy or second violation that caused the
>    burn returned `{tool}` alone.

### Resolutions

- Removed the unreachable `out_of_scope` journal branch; `call.ts` now only
  journals admissions and non-violation denials, and its comment says so.
- `burn.ts` takes `reason: "decoy" | "out_of_scope"` directly from the denial,
  so there is no `"scope"` bridge and the event mapping has one home.
- One conditional slip update instead of two, with a single aliased
  `slipFilter`; the trust update is one statement. Transaction-bound reads
  cannot use the `Db`-typed `getSlip`/`getTrust` helpers, so the where clauses
  are aliased rather than copied.
- `recordViolation` returns `{ burned, burnedAt }`; `submitCall` attaches it to
  the triggering decision, so the decoy or second violation itself returns
  `slip_state`, `burned_reason` and `burned_at`.
- The burn event's `createdAt` is written to `burnedAt`/`updatedAt`, so the slip
  and its audit event cannot disagree.
- Demotion now clears `caps` to `{}` and updates an existing trust row only; a
  missing row is left alone because the type is already learner.
- Removed unused exports; tests use `getTrust` rather than a hand-rolled query.
- Proof logs are UTF-8 text; `logs/console.txt` and `logs/network.txt` exist;
  screenshots were retaken against the final proof database.
- Diff-size deviation: the ticket's source is ~170 lines across six modules
  plus 160 test lines and the 264-line live proof driver. Splitting a single
  policy behaviour (decoy burn + second-strike escalation) would leave either
  half untestable at the MCP seam, so it was reviewed as one ticket and this
  deviation is recorded here rather than silently accepted.

## Unverified

- Phone viewport 390×844 was not driven; the attached browser has no viewport
  control and the Playwright server has no Chrome installed. No UI changed.
- Two simultaneous scope violations were not raced against the file-backed
  proof database; the counter and burn are one SQLite transaction and the
  in-process suite covers the sequential escalation.

## Next

Pending the frontier printed by `scripts/complete-ticket.ts`.
