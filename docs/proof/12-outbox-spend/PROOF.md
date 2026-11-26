# Ticket #12 — P5 · Outbox and the spend tap

## Environment

- Windows, Bun 1.4.4, TypeScript 7.0.2.
- Gateway `http://127.0.0.1:8843` (transcript) and `http://127.0.0.1:8842`
  (browser pass), SQLite `docs/proof/12-outbox-spend/proof.db` and `ui.db`
  (both gitignored), `ALLOW_LOCALHOST_DEV=true`, `SESSION_COOKIE_SECURE=false`.
- Mock services `http://127.0.0.1:4122`, web app `http://127.0.0.1:5173`.
- The Pay connector is the mock's header-authenticated MCP server. No real
  email, payment or account was touched.

## Steps driven

1. Signed in as the owner, created an agent key and connected the Pay mock
   through the real HTTP API.
2. Exposed `pay__send_receipt` and `pay__charge_card` from the catalog.
3. Seeded and approved a send slip with a recipient allowlist and
   learner/license spend slips, then called each through a real MCP client.
4. A send returned `held` with no calls row. The live worker released it after
   the real 30-second window; one call row and `outbox.released` followed.
5. A second send was cancelled from the HTTP outbox API inside the window;
   after 32 more seconds it still had no calls row and the reservation was
   refunded.
6. A learner spend returned `needs_human`; a separate POST confirm forwarded
   it, wrote `outbox.confirmed` (the tap), `outbox.completed` (the result) and
   one call row. A license spend returned `needs_human` too and was denied;
   spend and call counters returned to zero.
7. An outbox row past `expires_at` was swept to `expired`; after 32 seconds it
   still had no calls row.
8. Subscribed to `/api/events?since=0` for the whole run and captured the SSE
   frames (`logs/sse.txt`); every outbox event type arrived live.
9. Drove the Slips screen at 1440×900 and 390×844: held state, Stop it,
   Confirm spend, Deny, the decided list and the live feed. Captured console
   and failed requests for the window (empty).

The transcript is `logs/outbox-transcript.txt`; the SSE capture is
`logs/sse.txt`; the server windows are `logs/gateway-server.txt`,
`logs/gateway-ui-server.txt`, `logs/mock-services.txt` and
`logs/web-server.txt`. Journal verify ended `{ok:true, checked:28}`.

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| 1 | medium | Desktop outbox actions took 100% width, squeezing the tool name to one character per line | `screens/01-desktop-outbox.png` (after fix) | fixed: buttons auto-width and the row wraps |
| 2 | medium | At 390 px the row became a column, so `flex-basis: 240px` became a 240 px height and left a large gap under each item | `screens/02-phone-slips.png` (after fix) | fixed: mobile resets the basis to `auto` |
| 3 | low | Decided rows printed internal reasons (`human_cancelled`, `expired`) | `screens/03-desktop-send-stopped.png` (after fix) | fixed: plain-language outcome notes |
| 4 | low | Vite logged `ECONNRESET` on `/api/events` when the proof gateway was deliberately restarted for a fresh UI database | `logs/web-server.txt` | environmental, not product; the final Playwright runs reported no console or failed-request entries |

The fixed layout was re-driven at both widths: the phone run reports
`overflowX: false`, no console messages and no failed requests
(`screens/02-phone-slips.json`); the desktop run does the same
(`screens/browser-window.json`).

## Not proven

- Multi-process worker races: one gateway process releases the outbox. The
  conditional state claim is covered by unit behaviour, not by two processes.
- A stale `releasing` claim is swept by the next release pass and covered by a
  test, but no real process was killed mid-forward.
- The 30-second window is proven in real time; timing under a suspended
  process is covered only by the expired-row sweep and the five-second grace.
- The Pay mock is the upstream; no real Stripe/email integration was driven.
- OAuth connectors were not used for this ticket.

Verdict: pass
