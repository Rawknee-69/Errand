# Proof — ticket 14 · Verifier, undo and receipts

## Environment

- Branch `ticket/14-verifier-receipts`, cut from `origin/integration` at `1e7daa9`.
- Gateway on `http://127.0.0.1:8841`, mock services on `http://127.0.0.1:4121`,
  web control panel on `http://localhost:5191`, each on its own port so the
  parallel ticket-13 session cannot collide.
- Temporary SQLite file outside the repo:
  `C:/Users/Rem/AppData/Local/Temp/opencode/errand-14-proof.db`.
- `ALLOW_LOCALHOST_DEV=true` so the gateway can reach the mock MCP servers;
  `SESSION_COOKIE_SECURE=false` because the proof runs over plain HTTP.
- Real clients, not stubs: a Streamable HTTP MCP client against `/mcp`, the
  human JSON API with a passphrase session cookie, and the real mock-services
  calendar and legacy-SSE dine-out servers.

Commands:

```
bun apps/mock-services/src/index.ts          # PORT=4121
bun apps/gateway/src/index.ts                # PORT=8841, DATABASE_PATH=temp file
GATEWAY_URL=http://127.0.0.1:8841 bun run --cwd apps/web dev -- --port 5191
bun docs/proof/14-verifier-receipts/drive.ts
```

## Steps driven

1. Connect the mock calendar (`/calendar/mcp`, no auth) and expose
   `create_event`, `list_events`, `delete_event`.
2. Connect the legacy-SSE mock restaurant (`/dine-out/sse`, basic auth) and
   expose `reserve_table`.
3. Issue an agent key and open a real MCP client.
4. Create a calendar event. Errand re-reads `list_events` and returns a
   receipt: `verification: matched`, undo available.
5. Apply undo from the human API. The inverse (`delete_event`) runs, is read
   back, and is journaled; the calendar no longer contains the event. A second
   undo returns `409 already_applied`.
6. Force the inverse to be dropped while the create stays real: the undo is
   `mismatched`, `appliedAt` stays null, and the stored receipt keeps that
   verification. Removing the fault and retrying makes it `matched`.
7. Flip the mock calendar to `drop_write`, repeat the create. The receipt is
   `mismatched`, says no undo is available, and offers none.
8. Reserve a table on the connector with no adapter. The receipt is
   `unverified`, its summary says no verifier is installed, and it says no undo
   is available.
9. Create then delete an event. The delete receipt is `matched`,
   `irreversible: true`, has no undo, and its summary ends
   “This cannot be undone.”
10. List receipts, confirm the journal chain, and open `/slips` in the browser
    to see the same `receipt.created` frames in the live feed without a refresh.

Raw transcript: `logs/drive.txt`. Receipts API response:
`logs/api-receipts.json`. Journal: `logs/journal-verify.json`. Browser window:
`screens/01-desktop-receipts-matched.jpg` (matched + irreversible) and
`screens/02-desktop-receipts-unverified-mismatched.jpg` (unverified and
mismatched frames).

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| — | — | No finding: console had no errors, no request failed, and the feed showed all three verification outcomes | logs/console.txt, logs/network.txt | — |

## Not proven

- Phone viewport 390×844 was not re-driven: this ticket adds no UI code. The
  only visible surface is the existing live feed, which already renders
  `receipt.created`; ticket #19 builds the Receipts screen that will consume
  `GET /api/receipts`.
- Send and spend receipts: those calls are still held by ticket #12
  (`not_forwarded`), so the irreversible label was proven on `delete`, which is
  the irreversible class that runs today.
- Real Google Calendar, Notion and Linear adapters: the only adapter is the
  mock calendar, as the spec allows.

Verdict: pass
