# Ticket #10 — P4 · Policy pipeline steps 1–11

## Files built

- `apps/gateway/src/policy/pipeline.ts` — the ordered deny table as one
  function: ownership, capability, approval state/expiry, signature, decoy,
  scope, tool status, connector health, class, argument schema, constraint
  allowlists, then atomic cap reservation. Nothing forwards.
- `apps/gateway/src/policy/capability.ts` — `checkCapability` now reports the
  first reason a capability fails (`not_approved`, `slip_denied`, `expired`,
  `burned`, `capability_invalid`); `verifyCapability` remains the boolean
  wrapper.
- `apps/gateway/src/policy/arguments.ts` — Ajv validation of the pinned
  upstream schema (draft-07 and 2020-12), compiled once and cached, failing
  closed when a schema cannot be compiled; `requiredArguments` exposes the
  top-level required list for the send rule.
- `apps/gateway/src/policy/constraints.ts` — parses the slip's per-tool argument
  allowlists and enforces them; a send needs an allowlist, and every required
  argument of a send must be allowlisted.
- `apps/gateway/src/policy/reservation.ts` — one conditional `UPDATE` that
  reserves calls, rate-window calls and spend together inside a transaction, so
  concurrent attempts cannot overshoot.
- `apps/gateway/src/policy/{json,spend}.ts` — the one JSON-object parser and the
  one `cents` spend-amount convention.
- `apps/gateway/src/policy/rate.ts` — the 60-second window and the 20 calls/
  minute default, one home for both.
- `apps/gateway/src/agent/call.ts` — `submitCall` is the decision boundary: it
  runs the pipeline and journals every admission and denial with its reason in
  one place; a scope violation is its own event type.
- `apps/gateway/src/agent/mcp.ts` — `errand_call` now takes `capability` and
  `arguments`, returns the structured `not_forwarded` result, and maps a denial
  to `isError: true` with the reason.
- `apps/gateway/src/db/schema.ts`, `drizzle/0006_right_dormammu.sql` — the
  signed `rate_cap` plus the rolling `rate_window_started_at` /
  `rate_window_calls` counters.
- `apps/gateway/src/policy/slip-signing.ts`, `src/agent/request.ts` — the rate
  cap is part of the signed slip document and is set at request time.
- Tests: `apps/gateway/tests/agent/call.test.ts` (the deny table over a real MCP
  client, including eight concurrent calls against a cap of three), plus updates
  to `tests/agent/{mcp,proof-drive}.test.ts`, `tests/policy/{capability,slip-signing}.test.ts`
  and `tests/agent/support.ts`.
- Proof driver: `apps/gateway/tests/policy/proof-drive.ts`.
- Proof: `docs/proof/10-policy-pipeline/` (`PROOF.md`, MCP transcript, server
  windows, typecheck and full-suite output).
- `docs/VERSIONS.md` — `ajv` moved from "verified but not installed" to
  installed at 8.20.0.

## Commands run

```
bun install --frozen-lockfile
bun add ajv@8.20.0                            # in apps/gateway
bunx drizzle-kit generate                     # apps/gateway, adds 0006 after rebase
bun run typecheck
bun test
bun run apps/mock-services/src/index.ts        # PORT=4120
bun run apps/gateway/src/index.ts              # PORT=8840, proof env
bun apps/gateway/tests/policy/proof-drive.ts http://127.0.0.1:8840 <proof.db> http://127.0.0.1:4120
```

`ticket/10-policy-pipeline` was rebased onto `origin/integration` after ticket
#17 merged. Ticket #17 had also claimed `0005`, so this ticket's migration was
regenerated as `0006_right_dormammu.sql` on top of the merged schema.

## Test output

```
$ bun run typecheck
@errand/shared typecheck: Exited with code 0
@errand/mock-services typecheck: Exited with code 0
@errand/web typecheck: Exited with code 0
@errand/gateway typecheck: Exited with code 0
✓ 4 checks passed: comments, installed, no-any, oauth-verifier

$ bun test
 322 pass
 0 fail
 951 expect() calls
Ran 322 tests across 41 files.
```

## Proof

- `docs/proof/10-policy-pipeline/PROOF.md` — verdict: pass.
- `logs/policy-transcript.txt` — real login, agent key, two live mock MCP
  servers, then: admitted call `not_forwarded` with caps consumed, scope
  violation, forged capability, call cap, spend cap, rate cap, send without an
  allowlist, tampered signature, changed tool, unhealthy connector, journal
  reasons and `{ok:true, checked:33}`.
- `logs/gateway-server.txt`, `logs/mock-services.txt` — clean window.
- `logs/test-output.txt`, `logs/typecheck.txt` — full output.
- `calls` rows: 0 — no upstream call is claimed or performed.

## Versions changed

- Added `ajv` 8.20.0 to the gateway (`latest`, checked with `npm view ajv
  dist-tags`, recorded in `docs/VERSIONS.md`). No package was upgraded,
  downgraded or removed.

## Review findings addressed

Standards:
- `checkCapability` replaced the boolean-plus-option split, so expiry has one
  home and the pipeline journals the precise capability failure reason.
- `rate.ts` is the single home for the window and the default; the DB default,
  `AGENT_LIMITS` and the reservation import it.
- The duplicated state-reason/message pair is gone; spend amount extraction is
  one function used only for spend-class tools.
- Removed the unused `ConstraintDenial.argument` field and the local
  `RATE_WINDOW_MS` export; simplified the Ajv error path.
- Every denial in `call.test.ts` now also asserts the journaled reason, not just
  the MCP error.
- A send needs a non-empty allowlist (the ticket's literal rule); allowlists
  constrain supplied values, and an absent optional argument is left to the
  argument schema rather than denied by the constraint check.
- Second pass: the duplicated proof-drive `step`/`parse`/`human` helpers moved
  to `tests/support/proof-drive.ts` for all three drivers; all journaling moved
  to the `submitCall` decision boundary; `CallDenialReason` reuses
  `CapabilityFailure`; `slip_not_approved` was renamed to `not_approved`; JSON
  object parsing and the `cents` spend convention each have one home; tests now
  assert journal payloads as parsed objects and read counters through
  `errand_status` rather than the database; a two-process test
  (`tests/policy/reserve-worker.ts`) proves the guarded update cannot overshoot
  when two processes race the same slip.

Spec / scope notes:
- Decoy denial and its journal row are here; burning the slip, revoking the
  capability and demoting the errand type are ticket #12.
- Class-specific handling (send hold, spend tap) and forwarding are tickets
  #11/#13; this ticket deliberately ends at `not_forwarded`.
- The rate cap is the "rate" half of the ticket's "calls, rate and spend"; it is
  a server ceiling set at request time, signed with the slip, and not
  agent-adjustable.

## Unverified

- The live transcript does not repeat every deny-table row; the in-process MCP
  tests cover the remaining states (denied, burned, unknown/mismatched class,
  argument-schema failure, allowlist value denial) at the same seam.
- Concurrency is proven in-process (eight simultaneous calls against a cap of
  three); no multi-process race was driven against a file-backed database.
- HMAC key rotation is still not implemented; changing `HMAC_KEY` invalidates
  existing signatures and capabilities.

## Next

`/implement 11` (branch `ticket/11-forwarder`) — the first ticket unblocked when
#10 closes. #12 is also unblocked by #10 and #9.
