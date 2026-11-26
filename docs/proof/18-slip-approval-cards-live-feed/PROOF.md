# Proof — #18 P7 · Slip approval cards and live feed

## Environment

- Branch `ticket/18-slip-approval-cards-live-feed`, cut from `integration` at
  `121b62a`.
- Gateway on `http://127.0.0.1:8831` with a fresh SQLite file,
  `ALLOW_LOCALHOST_DEV=true`, `DEMO_MODE=true`, `SESSION_COOKIE_SECURE=false`.
  HMAC, vault and session keys were set only in the process environment; none is
  in this repository.
- Two real services from `apps/mock-services`: the calendar MCP server on `:4111`
  and a real MCP client from `@modelcontextprotocol/client` creating the slips.
- Web control panel built with `vite build` and served by `vite preview` on
  `http://127.0.0.1:5183`, proxying `/api` to the gateway.
- Chromium 1255 through Playwright 1.65.1, 1440×900 and 390×844. The in-app
  browser and the Playwright MCP server could not launch because this machine has
  no Chrome at the configured
  `C:\Users\Rem\AppData\Local\Google\Chrome\Application\chrome.exe`;
  Playwright's installed Chromium was used directly instead.
- Bun 1.4.4, TypeScript 7.0.2, React 19.3.1, Vite 8.3.8.

## Steps driven

1. Signed in as the owner. The visible screen was the Slips placeholder's
   replacement, not a generic dashboard; the login form showed no browser
   accessibility warning (`01-login.png`).
2. Read four pending slips, each with the goal in plain words, the exact tool, its
   class, `It can` / `It cannot` lists, calls, spend cap and time left
   (`02-slips-pending.png`). The fourth request asked for 900 calls and $1,000;
   the server capped it at 50 calls and $200, and the feed said `Calls 900 → 50
   (server maximum); Spend $1,000.00 → $200.00 (server maximum)`. The feed also
   replayed the four `slip.requested` events, the agent-key creation, catalog
   ingest and connector connection.
3. On “Find a dinner slot for Friday”, lowered the call cap 9 → 4 and the spend
   cap $50.00 → $10.00, then approved (`03-edit-caps.png`).
4. The signed result repeated both trims with the reason “tightened by you”, and
   the feed carried the same trim text in its `Slip approved` event
   (`04-approved-trims.png`, `04-approved-feed.png`).
5. Denied “Tidy up next week's calendar”. The card left the pending list and the
   feed showed `Slip denied`; the denial text explains the agent stops rather
   than retrying (`05-denied.png`, `05-denied-feed.png`).
6. Ran a real MCP client against the running gateway: two calls actually reached
   the mock calendar and one out-of-scope call was refused. The feed showed each
   `call.allowed`, the forwarded `call.succeeded` with its duration and bytes, and
   the scope violation, all without a reload (`06-live-calls.png`).
7. Appended a burned slip, a receipt and a journal-verify result to the same
   journal the feed tails. All three appeared live and the burned slip joined
   `Decided` with its reason (`07-live-burn-receipt-verify.png`,
   `07-burn-recent.png`). Those three producers are later tickets; see
   **Not proven**.
8. Left the page untouched for 35 seconds. A separate authenticated SSE reader
   recorded `: keep-alive` at +10 s, +20 s and +30 s, then five new feed events
   at +35 s. The page's `performance.timeOrigin` was identical before and after,
   so the new call arrived on the same page without a reload
   (`08-idle-after-35s.png`, `logs/sse-idle.txt`, `logs/browser-drive.txt`).
9. Reloaded. The approved slip still showed both trims and their reason under
   `Decided`; the two untouched slips remained pending
   (`09-refresh-trims.png`).
10. Forced `GET /api/slips` to 500. The screen showed the alert and **Try again**
    while the feed stayed live (`10-error-state.png`). Removing the interception
    and reloading recovered.
11. As a brand-new demo guest with no slips, the empty state rendered with the
    feed connected and no console errors (`14-empty-slips.png`).
12. 390×844: no horizontal overflow (`scrollWidth` 390), the tab bar ended at
    exactly 844 px, and no visible button, input or select was under 44 px
    (`11-phone-slips.png`, `logs/phone-metrics.json`). The feed at phone width
    remained readable (`12-phone-feed.png`).
13. Desktop 1440×900 after the walkthrough (`13-desktop-final.png`).
14. Captured console and network for the whole window. The only console error is
    the deliberate 500 from step 10; every aborted `/api/events` is a navigation
    closing its SSE connection, not a failed feed (`logs/browser-console.txt`,
    `logs/network.txt`). No agent key, capability or secret appears in the page,
    network log or screenshots.

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| 1 | high | The first idle run showed no new event after 35 seconds. Bun's `Bun.serve` default 10-second request timeout closed the SSE stream before the 15-second heartbeat could arrive. Fixed by setting `idleTimeout: 120` and a 10-second heartbeat, with a test that the idle timeout outlives three heartbeats. Re-driven: three heartbeats over 35 seconds, then live events on the same page. | `logs/sse-idle.txt`, `screens/08-idle-after-35s.png`, `logs/browser-drive.txt` | fixed |
| 2 | low | The first console capture had a 404 favicon and Chrome's “password forms should have a username field” warning. Fixed with an inline empty icon and a hidden owner username field. The final capture has neither. | `logs/browser-console.txt`, `apps/web/index.html`, `apps/web/src/screens/Login.tsx` | fixed |
| 3 | low | The only remaining console error is the deliberate `500` used to drive the list error state. | `logs/browser-console.txt`, `screens/10-error-state.png` | accepted (deliberate) |
| 4 | low | The live feed also shows connector, catalog and agent-key journal events, not only the six required categories. The journal is the single event source, so the feed is a superset rather than a second filtered store. | `screens/02-slips-pending.png` | accepted (design) |

## Not proven

- Upstream forwarding end to end in this branch: ticket #11 was merged while this
  ticket was in progress, so the final proof ran against the forwarder and the
  calls actually reached the mock calendar. The 256 KB cap, per-call timeout and
  per-connector concurrency limits belong to #11 and were not re-driven here.
- Burn, receipt and verify producers. No module in this branch emits
  `slip.burned`, `receipt.created` or `journal.verify` yet. The proof appended
  valid journal rows through `inject.ts` to exercise the feed's rendering and
  live delivery, not to claim those producers exist.
- Real Notion, Linear or calendar endpoints, and physical phone use. The phone
  pass is a real 390×844 Chromium viewport, not device emulation.
- A reconnect after the server is restarted mid-stream. The browser's native
  EventSource reconnect and `Last-Event-ID` replay were only exercised by page
  reloads and the gateway test, not by killing the gateway under an open feed.

## Verdict

Verdict: pass
