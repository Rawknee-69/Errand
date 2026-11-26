# Proof — #19 Receipts, Trust, Journal and Agent keys screens

## Environment

- Branch `ticket/19-receipts-trust-journal-keys`, cut from
  `origin/integration` at `f1db196` (the trust ledger and verifier were already
  merged), with this ticket's web and shared-contract changes.
- Gateway `http://127.0.0.1:8899` on a temporary SQLite file outside the repo:
  `C:/Users/Rem/AppData/Local/Temp/opencode/errand-19-proof.db`.
- Second, empty gateway `http://127.0.0.1:8898` on a fresh temporary database,
  for the empty states.
- Mock services `http://127.0.0.1:4133` (calendar and legacy-SSE dine-out).
- Web control panel `http://127.0.0.1:5301` (main) and `5302` (empty), each
  proxying `/api` to its gateway.
- `ALLOW_LOCALHOST_DEV=true`, `SESSION_COOKIE_SECURE=false`; secrets, the
  passphrase and agent keys lived only in process environment and an untracked
  temp file.
- Real clients: the mock MCP servers through real connectors, a real MCP client
  through a real agent key, and Chromium 1255 driven by Playwright 1.65.1 at
  real 1440×900 and 390×844 viewports. The in-app browser was opened first and
  read the same pages; the Playwright MCP server cannot launch on this machine
  because Chrome is not installed at its configured path (same deviation as
  #18). Direct Chromium is not device emulation: the viewport and media queries
  are the real ones.

Commands:

```
bun install
PORT=4133 bun apps/mock-services/src/index.ts
PORT=8899 DATABASE_PATH=<temp>/errand-19-proof.db ALLOW_LOCALHOST_DEV=true \
  SESSION_COOKIE_SECURE=false bun apps/gateway/src/index.ts
GATEWAY_URL=http://127.0.0.1:8899 bun run --cwd apps/web dev -- --port 5301
bun docs/proof/19-receipts-trust-journal-keys/drive.ts
bun <temp>/proof19-runner/drive-proof.ts
bun <temp>/proof19-runner/phone-proof.ts
bun <temp>/proof19-runner/tamper.ts && bun <temp>/proof19-runner/journal-broken.ts
bun <temp>/proof19-runner/empty-proof.ts
bun <temp>/proof19-runner/error-proof.ts
bun <temp>/proof19-runner/trust-proof.ts
bun <temp>/proof19-runner/loading-proof.ts
```

## Data driven

`drive.ts` (real MCP client, real connectors, real journal):

1. Connected the mock calendar and the mock dine-out server; exposed
   `create_event`, `list_events`, `delete_event` and `reserve_table`.
2. Issued a seed agent key and opened an MCP connection with it.
3. A create was read back: `matched`, undo stored (`matched · write`).
4. Created then deleted an event: `matched`, `irreversible: true`, no undo.
5. Reserved a table on a connector with no verifier: `unverified`, no undo.
6. Forced `drop_write`: the create was `mismatched` and offers no undo.
7. Ran five one-call clean `list_events` errands. The ledger moved 1→5 clean
   runs on that errand type and returned `licenseOffered: true`; other types
   stayed learners at 0 and 1 clean runs.
8. `GET /api/journal/verify` returned `{ ok: true, checked: 62 }`.

`logs/drive.txt` is the full transcript; `logs/api-receipts.json`,
`logs/api-trust.json` and `logs/api-agent-keys.json` are the API payloads the
screens consumed.

## Steps driven in the browser

Desktop 1440×900:

1. `/receipts` — the tally read 3 verified, 1 mismatched, 1 unverified; every
   receipt carried its badge and tool class, the delete said “Cannot be
   undone”, and only receipts with a stored inverse showed **Undo this change**
   (`screens/01-desktop-receipts.png`).
2. Pressed **Undo this change** on a verified create. The inverse ran, was
   re-read, and the card changed to **Undone** with the verifier's summary
   (`screens/02-desktop-receipts-undone.png`).
3. `/trust` — four errand types: the list_events type showed 5 of 5 clean runs
   and a caps form; the others showed their clean-run progress and no form
   (`screens/03-desktop-trust-offer.png`).
4. Typed 2 calls / $15.00 / 5 minutes and pressed **Accept license with these
   caps**. The badge changed to **License**, the caps summary appeared, and the
   button became **Update caps** (`screens/04-desktop-trust-license.png`).
5. `/journal` — pressed **Run the journal check**; the verdict was **Chain
   intact**, 64 entries recomputed (`screens/05-desktop-journal-clean.png`).
6. `/keys` — created “Cursor laptop”, saw the key once with the Claude Code and
   Cursor snippets (`screens/07-desktop-key-created.png`), hid it, then revoked
   the seed “Proof agent” key through the inline confirmation. The revoked key
   moved to the **Revoked** group (`screens/08-desktop-key-revoked.png`).
7. Tampered `journal.payload` at sequence 7 in the temporary database, then
   pressed **Run the journal check** again. The verdict named **Chain broken at
   sequence 7**, 6 entries intact, with the sequence in plain text
   (`screens/13-desktop-journal-broken.png`, `logs/journal-broken.txt`).

Phone 390×844:

8. `/receipts` (`09-phone-receipts.png`, scrolled to the undo card in
   `09b-phone-receipts-undo.png`), `/trust` (`10-phone-trust.png`, caps form in
   `10b-phone-trust-caps.png`), `/journal` after a run (`11-phone-journal.png`),
   `/keys` (`12-phone-keys.png`). The tab bar stays fixed at the bottom and the
   caps grid stacks.

States:

9. Empty database: `/receipts` “No receipts yet”
   (`14-desktop-receipts-empty.png`), `/trust` “No errand types have run yet”
   (`15-desktop-trust-empty.png`), `/keys` “No keys yet”
   (`16-desktop-keys-empty.png`), `/journal` before the first run
   (`17-desktop-journal-initial.png`).
10. Deliberate 503 per store: each screen showed the gateway's message and a
    **Try again** button (`18`–`21`), and the journal error stayed on the same
    panel (`21-desktop-journal-error.png`).
11. Delayed responses captured the loading copy for receipts and trust
    (`22-desktop-receipts-loading.png`, `23-desktop-trust-loading.png`).

Console and network: `logs/browser-window.txt` recorded only the four
`/api/events` `ERR_ABORTED` rows caused by closing the EventSource when the
browser navigates to another screen; no console error, page error, failed API
request or 4xx/5xx occurred in the driven windows. `logs/browser-drive.txt`,
`logs/phone-drive.txt`, `logs/empty-drive.txt`, `logs/error-drive.txt`,
`logs/loading-drive.txt` and `logs/trust-drive.txt` are the unattended
transcripts.

No credential, token or plaintext agent key appears in the page copy, the API
logs or the screenshots. The key shown in `07-desktop-key-created.png` existed
only for that capture and was not journalled anywhere else.

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| 1 | low | The trust row footer said “Last settled”, but `updatedAt` also moves on creation and on an accepted license, not only when a run settles. Renamed to “Updated”; all trust screenshots were recaptured. | screens/03-desktop-trust-offer.png, screens/04-desktop-trust-license.png | fixed |
| 2 | info | `/api/events` shows `ERR_ABORTED` whenever the user navigates between screens. That is the EventSource being closed, not a failed read; every screen's data request completed 200. | logs/browser-window.txt | expected |

## Not proven

- A physical phone; the 390×844 pass is a Chromium viewport with touch and a
  mobile user agent.
- Real Notion, Linear or Google Calendar endpoints; the mock calendar and
  dine-out servers are the upstreams.
- Sends and spends through the Receipts undo path: those are irreversible by
  definition and the outbox tap is #12's surface. The irreversible label was
  proven on `delete`, which runs today.
- A license being demoted from the UI. There is no “give up the license”
  control in the ticket; demotion is the gateway's behaviour and was proven in
  #15. This screen displays the resulting learner row.
- Two undos racing on the same receipt from two tabs; the gateway's claim is
  tested in #14.

Verdict: pass
