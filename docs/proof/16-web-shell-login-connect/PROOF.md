# Proof — #16 P7 · Web shell, login and Connect screen

## Environment

- Git branch `ticket/16-web-shell-login-connect`, cut from `integration` at `9647026`.
- Gateway on `http://127.0.0.1:8787`, fresh SQLite file, `ALLOW_LOCALHOST_DEV=true`,
  `DEMO_MODE=true`, `OWNER_PASSPHRASE` set in an untracked local `.env` (removed
  before the final suite; not recorded here).
- Mock services on `http://127.0.0.1:4001` — real MCP servers from the SDK, with
  the Streamable HTTP calendar (3 tools) used as the pasted URL.
- A second gateway on `http://127.0.0.1:8789` with `DEMO_MODE=false` to prove the
  demo path is off by default.
- Clients: in-app Chromium for the first walkthrough; Playwright Chromium at
  desktop 1440×900 and phone 390×844 for the committed captures; `curl.exe` for
  the HTTP transcript.
- Bun 1.4.4, TypeScript 7.0.2, React 19.3.1, Vite 8.3.8, jose 6.2.18.
- After this walkthrough, code review found two auth defects (a demo session
  outliving demo mode, and demo sign-ins bypassing the limiter). Both were
  fixed with regression tests and the suite was re-run; the browser captures
  were re-taken against the fixed build.

## Steps driven

1. Load `/` logged out — login card renders; while demo is enabled the Owner /
   Demo guest picker is present (`01-login.png`).
2. Wrong passphrase — 401, inline error "That passphrase is not correct", no
   navigation (`02-login-error.png`, `logs/http-auth-transcript.txt`).
3. Correct passphrase — 200, `Set-Cookie: errand_session=…; Max-Age=3600;
   Path=/; HttpOnly; Secure; SameSite=Lax`; `document.cookie` is empty, so
   the session is not script-readable (`02-login-error.png`,
   `logs/http-auth-transcript.txt`).
4. `GET /api/connectors` without a cookie — 401. With the session — 200
   (`logs/http-auth-transcript.txt`).
5. Connect step 1: paste `http://127.0.0.1:9/mcp` — refused with "That server
   did not answer" and no navigation (`04-connect-error.png`).
6. Paste `http://127.0.0.1:4001/calendar/mcp` — probe reports open,
   Streamable HTTP, 3 tools; auth is preselected to No auth
   (`05-connect-auth.png`).
7. Connect — 201; connector card shows `create_event` write/requestable,
   `delete_event` delete/human only, `list_events` read/requestable
   (`06-connect-connected.png`, `15-phone-connected.png`).
8. Create agent key — key shown once with the one-time warning, Claude Code
   one-liner and Cursor JSON (`07-agent-key.png`, `16-phone-key.png`). Keys are
   redacted in the committed screenshots; the live page showed the real key.
9. Switch to Cursor and press Copy JSON — button reports Copied
   (`08-cursor-copied.png`).
10. Reload the page — session survives, the Connect screen resets, and no key
    is shown again. The database stores a 64-hex-character SHA-256 hash and no
    key column (`logs/journal-and-keys.txt`).
11. Every route in the shell — Connectors, Catalog, Slips, Receipts, Trust,
    Journal, Keys — opens the expected placeholder with its ticket number and
    keeps the URL (`09-catalog-placeholder.png`,
    `10-connectors-placeholder.png`, `11-keys-placeholder.png`,
    `18-demo-signed-in.png`). Eight screens including Connect, one entry in a
    single navigation source.
12. Sign out — cookie cleared, login returns. Sign in through the demo picker as
    "Sam Rivera" — dashboard shows Sam and Sam's own (empty) connector list;
    the session view reports `demoMode:true` (`17-demo-picker.png`,
    `18-demo-signed-in.png`).
13. Journal read directly from SQLite after the demo sign-in — a
    `demo.login` event with `{name:"Maya Chen", userId:"demo-maya-chen"}`
    exists, and every `agent_key.created` payload names only the key id and
    label (`logs/journal-and-keys.txt`).
14. Demo-off gateway on 8789 — `/api/auth/session` returns
    `demoMode:false`; a demo login returns 403 `demo_disabled`; the journal
    still has 0 rows (`logs/http-auth-transcript.txt`).
15. Five wrong passphrases then the correct one — the correct attempt returns
    429 with `retry-after: 60`, so a correct guess cannot be tested while
    limited (`logs/rate-limit-transcript.txt`).
16. Phone audit at 390×844 — eight tabs fit without scrolling, the tab bar ends
    at y=844, and every visible button/input is at least 44×44 CSS pixels
    (`logs/phone-metrics.json`, `12`–`16-phone-*.png`).
17. Secret scan over the proof artifacts and the gateway directory — zero
    plaintext `errand_` keys (`logs/secret-scan.txt`).
18. Regression tests added after review: a demo cookie is rejected once
    `DEMO_MODE` is off, and the sixth demo sign-in in the window gets 429
    (`logs/test-output.txt`, `apps/gateway/tests/auth/api.test.ts`).

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| 1 | medium | Copy buttons and the Claude Code / Cursor tabs measured 40px high at 390×844, below the 44px touch minimum | `logs/phone-metrics.json` (after fix: `undersized: []`) | fixed |
| 2 | medium | Clipboard write rejected in the automated Chromium profile, so Copy reported failure; added an `execCommand` textarea fallback | `08-cursor-copied.png` (button shows "Copied") | fixed |
| 3 | low | Long agent tool names were ellipsised on the phone; now wrap in full, with class and requestable chips on the next line | `15-phone-connected.png` | fixed |
| 4 | high | A demo session cookie stayed valid after `DEMO_MODE` was turned off. `currentClaims` now rejects a `demo` claim unless demo mode is on, and clears the cookie | `logs/test-output.txt` (`invalidates a demo session when demo mode is turned off`) | fixed |
| 5 | medium | Demo sign-ins skipped the login limiter, so an open demo minted unlimited sessions. Every demo attempt now counts, and the sixth in the window is 429 | `logs/test-output.txt` (`rate limits repeated demo sign-ins`) | fixed |

## Not proven

- The Claude Code and Cursor snippets were copied but not executed by those
  clients. The `/mcp` endpoint and agent-key bearer check are ticket #8's,
  exercised by its own MCP-client tests.
- Agent key listing and revocation are not in this screen; the Keys screen is
  the #19 placeholder.
- OAuth connectors (#7) and real Notion/Linear endpoints (#9) were not driven.
- Demo mode off was proven over HTTP and by unit test, not by a second browser
  profile pointed at the 8789 gateway; the UI simply omits the picker when
  `demoMode` is false, which the login component gates on that field.
- OAuth is not selectable on the Connect screen: the gateway's auth variants
  and the OAuth flow belong to ticket #7. A server that challenges with OAuth
  currently gets the bearer hint.
- The demo picker is a free-text name, not the three seeded friends from the
  full demo; seeding is ticket #20.
- One-handed use was assessed by viewport and touch-target audit, not on a
  physical phone with a thumb.
- The rate-limit window reset was proven by injection in the unit test, not by
  waiting 60 seconds in the browser.

## Verdict

Verdict: pass
