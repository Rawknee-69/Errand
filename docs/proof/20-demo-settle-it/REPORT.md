# Ticket #20 — P9 demo fixtures and the “Settle It” run

## Files built

- `scripts/demo-settle-it.ts` — the one-command story. Refuses a non-loopback
  gateway or mock URL; `--auto-approve` and `--tap-spend` are rehearsal flags.
- `scripts/settle-it/api.ts` — cookie-holding human API client for the owner and
  the three demo guests.
- `scripts/settle-it/fixtures.ts` — idempotent fixtures: three friend accounts
  with their own calendar connector, exposed tool and agent key; owner calendar,
  restaurant, pay and email connectors; owner agent key.
- `scripts/settle-it/story.ts` — child slips, shared-time calculation, restaurant
  search, split payment behind the tap, poisoned email burn, promotion and
  demotion, journal check.
- `apps/mock-services/src/server.ts` — three token-selected friend calendars, a
  seed/fault surface per calendar, the poisoned inbox, split-payment link tools,
  and realistic restaurant search results.
- `apps/gateway/src/receipts/verifier.ts` — the mock-pay verifier: a created split
  link is `matched` only when the service reads every link back; no inverse.
- `apps/mock-services/tests/settle-fixtures.test.ts` — per-friend calendars, no
  cross-calendar leakage, split links, poisoned inbox.
- `apps/gateway/tests/receipts/verifier.test.ts` — matched, mismatched and
  unverified payment receipts.
- `package.json` — `demo:settle` script and the root client dependency used by
  the scripts.
- `docs/DEMO.md` — the Settle It run, the rehearsal flags and what is mocked.
- `docs/proof/20-demo-settle-it/` — `PROOF.md`, three run transcripts, browser
  console/network logs, server windows, typecheck/test output and five screens.

## Commands run

```powershell
bun install
bun run typecheck
bun test
bun run demo:up --fresh
bun scripts/demo-settle-it.ts                      # approvals in the browser
bun scripts/demo-settle-it.ts --auto-approve       # then tap in the browser
bun scripts/demo-settle-it.ts --auto-approve --tap-spend
```

The browser pass signed in as Alice, Bob and Cara in turn and approved each
child slip, then signed in as owner and approved the restaurant, payment and
email slips and clicked **Confirm spend**. The retained wait-for-tap transcript
was produced with `--auto-approve` so it can be replayed; the spend tap in it
was still the browser button.

## Test output

```text
$ bun run typecheck
@errand/shared typecheck: Exited with code 0
@errand/mock-services typecheck: Exited with code 0
@errand/web typecheck: Exited with code 0
@errand/gateway typecheck: Exited with code 0
✓ 5 checks passed: comments, installed, journal-last-event, no-any, oauth-verifier

$ bun test
 428 pass
 0 fail
 1538 expect() calls
Ran 428 tests across 56 files.
```

## Acceptance criteria

- **Three seeded friends each have a calendar and can approve their own
  read-only slip.** `Alice`, `Bob` and `Cara` are demo guests; each calendar is
  selected by its own bearer token in the mock server. The human run approved
  each one from that friend's own session (`logs/settle-wait-tap.txt`).
- **A coordinator agent requests three child slips, finds a shared time,
  searches the mock restaurant service and creates split payment links.** The
  coordinator opens one agent session per friend and requests one child slip
  through that friend's key; the shared hour is computed from the three
  calendars (`13:00–14:00`); `Trattoria Verde` is returned; one call creates
  three split links. There is no cross-user parent slip object; that is recorded
  as a scope decision in `PROOF.md`.
- **The spend step waits for a human tap and the receipt is verified.** The call
  returned `needs_human`; the UI showed **NEEDS YOUR TAP · Confirm spend**; the
  human clicked it; the receipt read `matched` after the links were read back
  (`logs/settle-wait-tap.txt`, `screens/05-desktop-spend-waiting.png`).
- **A poisoned email leads the agent to a decoy and the slip visibly burns.** The
  inbox instructs `export_all_contacts`; the gateway refused it, and Slips showed
  `BURNED · Burned: decoy` (`screens/01-desktop-burn-and-spend.png`).
- **A seeded learner-to-license promotion and a bad receipt demotion both show.**
  Five clean create runs moved clean runs 1→5 and offered the license; accepting
  set `tier: license`; a `drop_write` create produced `mismatched` and the type
  returned to `learner` with 0 clean runs (`logs/settle-wait-tap.txt`,
  `screens/03-desktop-trust-demoted.png`,
  `screens/06-desktop-license.png`).
- **Nothing real is ordered, paid or traded.** Every connector URL is loopback;
  the entry script refuses non-loopback hosts; the payment service only stores
  mock links; the final line says so.

## Proof

`docs/proof/20-demo-settle-it/PROOF.md` — verdict `pass`, with the human-run
transcript, the wait-for-tap run, the fully scripted rehearsal, five screenshots
and browser/server logs. Key artifacts:
`docs/proof/20-demo-settle-it/logs/settle-wait-tap.txt`,
`docs/proof/20-demo-settle-it/screens/01-desktop-burn-and-spend.png`,
`docs/proof/20-demo-settle-it/screens/05-desktop-spend-waiting.png`.

## Review

`/code-review` ran both axes over `integration...HEAD` in parallel. Findings and
resolutions are in `docs/proof/20-demo-settle-it/PROOF.md` and this report’s
final commit.

## Unverified

- Notion/Linear were not part of this run; this ticket changes only mocks and
  demo fixtures.
- The mobile view was captured through a 390×844 same-origin iframe because the
  in-app browser has no device-metrics control.
- The parent/child slip wording is a coordinator-script relationship, not a new
  gateway object; documented in `PROOF.md` and `DEMO.md`.

## Versions changed

No existing version changed. Added `@modelcontextprotocol/client` 2.4.0 as a
root dev dependency (already used at 2.4.0 by the gateway) and as a
mock-services dev dependency for the fixture tests.
