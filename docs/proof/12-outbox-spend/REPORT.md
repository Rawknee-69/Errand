# Ticket #12 — P5 · Outbox and the spend tap

## Files built

- `apps/gateway/src/db/schema.ts`, `drizzle/0008_bouncy_mattie_franklin.sql`,
  `drizzle/meta/0008_snapshot.json` — the `outbox` table: one row per held
  send or waiting spend, with the capability, arguments, class, amount,
  release/expiry times, terminal state, reason and call id.
- `packages/shared/src/index.ts` — `OutboxItem`, its state and class schemas,
  and the list/response schemas shared by gateway and web.
- `apps/gateway/src/outbox/constants.ts` — the 30-second send hold, the
  five-second release grace, the five-minute spend tap window and the
  one-minute stale-claim timeout.
- `apps/gateway/src/outbox/service.ts` — the outbox behaviour: hold a send,
  wait for a spend tap, list, cancel, confirm, claim-and-release due sends,
  sweep a stale `releasing` claim, expire an item that missed its window,
  refund the call/spend reservation, and journal every transition. Release
  re-runs the policy pipeline without reserving again, so a burned, expired or
  revoked slip cannot fire. A failed forward is `failed`, never `confirmed`,
  and a spend journals `outbox.completed` with its call id and outcome.
- `apps/gateway/src/outbox/view.ts` — the scoped view with the slip goal and
  connector name.
- `apps/gateway/src/agent/forward.ts` — split the upstream forwarder from the
  class router: read/write/delete forward, send enters the outbox and spend
  enters the tap. Forwarded outcomes now carry the calls-row id.
- `apps/gateway/src/policy/pipeline.ts`, `src/policy/reservation.ts` — an
  admitted call carries its capability; `reserve: false` re-checks a held call
  without consuming a cap, and `releaseCall` refunds a cancelled or expired
  hold.
- `apps/gateway/src/agent/mcp.ts` — `errand_call` returns `held` or
  `needs_human` with the outbox id and window.
- `apps/gateway/src/app.ts` — the outbox API (`GET /api/outbox`,
  `POST /api/outbox/:id/cancel`, `POST /api/outbox/:id/confirm`), the release
  worker, error mapping and `outboxReleaseIntervalMs` (0 disables it in tests).
- `apps/gateway/src/db/scoped-reads.ts` — scoped outbox reads.
- `apps/web/src/api.ts`, `src/useOutbox.ts`, `src/components/OutboxPanel.tsx`,
  `src/screens/Slips.tsx`, `src/feed.ts`, `src/styles.css` — the Outbox and
  spend-tap panel on Slips with a live countdown, Stop it, Deny, Confirm spend,
  plain-language outcomes, phone layout and feed entries for every outbox
  event.
- Tests: `apps/gateway/tests/outbox/outbox.test.ts` (12 tests: hold, release,
  cancel with a rate-counter check, expiry, burn during the hold, needs_human
  on both tiers, confirm, deny, expired confirm, wrong action, a failed
  upstream after the tap, a stale `releasing` sweep and live SSE) and web feed
  coverage in `apps/web/tests/feed.test.ts`.
- Proof tooling: `apps/gateway/tests/outbox/proof-drive.ts`,
  `apps/gateway/tests/outbox/seed-pending.ts`.
- Proof: `docs/proof/12-outbox-spend/` (`PROOF.md`, transcript, SSE frames,
  server windows, desktop and phone screenshots, browser metrics).

## Commands run

```
bun install --frozen-lockfile
bun run --cwd apps/gateway drizzle-kit generate
bun run typecheck
bun test
$env:PORT=4122; bun run apps/mock-services/src/index.ts
$env:PORT=8843; ... bun run apps/gateway/src/index.ts
bun apps/gateway/tests/outbox/proof-drive.ts http://127.0.0.1:8843 docs/proof/12-outbox-spend/proof.db http://127.0.0.1:4122
$env:GATEWAY_URL=http://127.0.0.1:8842; bun run --cwd apps/web dev --host 127.0.0.1
```

The browser pass used Playwright Chromium at 1440×900 and 390×844 against
`http://127.0.0.1:5173`.

## Test output

```
$ bun run typecheck
@errand/shared typecheck: Exited with code 0
@errand/mock-services typecheck: Exited with code 0
@errand/web typecheck: Exited with code 0
@errand/gateway typecheck: Exited with code 0
✓ 4 checks passed: comments, installed, no-any, oauth-verifier

$ bun test
 384 pass
 0 fail
 1384 expect() calls
Ran 384 tests across 46 files.
```

The full pasted output is `docs/proof/12-outbox-spend/logs/test-output.txt`
and `logs/typecheck.txt`.

## Proof

- `docs/proof/12-outbox-spend/PROOF.md` — verdict: pass.
- `logs/outbox-transcript.txt` — a real 30-second hold released by the live
  worker with one calls row; cancel inside the window with no row and a
  refunded call; `needs_human` on learner and license spends; a separate
  confirm with one call row; a denied spend with zero spend used; an expired
  row that never fired after 32 more seconds; four findings from the browser
  pass; `{ok:true, checked:30}`.
- `logs/sse.txt` — the live feed frames for three holds, one release, two
  cancellations, two spend taps, one confirmation and one expiry.
- `screens/01-desktop-outbox.png`, `03-desktop-send-stopped.png`,
  `04-desktop-spend-confirmed.png`, `02-phone-slips.png` — the panel at both
  widths, including the Stop it and Confirm spend actions.
- `screens/browser-window.json`, `screens/02-phone-slips.json` — no console
  messages, no failed requests, and no horizontal overflow on the phone.
- Secret scan: no credential, key or passphrase in the proof logs, artifacts
  or SQLite files.

## Versions changed

None. No dependency was added, upgraded, downgraded or removed.

## Review findings addressed

Standards:
- `isPending` had two homes; it is now `isPendingOutboxState` in
  `packages/shared`, used by the service and the web hook.
- `expire()` and `cancel()` pasted the claim/refund/journal shape; one `close`
  transaction now serves both, with an explicit from-state list.
- The proof driver shadowed the shared `outboxItemSchema`; it now imports
  `outboxItemResponseSchema` and `outboxListResponseSchema`.
- The constants file tripped the comment-density check; its comments were cut
  to the one invariant the names cannot carry.
- The release worker started by default in every app instance; it is now
  production wiring only (`index.ts`), and tests drive `releaseDue` directly.
- Proof logs were captured by PowerShell as UTF-16; they are UTF-8 now.
- Deviation recorded: the diff is over the ~300-line guideline. The four
  criteria share one table, service and API; splitting them would ship a
  non-functional half. No generated files are included in that count.

Spec:
- A failed spend was stored as `confirmed` and fed as a green result. A failed
  forward is now `failed`, with `outbox.completed` carrying `call_id` and
  `outcome`; the feed reads "Spend settled" only on success.
- `outbox.confirmed` is the human tap, not the result; the UI says "Spend
  tapped" and the completion event follows. The journal now records both.
- The 60-second post-release grace made a stalled worker fire a send at ~90s.
  The grace is 5 seconds; a later item expires instead of firing.
- Cancelling refunded the rate counter, allowing a hold/cancel loop around the
  rate cap. The rate counter now stays; only the call and spend reservations
  are refunded.
- A row stuck in `releasing` after a crash was never swept. `releaseDue` now
  closes claims older than one minute as `expired` (`release_timeout`) and
  refunds them, so it can never double-fire.

## Unverified

- Multi-process outbox workers; one process claims and releases.
- The stale-claim sweep is covered in process, not by killing a real process
  mid-forward.
- The upstreams are the Pay mock; no real email or payment provider was used.
- Timing under a suspended process is covered only by the expired-row sweep.

## Next

Next: `/implement 14` (branch `ticket/14-verifier-receipts`) or `/implement 15`
(branch `ticket/15-trust-ledger`). #12 unblocks #14 and #15.
