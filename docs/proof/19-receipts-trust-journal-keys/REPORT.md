# Ticket #19 — P7 · Receipts, Trust, Journal and Agent keys screens

## Files built

Shared

- `packages/shared/src/index.ts` — `AGENT_LIMITS` (one source for the server
  ceilings the trust form may offer), `journalVerifyResponseSchema`,
  `agentKeyListResponseSchema`, `agentKeyResponseSchema`, and `tools` on
  `trustViewSchema`. The web client and the gateway now read the same shapes.

Gateway

- `apps/gateway/src/policy/trust.ts` — the trust view carries the tool names
  behind the errand-type hash, so the human can identify the kind of work a
  license applies to. No behaviour change to tiers or caps.
- `apps/gateway/src/agent/limits.ts`, `src/policy/rate.ts` — import
  `AGENT_LIMITS` from the shared package instead of restating the ceilings in
  two places. No behaviour change; the same values are returned to agents.

Web

- `apps/web/src/screens/Receipts.tsx` — verification badge per receipt, tally,
  summary, tool class, timestamp, and an undo button only when a stored inverse
  exists and has not been applied. Shows “Cannot be undone” for irreversible
  changes and reloads on `receipt.*` / `undo.*` feed events.
- `apps/web/src/screens/Trust.tsx` — one row per errand type named by its tools,
  with tier, clean-run progress and calls / dollars / minutes cap controls on
  every row, enabled once a license is offered. Accepting or re-capping updates
  the row in place; reloads on `trust.*` events.
- `apps/web/src/screens/Journal.tsx` — runs `GET /api/journal/verify` on demand
  and renders either a clean verdict with the entry count or the first broken
  sequence, with the raw number in plain text.
- `apps/web/src/screens/Keys.tsx` — lists active and revoked keys, creates a key
  and shows it once through the shared issued-key panel, revokes through an
  inline confirmation, reloads on `agent_key.*` events.
- `apps/web/src/components/IssuedKey.tsx` — the one-time key row and Claude
  Code / Cursor snippets, extracted from `AgentKeyPanel` so the Connect screen
  and the Keys screen use the same component.
- `apps/web/src/components/AgentKeyPanel.tsx` — now delegates to `IssuedKey`.
- `apps/web/src/useResource.ts` — one load/reload hook with a stale-request
  guard and a quiet reload used by the live feed; `useCatalog` now uses it too.
- `apps/web/src/components/ResourceState.tsx` — the loading / error+retry /
  empty frame shared by Catalog and the three new list screens.
- `apps/web/src/rows.ts` — one row-replacement helper for receipts, trust rows
  and agent keys.
- `apps/web/src/receipts.ts` — verification wording/tones, undo availability and
  wording, verification tally and errand-type shortening, all pure functions.
- `apps/web/src/trust.ts` — tier copy, clean-run progress, caps summary, cap
  form defaults and validation against the shared maxima.
- `apps/web/src/journal.ts` — the verify response to verdict copy, including the
  entry count and broken sequence.
- `apps/web/src/keys.ts` — active predicate, key status and active/revoked
  split.
- `apps/web/src/format.ts` — `errandTypeLabel`, the one truncation formatter.
- `apps/web/src/tone.ts` — the badge tone union shared by the three modules.
- `apps/web/src/api.ts` — typed receipts, undo, trust, license, journal and
  agent-key list/revoke calls.
- `apps/web/src/feed.ts` — plain-language items for `trust.*`, `undo.*` and
  `agent_key.*` events, closing finding 1 from ticket #15's proof.
- `apps/web/src/App.tsx`, `src/navigation.ts` — wire the four screens and delete
  the placeholder mechanism and `screens/Placeholder.tsx`.
- `apps/web/src/styles.css` — receipt, trust, journal and key cards, cap grid,
  verdict tones and danger button.
- `apps/web/tests/receipts.test.ts`, `trust.test.ts`, `journal.test.ts`,
  `keys.test.ts`, `feed.test.ts` — the new pure logic plus the new feed wording.

Proof

- `docs/proof/19-receipts-trust-journal-keys/` — `PROOF.md`, `drive.ts`,
  24 screenshots (desktop 1440×900 and phone 390×844, empty/loading/error/broken
  states), browser drive transcripts, API payloads, server logs, test/typecheck
  and build output.
- `docs/proof/19-receipts-trust-journal-keys/browser/` — the committed driver
  scripts and their README, so the walkthrough is reproducible.
- `package.json`, `bun.lock` — `playwright-core@1.65.1` as a devDependency for
  those drivers.

## Commands run

```
bun install
bun run typecheck
bun test
bun run --cwd apps/web build
PORT=4133 bun apps/mock-services/src/index.ts
PORT=8899 DATABASE_PATH=<temp>/errand-19-proof.db ALLOW_LOCALHOST_DEV=true \
  SESSION_COOKIE_SECURE=false bun apps/gateway/src/index.ts
GATEWAY_URL=http://127.0.0.1:8899 bun run --cwd apps/web dev -- --port 5301
bun docs/proof/19-receipts-trust-journal-keys/drive.ts
bun docs/proof/19-receipts-trust-journal-keys/browser/01-desktop-and-phone.ts
bun docs/proof/19-receipts-trust-journal-keys/browser/02-phone.ts
bun docs/proof/19-receipts-trust-journal-keys/browser/03-tamper-journal.ts
bun docs/proof/19-receipts-trust-journal-keys/browser/04-journal-broken.ts
bun docs/proof/19-receipts-trust-journal-keys/browser/05-empty-states.ts
bun docs/proof/19-receipts-trust-journal-keys/browser/06-error-states.ts
bun docs/proof/19-receipts-trust-journal-keys/browser/08-loading-states.ts
bun docs/proof/19-receipts-trust-journal-keys/browser/09-capture-api.ts
```

The SQLite databases are ignored by `*.db`; secrets, the passphrase and agent
keys lived only in process environment and untracked temp files.

## Test output

```
$ bun run typecheck
@errand/shared typecheck: Exited with code 0
@errand/mock-services typecheck: Exited with code 0
@errand/web typecheck: Exited with code 0
@errand/gateway typecheck: Exited with code 0
✓ 5 checks passed: comments, installed, journal-last-event, no-any, oauth-verifier

$ bun test
 414 pass
 0 fail
 1494 expect() calls
Ran 414 tests across 52 files.

$ bun run --cwd apps/web build
✓ 144 modules transformed.
dist/index.html                   0.53 kB │ gzip:   0.32 kB
dist/assets/index-DU5O-5a_.css   19.27 kB │ gzip:   4.56 kB
dist/assets/index-k73v3xUN.js   384.82 kB │ gzip: 113.02 kB
✓ built in 1.56s
```

Raw captures: `logs/typecheck.txt`, `logs/test-output.txt`,
`logs/web-build.txt`.

## Proof

- `PROOF.md` — verdict pass. Three findings fixed and re-driven: the trust
  footer's “Last settled” label, trust rows identified only by a hash, and a
  stale journal verdict surviving a failed re-check.
- `logs/drive.txt` — real MCP client through a real agent key: matched, delete
  (irreversible), unverified, mismatched, five clean runs and the license offer;
  journal `{ ok: true, checked: 62 }`.
- `logs/browser-drive.txt`, `phone-drive.txt` — desktop 1440×900 and phone
  390×844 walkthroughs.
- `logs/browser-window.txt` — no console error and no failed API request; only
  the navigation-closed SSE connections.
- `logs/journal-broken.txt` — the tampered sequence 7 verdict and the failed
  re-check that removed it.
- `logs/empty-drive.txt`, `error-drive.txt`, `loading-drive.txt`,
  `trust-drive.txt` — the state captures.
- `logs/api-receipts.json`, `api-trust.json`, `api-agent-keys.json`,
  `journal-verify-broken.json` — the API payloads behind the screens.
- Screens: `01`–`08` desktop walkthrough, `09`–`12` phone, `13` broken journal,
  `14`–`17` empty/initial, `18`–`21` error, `22`–`23` loading, `24` stale-verdict
  error.

## Versions changed

- Added `playwright-core@1.65.1` as a root devDependency so the committed
  browser drivers run against the installed Chromium. No runtime dependency
  changed.

## Review findings addressed

Standards:

- `trust.ts` re-implemented `formatCalls` and `formatDollarsInput`; `capsSummary`
  and `trustCapInputs` now call the formatter home.
- The loading / error+retry / empty frame was pasted into three new screens.
  It is now `components/ResourceState.tsx`, also used by Catalog, so there is
  one frame and one retry behaviour.
- The row-replacement map was copied into receipts, trust and keys; it is now
  `rows.replaceRow`. The “clear this row's error” object copy was two more
  copies; the error maps now store `null` and are overwritten.
- The Cursor/Claude hint was pasted into `AgentKeyPanel` and `Keys`; it moved
  into `IssuedKey`, which owns the snippet. The Connect-specific sentence about
  the key being bound to the account stays with Connect.
- `BadgeTone` and `FeedTone` were the same union; `FeedTone` is now an alias.
- The feed restated the clean-run label; it composes `cleanRunView().label`.
- `errandTypeLabel` lived in `receipts.ts` but trust used it; it moved to
  `format.ts`, the formatter home.
- `Journal` held a result and a verdict that could disagree on `checked` and
  `brokenSeq`; the verdict now carries both, and the tone is computed once.
- `App` ended its ternary chain with `<Keys />`, so an unhandled screen would
  silently show keys; it is now an exhaustive `Record<Screen, ReactNode>`.
- `Keys` re-tested `revokedAt === null` in three places; one `isActiveKey`
  predicate drives status, grouping and the revoke control.
- `.receipt-head`/`.trust-head` and their title classes were identical while
  Keys reused receipt names; they are one `.card-head` / `.card-title` /
  `.card-heading`.
- `agent/limits.ts` became a re-export middle man; consumers import
  `AGENT_LIMITS` from `@errand/shared` directly.
- Speculative type exports (`TierView`, `VerificationView`, `UndoView`,
  `JournalVerdict`, `TrustCapsParseResult`, `TrustCapEdits`, `VerificationTally`,
  `FeedTone`) are internal again.
- `useCatalog` still hand-rolled the load/reload shape; it now uses
  `useResource`, gaining the stale-request guard.

Spec:

- **Report.** `REPORT.md` now exists with the commands, pasted test output and a
  `## Proof` section naming existing files, which is what `complete-ticket.ts`
  checks.
- **Reproducible drivers.** The browser drivers are committed under
  `browser/` with a README and order, and `playwright-core@1.65.1` is a dev
  dependency, so no cited command points at a temp file.
- **Cap controls on every type.** Every trust row now renders the calls /
  dollars / minutes controls; a learner's are disabled with the number of clean
  runs still needed, instead of hiding the controls altogether.
- **Unidentifiable trust rows.** The API now returns the tool names behind the
  errand-type hash and the row is named by them (`calendar__list_events`), with
  the hash still available in the tooltip.
- **Stale journal verdict.** A failed re-check clears the previous verdict
  before showing the error; the proof drives broken → 503 and asserts no verdict
  card remains.
- `feed.ts` gaining `trust.*` / `undo.*` / `agent_key.*` copy and the
  `AgentKeyPanel` → `IssuedKey` extraction are supporting changes, not new
  scope: the feed copy closes the finding #15's proof deferred to this ticket,
  and `IssuedKey` is shared by Connect and Keys instead of duplicated.

## Deviations / not done

- The non-generated diff is above the workflow's ~300-line review threshold.
  The ticket is four screens sharing one API surface; both review axes ran over
  the whole diff, and the supporting code was consolidated during review
  (`ResourceState`, `replaceRow`, `useResource`, `IssuedKey`) rather than left
  as four copies. This is recorded, not treated as a pass on size alone.
- The in-app browser was opened and read the pages, but the Playwright MCP
  server cannot launch on this machine: its configured Chrome path does not
  exist and installing Chrome needs Administrator. Proof used Playwright 1.65.1
  with the already-installed Chromium 1255 directly, at real 1440×900 and
  390×844 viewports — the same deviation recorded in #18. The drivers are
  committed under `browser/`; they still need that Chromium path or an edit to
  `executablePath`.
- The broken-sequence journal proof tampers one `journal.payload` in the
  temporary proof database. That is the negative case the ticket asks the
  screen to report; it is not a production path.
- The empty and error screenshots use a second, empty gateway/stack and
  route-level 503s. That is deliberate: a real store failure would take the
  session down with it, and an empty state cannot be produced on the seeded
  database.

## Unverified

- A physical phone; the 390×844 pass is a Chromium viewport with touch and a
  mobile user agent.
- Real Notion, Linear or Google Calendar endpoints; the mock services were the
  upstreams.
- Sends and spends through Receipts undo: irreversible by definition, and #12
  owns the outbox tap. The irreversible path was proven on `delete`.
- Two simultaneous undos of the same receipt from two tabs; the gateway claim is
  covered by #14's tests.

## Next

`/implement` on the next runnable ticket printed by `complete-ticket.ts` after
this report is attached. This session does not start it.
