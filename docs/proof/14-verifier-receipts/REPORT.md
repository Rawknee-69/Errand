# #14 session report

Ticket: **P6 · Verifier, undo and receipts**
Branch: `ticket/14-verifier-receipts`, cut from `integration` at `1e7daa9`,
rebased onto `3b2a862` after #13 merged.

## What this branch changes

- `apps/gateway/src/receipts/verifier.ts` — the adapter contract
  (`VerifierAdapter`), the mock-calendar adapter and one `verifyChange` entry
  point. No adapter, or a failed re-read, yields `unverified`; never a success
  claim.
- `apps/gateway/src/receipts/receipts.ts` — receipt persistence, the receipt
  view, and `applyUndo`. Undo is claimed atomically, its own result is verified
  and stored on the undo row, and only a `matched` undo sets `appliedAt`.
  Mismatched or unverified undos stay retryable and are journaled as
  `undo.mismatched`.
- `apps/gateway/src/agent/forward.ts` — after a write/delete, re-reads the
  connector, records a receipt and creates an undo row only when the adapter
  supplies an inverse. A receipt-persistence failure is journaled as
  `receipt.failed` rather than turning an already-applied change into a failed
  call.
- `apps/gateway/src/app.ts` — `GET /api/receipts`, `GET /api/receipts/:id`,
  `POST /api/receipts/:id/undo`.
- `packages/shared/src/index.ts` — `verificationOutcomeSchema`,
  `receiptViewSchema`, `receiptListResponseSchema`, `undoApplyResponseSchema`.
- `apps/gateway/src/db/schema.ts` + `drizzle/0008_good_rhino.sql` — receipts
  gain `tool_class` and `irreversible`; undo rows gain `started_at`,
  `verification` and `summary`.
- `apps/mock-services/src/server.ts` — the mock calendar keeps real event state
  (so a create and a delete can be read back) and a
  `POST /mock/calendar/fault` switch for the forced-mismatch proof.
- `apps/gateway/tests/agent/forward.test.ts` — five receipt/undo tests plus a
  retry-after-mismatch test.
- `docs/proof/14-verifier-receipts/` — `PROOF.md`, driver, logs and screenshots.

No dependency or version changes.

## Commands run

```powershell
bun install
bun run typecheck
bun test
bun apps/mock-services/src/index.ts                 # PORT=4121
bun apps/gateway/src/index.ts                       # PORT=8841, temp DB
bun run --cwd apps/web dev -- --port 5191
bun docs/proof/14-verifier-receipts/drive.ts
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

 373 pass
 0 fail
 1296 expect() calls
Ran 373 tests across 45 files. [6.77s]
```

## Acceptance criteria

- **A mock-calendar adapter verifies a create by reading state back and
  comparing.** `create_event` reads `list_events`, finds the returned id and
  compares title and start. Matched create: `logs/drive.txt` step 4.
- **A forced mismatch is reported as mismatched, not as success.**
  `drop_write` makes the calendar accept the create without persisting it; the
  receipt is `mismatched`: `logs/drive.txt` step 6.
- **Undo exists only where an inverse is defined, is itself verified, and is
  journaled.** The calendar create supplies `delete_event`; the undo runs it,
  re-reads the list, persists the undo verification, and writes
  `undo.applied`. Interrupting the delete gives `mismatched`, `appliedAt: null`,
  then a retry matches: `logs/drive.txt` steps 5 and 5b.
- **No adapter yields unverified, and the receipt says so plainly.** The
  legacy-SSE dine-out connector produces “No verifier is installed for Dine
  out, so this change is unverified. No undo is available for this change.”
  (`logs/drive.txt` step 7).
- **Irreversible actions are labelled irreversible in the receipt.** A
  calendar delete is `matched`, `irreversible: true`, `undo: null`, and its
  summary ends “This cannot be undone.” (`logs/drive.txt` step 8).

## Proof

`docs/proof/14-verifier-receipts/PROOF.md` — verdict `pass`, with the real MCP
client transcript, receipts API JSON, journal verification, desktop live-feed
screenshots, console and network logs.

## Code review

`/code-review` ran both axes over the diff and its findings were addressed:

- **Spec:** receipt now says “No undo is available” for a write with no
  inverse; undo verification is persisted on the undo row; a mismatched undo no
  longer sets `appliedAt`; the undo guard is an atomic compare-and-set; a
  receipt failure no longer masks a completed change.
- **Standards:** tests use the shared `receiptViewSchema`; the duplicated verify
  pipeline collapsed into `verifyChange`; the connector target clump became
  `connectorTarget`; the inverse schema has one home; the receipt row is read
  back instead of hand-rebuilt; `errandType` no longer falls back to `""`; the
  inverse's class comes from the adapter, not a hardcoded `"delete"`.

## Unverified

- Phone viewport 390×844 was not re-driven: this ticket adds no UI code. The
  only visible surface is the existing live feed, which already renders
  `receipt.created`; the Receipts screen is #19.
- Send and spend receipts wait on #12's outbox/spend tap, which still returns
  `not_forwarded`. The irreversible label was proven on `delete`.
- Only the mock calendar has an adapter, as the spec allows.

## Next

Runnable after this closes: **#15** (branch `ticket/15-trust-ledger`). **#12** is
also unblocked today but belongs to another session.

Next: /implement 15  (branch ticket/15-trust-ledger)
Or:   /implement 12  (branch ticket/12-outbox-spend-tap)
