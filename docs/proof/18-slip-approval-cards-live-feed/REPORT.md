# Ticket #18 — P7 · Slip approval cards and live feed

## Files built

Gateway

- `apps/gateway/src/feed/events.ts` — reads the journal for one user after a
  cursor and converts each row to the shared `FeedEvent`; no second event store.
- `apps/gateway/src/feed/stream.ts` — the SSE tail loop: replay from the cursor,
  write each journal event with its sequence as the SSE id, and send a
  `: keep-alive` comment when idle so the connection survives a demo pause.
- `apps/gateway/src/app.ts` — `GET /api/events`, accepting the browser's
  `Last-Event-ID` header or a `since` query cursor; a malformed cursor is a 400.
- `apps/gateway/src/config.ts`, `src/index.ts` — `idleTimeout: 120` on
  `Bun.serve`; the default 10-second timeout cut an idle feed.
- `apps/gateway/src/agent/request.ts` — the `slip.requested` journal payload now
  carries the goal, so the feed can say what was asked instead of repeating
  “An agent asked for permission”.
- `apps/gateway/src/agent/limits.ts` — `ClampedLimit` now comes from the shared
  `limitClampSchema`, the same shape the feed renders.
- `packages/shared/src/index.ts` — `feedEventSchema` / `feedPayloadSchema`,
  `limitClampSchema`, and `slipListResponseSchema`.
- `apps/gateway/tests/feed/feed.test.ts`, `tests/support/sse.ts` — feed scoping,
  parsed and unparseable payloads, replay from `Last-Event-ID`, live append,
  heartbeat, cursor refusal, and the idle-timeout/heartbeat invariant.
- `apps/gateway/tests/vault/leak.test.ts` — the cross-cutting leak test now reads
  one SSE frame instead of hanging on a stream that never ends, and scans that
  frame for the seeded secret.
- `apps/gateway/tests/agent/request.test.ts` — the request journal carries the
  goal and the server clamps.

Web

- `apps/web/src/screens/Slips.tsx` — pending cards (goal, tools, classes,
  `It can` / `It cannot`, caps, expiry), cap editing, approve, deny, trim
  records, decided list, decision panel, live feed, loading/error/empty states.
- `apps/web/src/feed.ts` — plain-language feed items for approvals, calls
  (allowed, succeeded, failed, not forwarded, denied, scope violations), denials,
  burns, receipts, journal checks, server clamps and unknown events; dedupe,
  newest-first ordering and frame parsing.
- `apps/web/src/slips.ts` — trim wording, state label/tone and cap validation.
- `apps/web/src/format.ts` — the single formatter home for money, calls, time
  left and feed clock.
- `apps/web/src/useLiveFeed.ts` — one EventSource per screen, native reconnect,
  live/reconnecting status, deduped event state.
- `apps/web/src/useSlips.ts` — list plus pending card details, newest-first
  decided list, stale-request guard and optimistic removal after a decision.
- `apps/web/src/api.ts` — typed slip list/detail/approve/deny calls and the single
  `EVENTS_PATH`.
- `apps/web/src/App.tsx`, `src/navigation.ts` — the Slips screen replaces its
  placeholder; no second navigation source.
- `apps/web/src/styles.css` — cards, caps, can/cannot lists, trims, decided rows,
  feed tones/status, sticky desktop feed and phone layout.
- `apps/web/index.html`, `src/screens/Login.tsx` — the two console fixes found
  during proof: an inline empty favicon and a hidden owner username field.
- `apps/web/tests/feed.test.ts`, `slips.test.ts`, `format.test.ts` — the feed
  wording, clamping, trim/state wording, cap validation and formatters.

Proof

- `docs/proof/18-slip-approval-cards-live-feed/` — `PROOF.md`, 16 screenshots,
  browser drive, SSE idle capture, phone metrics, console/network logs, setup and
  injection scripts.

## Commands run

```
bun install
bun run typecheck
bun test
bun run --cwd apps/web build
PORT=4111 bun apps/mock-services/src/index.ts
PORT=8831 DATABASE_PATH=docs/proof/18-.../proof.db ALLOW_LOCALHOST_DEV=true \
  DEMO_MODE=true SESSION_COOKIE_SECURE=false bun apps/gateway/src/index.ts
GATEWAY_URL=http://127.0.0.1:8831 bun run --cwd apps/web preview -- --host 127.0.0.1 --port 5183
bun docs/proof/18-slip-approval-cards-live-feed/setup.ts
bun C:/Users/Rem/AppData/Local/Temp/opencode/pw18/run-proof.ts
```

The SQLite proof database is ignored by `*.db`; keys, the session cookie and the
agent key lived only in the process environment and an untracked temp file.

## Test output

```
$ bun run typecheck
@errand/shared typecheck: Exited with code 0
@errand/mock-services typecheck: Exited with code 0
@errand/web typecheck: Exited with code 0
@errand/gateway typecheck: Exited with code 0
✓ 4 checks passed: comments, installed, no-any, oauth-verifier

$ bun test
 357 pass
 0 fail
 1130 expect() calls
Ran 357 tests across 45 files.

$ bun run --cwd apps/web build
✓ 133 modules transformed.
dist/index.html                   0.53 kB │ gzip:   0.32 kB
dist/assets/index-B3w9d6gR.css   16.39 kB │ gzip:   4.15 kB
dist/assets/index-mZUnZ9Wv.js   358.01 kB │ gzip: 107.08 kB
✓ built in 116ms
```

Raw captures: `logs/typecheck.txt`, `logs/test-output.txt`,
`logs/web-build.txt`.

## Proof

- `PROOF.md` — verdict pass; one high finding found and fixed during proof
  (Bun's 10-second idle timeout), two low console fixes, one deliberate 500.
- `logs/sse-idle.txt` — three heartbeats over 35 seconds, then live feed ids
  18–22 on the same connection.
- `logs/browser-drive.txt` — full walkthrough, including the idle step and the
  390×844 measurements.
- `logs/phone-metrics.json` — 390 px scroll width, tab bar at 844, zero visible
  targets under 44 px.
- `logs/browser-console.txt` — only the deliberate 500; no favicon 404, no
  autofill warning.
- `logs/network.txt` — only the deliberate 500 and navigation-aborted SSE
  connections.
- Screens: `01`–`10` desktop walkthrough, `11`–`12` phone, `13` desktop final,
  `14` empty state.

## Versions changed

None. No dependency was added, removed or bumped.

## Review findings addressed

Standards:

- `TrimList` re-implemented `describeTrim`; it now renders the shared function's
  text and the unreachable reason fallback is gone.
- `formatMoney` was a copy of `formatDollarsInput` with a `$` prefix; it now calls
  it. Money, calls, time-left and clock formatting moved from
  `slips.ts`/`feed.ts` to the existing `format.ts`, so the formatter home is
  honest.
- Removed unused exports `CapEdits`, `CapParseResult`, `SlipsView`.
- The gateway restated the feed payload shape with a private
  `z.record(z.string(), z.unknown())`; it now uses shared `feedPayloadSchema`.
- After rebasing onto #11, the feed gained `call.succeeded`, `call.failed` and
  `call.not_forwarded` wording and tests, so forwarded results are not generic
  fallback rows.
- `slipStateLabel` and `slipStateTone` were two cascades over `SlipState`; they
  are one `slipStateView`.
- Receipt tone was two copies of the same ternary; it is one
  `verificationTone`.
- `/api/events` was hard-coded in the hook; it is one `EVENTS_PATH` in `api.ts`
  beside the other routes.
- The two SSE test readers became `tests/support/sse.ts`; the leak test uses it
  and no longer pops a sample with `Bun.sleep`.
- `useLiveFeed` assigned its callback ref during render; it now does it in an
  effect.
- `slip.requested` now journals the goal, so the feed stops showing three
  identical “An agent asked for permission” rows.
- Server clamps are now a shared `limitClampSchema` and render in the
  `slip.requested` feed item, e.g. `Calls 900 → 50 (server maximum)`.
- Deny still takes one tap and sends no reason. The API and feed accept a reason,
  but a reason field on the phone card would slow the decision the ticket is
  about; this is deliberate, not an oversight.
- `useSlips` filters the same slips twice on purpose: a slip can expire between
  the list read and its detail read. The comment now says so.
- The diff is over the workflow's ~300-line review threshold. It is one vertical
  slice (the screen, its feed and the transport they need); the behaviour diff is
  ~700 lines excluding the stylesheet and proof artifacts. Recorded below as a
  deviation.

Spec:

- The first idle run failed: Bun's default 10-second request timeout closed the
  SSE stream before the 15-second heartbeat. Fixed with `idleTimeout: 120`, a
  10-second heartbeat and a test that the timeout outlives three heartbeats.
  Re-driven for 35 seconds with three heartbeats and live events.
- Server clamps had no UI; the feed now shows what was capped and why, and the
  proof creates a request that asks for 900 calls / $1,000 to drive it.
- Burns, receipts and verify events have no producer in this branch; the feed is
  a generic journal tail and the proof injects valid journal rows to drive those
  render paths. Recorded under **Not proven**.
- The feed opens with the journal's recent history rather than an empty pane. That
  is deliberate: the journal is the event source, so the feed is a superset of
  the six required categories rather than a second filtered store.
- Reconnect after a dropped server was not driven in the browser; replay from
  `Last-Event-ID` is covered by the gateway test, and a page reload was driven.
- The empty state was added to the proof with a brand-new demo guest.

## Deviations / not done

- Non-generated diff is above the ~300-line review threshold. One screen plus its
  SSE transport; both review axes were run over the whole diff.
- The in-app browser and Playwright MCP could not launch: this machine has no
  Chrome at the MCP server's configured path. Proof used Playwright 1.65.1 with
  the already-installed Chromium 1255 directly, at real 1440×900 and 390×844
  viewports. It is still a real browser, not device emulation.
- The proof scripts (`setup.ts`, `live-call.ts`, `inject.ts`, `sse-idle.ts`) live
  under `docs/proof/18-.../`; the browser driver lives in an untracked temp
  directory and is transcribed in `logs/browser-drive.txt`.
- Burn, receipt and journal-verify producers are later tickets. The feed handles
  them generically; the proof injected rows to exercise delivery and rendering.

## Unverified

- Upstream forwarding, the 256 KB result cap, per-call timeout and per-connector
  concurrency are #11's; that ticket merged while this one was in progress, and
  the final proof ran against its forwarder. The forwarder's own limits were not
  re-driven here.
- Real Notion, Linear or calendar endpoints; the mock calendar was used.
- A physical phone; the 390×844 pass is a Chromium viewport.
- Browser EventSource reconnect after killing the gateway under an open feed;
  only `Last-Event-ID` replay and page reload were exercised.

## Next

Closing #18 leaves the remaining P7 work and the P8/P9 tickets. The next runnable
ticket is printed by `complete-ticket.ts` after this report is attached.
