# #15 session report

Ticket: **P8 · Trust ledger and the learner's permit**
Branch: `ticket/15-trust-ledger`, cut from `integration` at `95375ea` and
rebased onto `c24125f` after #12 (outbox and spend tap) merged.

## What this branch changes

- `apps/gateway/src/policy/trust.ts` — the trust ledger's one home: learner-row
  creation, the view (tier, clean runs, offer flag, caps), run evaluation
  (`evaluateRun`), lazy settlement at cap or expiry, the five-run offer,
  license acceptance/re-capping, and `demoteTrust`. A verdict of `pending`
  (an admitted call with no recorded row yet) leaves the run open, so neither a
  parallel call in flight nor a spend held for the #12 tap is mistaken for a
  missing call. An unclean run demotes through `demoteTrust`.
- `apps/gateway/src/agent/request.ts` — first sighting of an errand type inserts
  a learner row; a licensed type is auto-approved at request time, with the
  requested calls, spend and minutes clamped to the human's caps; the journal
  records `slip.requested` (`auto_approved`), `slip.approved` and
  `trust.license_used`.
- `apps/gateway/src/agent/forward.ts` — `settleIfFinished` settles a run when
  its last admitted call completes, so a cap-limited errand counts without a
  separate sweep. This sits in `createUpstreamForwarder`; held sends and spends
  settle when the outbox releases them, not when they are held.
- `apps/gateway/src/policy/burn.ts` — burn demotion now goes through
  `demoteTrust`, and a first scope violation demotes the type as well. The burn
  itself still needs the decoy or the second violation.
- `apps/gateway/src/receipts/receipts.ts` — a `mismatched` receipt demotes inside
  the same transaction that stores the receipt; any undo attempt, whether it
  lands or not, demotes inside the transaction that records the undo result.
- `apps/gateway/src/app.ts` — `GET /api/trust` and
  `POST /api/trust/:errandType/license`; `TrustError` maps to 404/409/400.
- `apps/gateway/src/db/schema.ts` + `drizzle/0010_gifted_bullseye.sql` —
  `slips.settled_at` makes run settlement idempotent. #12 took `0009`, so this
  migration is 0010 after the rebase.
- `packages/shared/src/index.ts` — `CLEAN_RUNS_FOR_LICENSE`, `trustCapsSchema`,
  `trustViewSchema`, `trustListResponseSchema`, `licenseAcceptResponseSchema`,
  merged alongside #12's outbox schemas.
- `apps/gateway/tests/trust/api.test.ts` — the HTTP/MCP behaviour: learner start,
  five clean runs and the offer, acceptance, auto-approval, cap clamping,
  refusal before the offer, mismatch / undo / failed-undo / scope-violation
  demotion, and a licensed spend held as `needs_human` until the human tap.
- `apps/gateway/tests/policy/trust.test.ts` — the run verdict at the pure seam.
- `apps/gateway/tests/agent/call.test.ts`, `tests/slips/approval.test.ts` — the
  trust demotion event and reason for decoys; the scope-violation test now
  expects the first violation to demote. “Last journal event” assertions were
  replaced by a filter on the event type they mean.
- `scripts/checks/journal-last-event.ts` — the new check that keeps that class
  of brittle assertion out: a test may not assert `listJournalEvents(...).at(-1)`
  directly, because another concern's event will land after it.
- `apps/gateway/tests/trust/proof-drive.ts` and `docs/proof/15-trust-ledger/` —
  the real-client transcript, screenshots and logs; the driver uses the shared
  `step` / `parse` / `humanRequests` helpers.

No dependency or version changes.

## Commands run

```powershell
bun install
bun run typecheck
bun test
bun apps/mock-services/src/index.ts          # PORT=4101
bun apps/gateway/src/index.ts                # PORT=8887, .demo/proof15.db
bun run --cwd apps/web dev -- --port 5273    # GATEWAY_URL=http://127.0.0.1:8887
bun run apps/gateway/tests/trust/proof-drive.ts
```

## Test output

```text
bun run typecheck
@errand/shared typecheck: Exited with code 0
@errand/mock-services typecheck: Exited with code 0
@errand/web typecheck: Exited with code 0
@errand/gateway typecheck: Exited with code 0
✓ 4 checks passed: comments, installed, no-any, oauth-verifier
```

```text
bun test v1.4.4 (38afee6c8)

 396 pass
 0 fail
 1439 expect() calls
Ran 396 tests across 48 files. [10.39s]
```

## Acceptance criteria

- **Errand type is derived from the tool list and constraint shape, not the
  goal.** `errandTypeFor` hashes the sorted tools and the sorted constraint key
  set; the proof drive used one goal for every request and five clean requests
  still landed on the same type (`logs/drive.txt`). The existing
  `tests/policy/errand-type.test.ts` and `tests/agent/request.test.ts` pin order,
  shape and goal independence.
- **New errand types start as learner.** `GET /api/trust` after the first
  request shows `tier: learner`, `cleanRuns: 0`, `caps: null`; the slip is
  `pending` (`logs/drive.txt`, step 3).
- **Five consecutive clean runs offer a license, and the human accepts and sets
  caps.** Five cap-limited read runs moved the count 1 → 5, journaled
  `trust.license_offered`, and `POST /api/trust/:type/license` set
  `{callCap: 2, spendCapCents: 0, minutes: 5}`. A request before the fifth run
  returns 409 (`logs/drive.txt`; `tests/trust/api.test.ts`).
- **A mismatch, undo, scope violation or decoy hit demotes and journals with its
  reason.** All paths write `trust.demoted` with `reason`, reset the tier to
  learner, the clean count to 0 and the caps to `{}`; an unclean run also
  journals `trust.run_unclean` with its verdict. The drive shows scope
  violation, undo and mismatch live (`logs/drive.txt`); the decoy event and
  reason are asserted in `tests/agent/call.test.ts`.
- **Spend still requires a human tap on a license.** A licensed slip with
  `pay__charge_card` is admitted inside its spend cap, but the call is held as
  `needs_human` with its amount (outbox, #12) and reaches no card until the human
  confirms; the trust tier stays `license`
  (`tests/trust/api.test.ts`, “a license never moves money without the human
  tap”).

## Proof

`docs/proof/15-trust-ledger/PROOF.md` — verdict `pass`, with the real MCP
client transcript, the trust API responses, the journal verify after 117
entries, and desktop feed screenshots with console and network logs. The Trust
screen remains the #19 placeholder by scope.

## Code review

`/code-review` ran both axes over `origin/integration...HEAD` in parallel
sub-agents; every hard finding was fixed and the judgement calls were weighed.

- **Standards.** The proof driver now imports `step`, `parse` and
  `humanRequests` instead of copying them, and uses the `@errand/mock-services`
  package entry. `trustView`, `ensureTrustRow`, `TrustRow`,
  `DemotionReason`, `UncleanRunReason` and `RunVerdict` stopped being exports
  with no external caller; `demoteTrust` no longer returns an unused boolean.
  `ensureLearnerTrust` takes the transactional writer directly, so the duplicate
  insert-then-select is gone. `runFinished` is one helper used by both settlement
  paths, and `settleIfFinished` replaced three copies of the same `callsRemaining`
  check. The tautological `expect(last.eventType).toBe(expected)` assertion and
  the `trust` table shadowing in the API test were removed. The brittle
  last-event pattern became `scripts/checks/journal-last-event.ts`, which also
  led to fixing four pre-existing sites in the suite.
- **Spec.** An all-failed run is now `unclean` (`call_failed`) rather than
  `empty`, so “every failure gives it back”. An unclean run demotes through
  `demoteTrust`, so a failed or unverifiable run cannot leave a license in
  place. A run with an admitted call not yet recorded is `pending` and is not
  settled: this removes the parallel-call misjudgement and keeps a spend held
  for the #12 tap from resetting trust. An undo demotes even when the inverse
  does not land. The spend tap merged as #12 before this branch was rebased; the
  updated test shows a licensed spend held as `needs_human`, so the license
  neither forwards it nor fakes a tap.

The diff is larger than the ~300-line guidance: the 312-line trust module and
~725 lines of tests/proof driver are one coherent ticket, and no behaviour
outside the ticket was added. The generated migration and snapshot are excluded
from that reading.

## Unverified

- A live licensed spend cannot be reached: the mock pay service has no
  verifier, so its receipts are `unverified` and five clean spend runs cannot be
  earned. The guard is proven at test level by seeding the license; the call is
  held as `needs_human` and trust stays `license`.
- Phone viewport 390×844 was not driven: this ticket adds no UI. The Trust
  screen and its phone proof are #19.
- The live drive did not repeat #13's decoy burn; the demotion event and reason
  for it are asserted in the test suite.
- An already-approved license-tier slip is not torn down when its type demotes.
  The type returns to learner and the next request needs a human; a slip already
  signed inside the human's caps keeps its capability until it expires or caps
  out. Revoking in-flight slips was not in the ticket and is recorded here rather
  than added silently.

## Next

Runnable after this closes: **#19** (P7 · Receipts, Trust, Journal and Agent keys
screens). #12 merged into `integration` before the rebase, so #20 still waits on
#19.

Next: /implement 19  (branch ticket/19-receipts-trust-journal-keys)
