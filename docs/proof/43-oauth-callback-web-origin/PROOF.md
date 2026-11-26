# Proof — #43 OAuth callback returns to the control panel

## Environment

- Branch `ticket/43-oauth-callback-web-origin`, cut from `integration` at
  `121b62a`.
- Gateway **after** on `http://127.0.0.1:8788` with
  `WEB_ORIGIN=http://127.0.0.1:5173`,
  `OAUTH_REDIRECT_URI=http://127.0.0.1:8788/api/oauth/callback`,
  `ALLOW_LOCALHOST_DEV=true`, `SESSION_COOKIE_SECURE=false`, and SQLite at
  `%TEMP%\opencode\errand-43-after.db`.
- Gateway **before** on `http://127.0.0.1:8789`, same configuration minus
  `WEB_ORIGIN`, SQLite at `%TEMP%\opencode\errand-43-before.db`. Both gateways
  booted as real processes (`logs/gateway-after-server.txt`,
  `logs/gateway-before-server.txt`).
- Mock services on `http://127.0.0.1:4002`: a real authorization server with
  Authorization Code + PKCE (S256) consent, RFC 9207 issuer, and a
  bearer-protected `/oauth/mcp` resource server — the same mock #7 and #21
  drove, not a stub.
- Web control panel on `http://127.0.0.1:5173`, Vite proxying `/api` to the
  after gateway via `GATEWAY_URL=http://127.0.0.1:8788`.
- Browser: Microsoft Edge driven with Playwright (`browser.mjs`). The
  Playwright MCP server is pinned to the Chrome channel and Chrome is not
  installed on this machine; installing it needs Administrator, so Edge is the
  Chromium build used. `browser.mjs` ran with `playwright-core` 1.65.1 from a
  temporary directory; the repo gains no dependency.
- Bun 1.4.4, TypeScript 7.0.2, Zod 4.6.7.

## Steps driven

1. Opened `http://127.0.0.1:5173/`, signed in with the owner passphrase —
   login screen captured (`screens/01-login-desktop.png`), landed on the
   Connect screen (`screens/02-connect-desktop.png`).
2. Opened **Connectors** with an empty database — the empty state rendered
   “Nothing connected” (`screens/03-connectors-empty-desktop.png`).
3. Started the paste-a-URL OAuth flow through the control-panel origin
   (`POST /api/connectors/oauth/start`, 201, connector pending). The
   authorization URL opened the mock consent page
   (`screens/04-consent-desktop.png`).
4. Clicked **Approve**. The browser followed the mock 302 to the gateway
   callback, the gateway answered `302 Location:
   http://127.0.0.1:5173/connectors`, and the browser landed on the Connectors
   screen (`screens/05-connectors-after-redirect-desktop.png`) with one
   `Mock calendar (browser)` card, `ACTIVE`, three tools. Network window in
   `logs/browser-window.txt` shows `302 POST /oauth/authorize` →
   `302 GET :8788/api/oauth/callback` → `200 GET :5173/connectors`.
5. Pressed **Refresh catalog** on the card — `200 POST
   /api/connectors/:id/refresh`, the card stayed `ACTIVE` with a fresh last
   success (`screens/06-connectors-after-refresh-desktop.png`).
6. Opened **Catalog** — the three discovered tools rendered
   (`screens/07-catalog-desktop.png`).
7. Returned to **Connectors** at phone viewport 390×844 — the layout stayed
   within the viewport (`scrollWidth=390`, `innerWidth=390`,
   `screens/08-connectors-phone.png`).
8. Checked the page text for `access_token`, `refresh_token`, `client_secret`
   and `code_verifier` — none visible.
9. Real HTTP driver (`drive.mjs`) against the after gateway
   (`logs/after-transcript.txt`):
   - `Accept: text/html` → `302`, `Location: http://127.0.0.1:5173/connectors`,
     empty body (lines 9–13).
   - Replaying the same consumed callback → `400 application/json`
     `oauth_state` (lines 14–18).
   - An unknown state with `Accept: text/html` → `400 application/json`
     `oauth_state`, not a redirect (lines 19–21).
   - Requesting the consent page a second time mid-flow (the driver labels it
     `refresh mid-flow`), then approving → `302` to `/connectors`
     (lines 22–32).
   - No HTML accept → `200 application/json`, existing connector detail
     (lines 39–43).
   - Callback with `webOrigin=https://evil.example&next=https://evil.example`
     → still `302 http://127.0.0.1:5173/connectors` (lines 50–54).
10. Before case on the gateway with no `WEB_ORIGIN`
    (`logs/before-transcript.txt`): the same callback answered `200 text/html`
    with the “Connected” page and only an “Open the catalog” link to
    `/api/catalog` (`screens/09-before-deadend-desktop.png`, lines 9–13); an
    unknown state still answered `400 application/json` (lines 14–16).
11. Suite and typecheck run from the final tree; output committed as
    `logs/test-output.txt` and `logs/typecheck.txt` (335 pass, 0 fail;
    four typecheck targets and four checks green).

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| 1 | low | The Vite dev server answers `GET /favicon.ico` with 404, so the browser console logs “Failed to load resource: … 404” twice. Pre-existing: `apps/web/index.html` declares no icon and this ticket does not touch the web app. | `logs/browser-window.txt` (`console [error]` lines) and `logs/favicon-404.txt` (`GET /favicon.ico` → 404) | noted, out of scope |

Observations, not defects:

- The gateway emits only its startup line; it has no per-request logging. The
  request window is therefore captured in `logs/browser-window.txt` (browser
  console, network, SSE-free fetch sequence) and the two driver transcripts,
  not in the gateway log.
- The browser console also carries the dev-only Vite connection logs and one
  verbose Chromium accessibility note about password forms. No runtime error
  or failed API request occurs during the flow.
- The committed transcripts and browser window redact the one-shot `code` and
  `state` query values; the paths, statuses and `iss` are unchanged.
- The Connect screen has no OAuth option of its own; the flow was started
  through `POST /api/connectors/oauth/start` from the control-panel origin, the
  same API the paste-a-URL flow uses. Starting OAuth from the UI is outside
  this ticket.

## Not proven

- The consent **deny** path: the mock consent page offers only **Approve**, and
  the gateway's OAuth failure response is explicitly out of scope.
- A real third-party authorization server (Notion, Linear); the mock implements
  the same RFC 9728/8414/7591/9207 surface.
- HTTPS and a production reverse proxy. `WEB_ORIGIN` behind Caddy is P10; this
  run uses loopback HTTP and the dev egress flag.
- Chrome itself; Edge is the Chromium build available without Administrator.

## Verdict

Verdict: pass
