# Proof — #15 trust ledger and the learner's permit

> Branch `ticket/15-trust-ledger`, cut from `integration` at `95375ea` (P6
> verifier, undo and receipts). This ticket is a gateway and agent-surface
> change: the Trust screen stays a placeholder until #19.

## Environment

- Windows, Bun 1.4.4, TypeScript 7.0.2, Drizzle ORM 0.45.4, SQLite.
- Gateway `http://127.0.0.1:8887` with `DEMO_MODE=true`,
  `ALLOW_LOCALHOST_DEV=true`, `SESSION_COOKIE_SECURE=false`, a fresh
  `.demo/proof15.db`, and a 32-byte vault key, HMAC key and session secret.
- Web dev server `http://localhost:5273`, proxying `/api` to the gateway.
- Mock services `http://127.0.0.1:4101` (calendar with a vaulted bearer token
  and the `POST /mock/calendar/fault` switch).
- `integration` had already merged #12 (outbox and spend tap) before the rebase,
  so the spend guard is the real outbox, not a stub.
- Real MCP client (`@modelcontextprotocol/client` 2.4.0) through a real agent
  key; every call in `logs/drive.txt` went through `POST /mcp`.

## Steps driven

1. Signed in as the owner (`logs/drive.txt`, first section).
2. Connected the mock calendar with a bearer credential; the vault sealed it.
   Issued an agent key and attached the MCP client.
3. Requested `calendar__list_events`. The slip was `pending` / `learner`, and
   `GET /api/trust` showed the new errand type at `cleanRuns: 0`,
   `licenseOffered: false`.
4. Ran five clean read errands, each capped at 1 call so the run settled on its
   last call. Clean-run count rose 1 → 5 and the fifth journaled
   `trust.license_offered`.
5. Accepted the license with `{callCap: 2, spendCapCents: 0, minutes: 5}`.
6. Requested again with wide limits (`calls: 40`, `spend: $150`, `25 min`). The
   slip came back `approved` / `license` with the caps clamped to 2 calls, $0
   and 5 minutes, and `errand_status` issued a capability without any human
   approval.
7. Made a call outside that licensed slip (`calendar__create_event`). It was
   refused `out_of_scope`, the slip stayed approved, and the type dropped to
   `learner` with `cleanRuns: 0`.
8. Ran five clean write errands and accepted a write license. Created an event,
   then undid it through `POST /api/receipts/:id/undo` (`matched`); the type
   dropped to `learner` with a `trust.demoted` reason `undo`.
9. Re-earned the write license, forced the mock calendar to accept a write
   without persisting it (`drop_write`), and made one write. The receipt was
   `mismatched`; the type dropped to `learner`, with `trust.run_unclean`,
   `trust.demoted` (reason `mismatch`) and the receipt in that order.
10. `GET /api/journal/verify` returned `{ok: true, checked: 118}` after the
    whole drive.
11. Opened the running control panel as the owner, visited `/trust` (the #19
    placeholder) and `/slips`. The live feed showed `Trust run clean`,
    `Trust license offered`, `Trust license accepted`, `Trust license used`,
    `Trust run unclean`, `Trust demoted`, and the mismatched receipt beside the
    calls that caused them, without a refresh
    (`screens/02-slips-feed-trust-events.jpg`). Console and network logs were
    captured for the same window.

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| 1 | info | The live feed shows trust events with their event name only, no sentence or count, because the feed descriptions for `trust.*` belong to the Trust screen ticket. The events do arrive live and in order. | `screens/02-slips-feed-trust-events.jpg` | Deferred to #19 by scope |
| 2 | info | The Trust screen still reads “Coming with ticket #19”; `/api/trust` exists and returns the ledger, but nothing in the UI consumes it yet. | `screens/01-trust-placeholder.jpg` | Deferred to #19 by scope |
| 3 | info | A licensed spend is held as `needs_human` with its amount and expiry; it does not reach the card until the human confirms it in the outbox. #12 merged into integration before this branch was rebased, so the tap is present rather than stubbed. | `logs/test-output.txt` (trust API test “a license never moves money without the human tap”) | Pass |

No console errors, no failed requests and no secret in the page, the network
payloads or the console.

## Not proven

- **`GET /api/trust` settles finished runs lazily** before it returns a view, so
  a read can append `trust.run_clean` / `trust.run_unclean`. That is deliberate:
  a run that expired while nobody was calling still counts exactly once, and
  `slips.settled_at` makes the write idempotent. A caller looking only at the
  route's read shape should know it can mutate.
- **A live licensed spend.** Reaching a license for a spend-class errand needs
  five *clean* spend runs, and the mock pay service has no verifier, so its
  receipts are `unverified` and cannot earn trust. The guard was proven at test
  level instead: a seeded license with a $5 spend cap admits `pay__charge_card`,
  which is held as `needs_human` with the amount, so nothing goes upstream until
  the human tap. The tap itself is #12, now merged.
- **Phone viewport 390×844.** This ticket adds no UI; the only visible surface is
  the existing feed, captured at desktop width. The #19 screens will carry the
  phone proof.
- **Decoy and second-scope-violation demotion live** were not repeated; #13's
  proof already drives the burn, and this branch asserts the new `trust.demoted`
  event and reason in `apps/gateway/tests/agent/call.test.ts`.
- **An already-approved license-tier slip is not torn down when its type
  demotes.** The demotion changes what the next request gets; a slip already
  signed and within the caps the human accepted keeps its capability until it
  expires or caps out. The ticket asks for the *type* to return to learner, and
  the proof shows the next request requires a human again.
- **A spend run stays unsettled while it waits for the tap.** Settlement sees an
  admitted call with no recorded row and returns `pending`, so the run neither
  counts clean nor resets. This also closes the parallel-call race: a sibling
  still in the forwarder is not mistaken for a missing call.

## Evidence

- `logs/drive.txt` — the full real-client transcript: learner start, five clean
  runs, offer, acceptance, auto-approval with clamped caps, scope-violation
  demotion, undo demotion, mismatch demotion, journal verify.
- `logs/test-output.txt` — `bun test`: 396 pass, 0 fail, 48 files.
- `logs/typecheck.txt` — four workspace typechecks and the four static checks.
- `logs/gateway-server.txt`, `logs/mock-services-server.txt`,
  `logs/web-server.txt` — the server startup lines for this window. The gateway
  does not log individual requests, so the request evidence is the transcript.
- `logs/console.txt`, `logs/network.txt` — the browser window.
- `screens/01-trust-placeholder.jpg` — the #19 placeholder for context.
- `screens/02-slips-feed-trust-events.jpg` — live trust events and the
  mismatched receipt in the feed.

## Verdict

**pass** — a new type starts as a learner, five consecutive clean runs offer a
license, accepting sets the caps the human chose, a licensed request is
auto-approved inside those caps, and a scope violation, an undo, or a mismatched
receipt each demote the type and journal its reason. The journal chain stayed
intact through 118 entries.
