# Proof — #20 P9 demo fixtures and the “Settle It” run

## Environment

- Windows, Bun 1.4.4, TypeScript 7.0.2.
- `bun run demo:up --fresh` on `http://127.0.0.1:5173`, gateway
  `http://127.0.0.1:8787`, mock services `http://127.0.0.1:4001`.
- Owner passphrase from `.demo/secrets.json`; three demo guests `Alice`, `Bob`
  and `Cara`.
- All connectors point at loopback mock services. The script refuses a gateway
  or mock URL whose host is not loopback.
- Real Notion/Linear were not used in this run; this ticket adds no remote
  connector behaviour.

## Steps driven

1. `bun run demo:up --fresh`; then `bun run demo:settle`. The browser pass
   signed in as **Alice**, **Bob** and **Cara** in turn and approved each
   pending child slip (`Settle It · find a dinner time on …`). Each card showed
   one `calendar__list_events` call, 15 minutes, and the cannot-list (no other
   tool, no change, no delete, no send, no spend). The retained transcript uses
   `--auto-approve` for repeatability; it approves through each friend's own
   session, not the owner's.
2. The script read all three calendars and computed the shared hour inside the
   dinner window: `18:00–19:00 UTC on 5 December 2026` from Alice 09/12, Bob
   10/15 and Cara 11/16.
3. Approved the restaurant search; the mock returned `Trattoria Verde`
   (italian, opens 18:00).
4. Approved the `pay__create_payment_links` slip. The gateway returned
   `needs_human` for the $120 spend. **Slips** showed `Waiting for your tap`
   with **Confirm spend**; clicking it was the human tap. The receipt then read
   `matched — Created 3 split payment links for Trattoria Verde totalling
   $120.00 and read them back. This cannot be undone.` The verifier checks the
   restaurant, names, shares and total against the re-read links.
5. Approved the inbox slip. The poisoned message asked the agent to call
   `export_all_contacts`; the script followed it, the gateway refused with
   `decoy`, and the slip card showed `BURNED · Burned: decoy`.
6. Five clean `calendar__create_event` runs showed clean runs 1→5 and the license
   offer. Accepted caps `{callCap: 2, spendCapCents: 0, minutes: 10}`; tier
   became `license`. The mock calendar was then set to `drop_write`; a licensed
   create returned `mismatched` and the Trust screen returned to
   `LEARNER · 0 of 5 clean runs`.
7. Verified the journal: `chain intact, 587 events checked`.

`logs/settle-wait-tap.txt` is the retained run with the **browser** tap.
`logs/settle-run.txt` is the fully scripted rehearsal.

## Findings

| # | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| 1 | info | The demo has no cross-user parent slip, so “three child slips” is three independent slips requested through each friend's own key by the coordinator script. | `logs/settle-wait-tap.txt` step 1–2; `docs/DEMO.md` | Kept honest and documented; adding a cross-user parent object would widen the auth model outside this ticket. |
| 2 | info | The payment receipt is `matched` because the mock links are read back, not because money moved. | `screens/02-desktop-receipt-verified.png`, log step 4 | Receipt says it cannot be undone; no real payment occurred. |
| 3 | low | The three friend approvals used three guest sessions in one browser, not three separate browser profiles. | `logs/settle-wait-tap.txt`; `screens/01-desktop-burn-and-spend.png` | Each session has its own cookie and user; no cross-user rows were visible. |
| 4 | low | Connectors now label loopback services `MOCK`. | `screens/07-desktop-connectors-mock.png` | Added in this ticket. |
| 5 | low | The mobile check used a 390×844 same-origin iframe because the in-app browser has no device-metrics control. | `screens/04-phone-burn.png` | Accepted for the demo proof; layout is the real 390 px responsive layout. |

No console errors or failed requests were recorded in the owner window.

## Evidence

- `screens/01-desktop-burn-and-spend.png` — burned email slip (`decoy`) next to
  the confirmed $120 split-payment card.
- `screens/02-desktop-receipt-verified.png` — the split-payment receipt,
  `VERIFIED`, three links, $120.00, no undo.
- `screens/03-desktop-trust-demoted.png` — the calendar-create type back at
  `LEARNER`, 0 of 5 clean runs, caps locked.
- `screens/04-phone-burn.png` — 390×844 Slips view with the burn.
- `screens/05-desktop-spend-waiting.png` — the real `NEEDS YOUR TAP` outbox
  before the human clicked **Confirm spend**.
- `screens/06-desktop-license.png` — `DINE_OUT__SEARCH_RESTAURANTS` at
  `LICENSE`, 5 of 5 clean runs, beside the demoted calendar type.
- `screens/07-desktop-connectors-mock.png` — the `MOCK` badges on the three
  loopback connectors.
- `logs/settle-wait-tap.txt` — the run with the browser tap and final verifier.
- `logs/settle-run.txt` — the fully scripted rehearsal.
- `logs/test-output.txt`, `logs/typecheck.txt` — full suite and typecheck.
- `logs/gateway-server.txt`, `logs/mock-services.txt`, `logs/web-server.txt` —
  the stack window.
- `logs/browser-console.txt`, `logs/browser-network.txt` — no console errors,
  no failed requests.

## Verdict

**pass** — the three friends each approved a one-call read slip from their own
session; the coordinator found the shared dinner hour from the three real mock
calendars; the restaurant search returned a mock restaurant; the split payment
stopped at `needs_human` until the human tapped and its receipt was verified
against the re-read links; the poisoned email burned its slip; five clean runs
offered a license which was accepted and then lost after a mismatched receipt.
Nothing real was ordered, paid or traded.
