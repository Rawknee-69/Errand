# Ticket #17 — P7 · Catalog and Connectors screens

## Files built

Gateway

- `apps/gateway/src/db/schema.ts` — `connectors.last_success_at` and
  `tools.class_override`. The override records a human-set class so a refresh
  or re-approval cannot silently restore the classifier's class.
- `apps/gateway/drizzle/0004_skinny_ozymandias.sql` (plus snapshot/journal) —
  the two additive columns.
- `apps/gateway/src/connectors/catalog.ts` — `setToolClass` and
  `setToolRequestable`, the single home for both controls. Tightening applies
  immediately; loosening throws `confirmation_required` unless confirmed; both
  journal with the old and new value. Refresh preserves a human class and
  preserves requestability unless the definition changed.
- `apps/gateway/src/connectors/classifier.ts` — uses the shared danger order
  instead of a private copy.
- `apps/gateway/src/connectors/discovery.ts` — successful discovery stamps
  `lastSuccessAt`, covering connect, refresh and OAuth completion in one place.
- `apps/gateway/src/connectors/records.ts` — exposes `lastSuccessAt` on the
  connector view.
- `apps/gateway/src/connectors/errors.ts` — `confirmation_required` and
  `blocked` codes, mapped to 409 in `app.ts`.
- `apps/gateway/src/connectors/oauth/service.ts` — extracted the authorization
  leg and attempt insert shared by the initial flow and the new
  `startOAuthReauth`, which re-authorizes the existing connector without
  creating a second one.
- `apps/gateway/src/app.ts` — `POST /api/catalog/:id/class`,
  `POST /api/catalog/:id/requestable`, `POST /api/connectors/:id/reauth`.
- `packages/shared/src/index.ts` — class danger order and
  `isClassLoosening`, `lastSuccessAt` on the connector shape, catalog response
  / tool response / class and requestable request / reauth response schemas.

Web

- `apps/web/src/screens/Catalog.tsx` — grouped tool list with class badge,
  requestable toggle, sanitised pinned description, changed/removed block,
  inline loosening confirmation, re-approve action, loading/error/empty states.
- `apps/web/src/screens/Connectors.tsx` — status, last success, transport,
  auth, tool and blocked counts, refresh, and an OAuth-only reauth path (with
  a connect path for a non-OAuth credential failure).
- `apps/web/src/useCatalog.ts` — one loader and one in-place tool replacement
  shared by both screens.
- `apps/web/src/format.ts` — last-success formatting that says “never” instead
  of inventing a time.
- `apps/web/src/api.ts` — typed calls for catalog, refresh, reauth, approve,
  class and requestable.
- `apps/web/src/App.tsx`, `src/navigation.ts` — the two screens replace their
  ticket-17 placeholders; no second navigation source.
- `apps/web/src/styles.css` — catalog cards, block banners, class controls,
  connector facts, phone layout.
- `apps/web/vite.config.ts` — `GATEWAY_URL` override so parallel worktrees can
  run the control panel against their own gateway.

Tests and docs

- `apps/gateway/tests/connectors/api.test.ts` — tighten, loosen refused and
  confirmed, class survives refresh, requestable toggle and changed-tool
  refusal, last success, non-OAuth reauth refusal.
- `apps/gateway/tests/connectors/oauth.test.ts` — full re-authorization of the
  same connector after `invalid_grant`, no duplicate connector.
- `apps/gateway/tests/connectors/support.ts` — the two new wire fields and the
  reauth response.
- `apps/web/tests/format.test.ts` — never/invalid timestamps.
- `docs/proof/17-catalog-connectors/` — PROOF.md, 16 screenshots, logs.

## Commands run

```
bun install
bunx drizzle-kit generate                     # apps/gateway
bun run typecheck
bun test
bun run --cwd apps/web build
bun run --cwd apps/mock-services dev          # :4011
bun run --cwd apps/gateway dev                # :8797, untracked .env
GATEWAY_URL=http://127.0.0.1:8797 bun run --cwd apps/web dev -- --port 5183 --strictPort
bun C:/Users/Rem/AppData/Local/Temp/opencode/errand17-transcript.mjs
```

The untracked proof `.env` and SQLite file were removed before the final suite;
`bun test` would otherwise boot `apps/gateway/src/index.ts` from that `.env` in
the boot test.

## Test output

```
$ bun run typecheck
@errand/shared typecheck: Exited with code 0
@errand/mock-services typecheck: Exited with code 0
@errand/web typecheck: Exited with code 0
@errand/gateway typecheck: Exited with code 0
✓ 4 checks passed: comments, installed, no-any, oauth-verifier

$ bun test
 262 pass
 0 fail
 742 expect() calls
Ran 262 tests across 35 files.

$ bun run --cwd apps/web build
✓ 127 modules transformed.
dist/index.html                   0.49 kB │ gzip:   0.30 kB
dist/assets/index-C1YmPilq.css   12.27 kB │ gzip:   3.36 kB
dist/assets/index-DqSRyeP6.js   337.37 kB │ gzip: 101.52 kB
✓ built in 143ms
```

Raw captures: `logs/typecheck.txt`, `logs/test-output.txt`,
`logs/web-build.txt`.

## Proof

- `PROOF.md` — verdict pass; two fixed/accepted findings and what was not
  proven.
- `logs/http-transcript.txt` — tighten 200, loosen 409
  `confirmation_required`, confirmed loosen 200, requestable 200, journal
  verify `{"ok":true,"checked":19}`.
- `logs/journal-events.txt` — class changes with `loosened` and `confirmed`,
  requestable changes, changed-definition approval with both hashes,
  `needs_reauth`, `oauth_restarted`.
- `logs/phone-metrics.json` — 390×844, no horizontal overflow, zero visible
  controls under 44 px, tab bar bottom at 844.
- `logs/browser-console.log` — zero console errors/warnings, zero failed
  requests outside the deliberate 401/409 responses.
- Screens: `01`–`14` desktop, `15`–`16` phone.

## Versions changed

None. No dependency was added, removed or bumped, so `docs/VERSIONS.md` is
unchanged.

## Review findings addressed

Standards:

- The ~300-line review threshold was exceeded by substantive code. Recorded
  under Deviations; the ticket is two screens plus the gateway controls they
  need and was reviewed as one slice, with generated migration/log/proof files
  excluded from the behaviour count.
- `packages/shared` exported inferred types nobody imported while `api.ts`
  restated `{ tool: CatalogToolView }` three times. The web client now returns
  `CatalogToolResponse`, and the unused inferred type exports were removed.
- The changed/removed predicate lived in three places. It is now
  `isBlockedToolState` in `packages/shared`, with `isToolExposed` for
  “requestable and not blocked”, used by the gateway's agent catalog and both
  screens.
- Catalog and Connectors repeated the group/count logic. Both now use
  `apps/web/src/catalog.ts`.
- The reauth start repeated the initial OAuth start's begin/prune/journal tail.
  Extracted `authorizeAndAnnounce`, shared by both.
- The nested requestable ternary was deleted with the exposure fix below. The
  connector error-code status chain became one `CONNECTOR_ERROR_STATUS` map.
- Three `getCatalogTool(...)!` assertions were replaced by
  `requireCatalogTool`, which throws `not_found` instead of asserting.
- Re-approval reset exposure to the class default, silently turning a
  human-disabled read tool back on. Exposure now lives on the tool and survives
  changed, removed and re-approved definitions; only `state` blocks the agent,
  checked by `isToolExposed` in the agent catalog. Tests cover the off toggle
  surviving change and re-approval, and a changed tool with requestable true
  staying out of the agent's catalog.
- Two adjacent identical `@media (min-width: 560px)` blocks were merged.
- Added tests for exposing an `unknown` tool (refused), the off toggle across
  change/re-approval, and the screen's blocked/exposed counts. Component-level
  rollback of the optimistic toggle still has no React test setup in this repo;
  its request/refusal behaviour is covered at HTTP level.

Spec:

- A `needs_reauth` non-OAuth connector offered “Update credential”, which only
  meant creating a second connector for the same URL. Non-OAuth connectors
  never enter `needs_reauth`, so the misleading branch is gone; the reauth path
  is the OAuth one that can actually reach that state.
- An abandoned OAuth consent left the connector `pending` with no exit. A
  pending OAuth connector now shows “Restart sign-in” and an explanation;
  Refresh stays disabled until it is active.
- Re-approval no longer discards the human's exposure choice (see Standards).
- A class change on a changed tool is allowed through the API, but the tool
  remains blocked by `state` and cannot be exposed until re-approved. This is
  deliberate: a human may tighten before reviewing.
- `unknown → read` still requires confirmation. `unknown` is a blocked class,
  so giving it a runnable class does widen what the tool may do.
- `GATEWAY_URL` in `vite.config.ts` is a dev-only override so parallel
  worktrees do not all need port 8787; it changes no production behaviour.
- The optimistic toggle, invalid-date handling and
  `connector.oauth_restarted` are small corrections to observed behaviour (the
  first was found in proof; the journal event is the audit trail for reauth).

## Deviations / not done

- The non-generated diff is above the workflow's ~300-line review threshold.
  This is one vertical slice: two screens plus the gateway controls they need.
  The migration snapshot (generated) and proof images account for most of the
  line count.
- The phone pass used a 390×844 same-origin iframe because the in-app browser
  exposes no device-emulation control. Metrics came from the iframe document.
- An OAuth connector cannot be created from the Connect form yet; the proof
  created it through the OAuth start API and drove the reauth button itself.
  Connect-screen OAuth belongs to the real-connectors ticket.
- The empty state of both screens is not driven in this proof; the shared
  database already had connectors.

## Unverified

- Real Notion and Linear endpoints.
- A physical phone.
- Active-slip suspension when a tool changes; slip policy is a later ticket.
- Empty catalog/connectors on a brand-new account.

## Next

Closing #17 leaves the remaining P7 screen ticket and the P8/P9 work. The
next runnable ticket is reported by `complete-ticket.ts` after this report is
attached.
