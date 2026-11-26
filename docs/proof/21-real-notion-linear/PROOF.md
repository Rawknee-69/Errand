# Proof - #21 Real Notion and Linear through the paste-a-URL flow

> Status: **paused for human sign-in and for the slip pipeline (#10, #11).**
> This is not a final proof. It records what was driven, what was observed, and
> exactly what remains.

## Environment

- Git branch `ticket/21-real-notion-linear`, cut from `integration` at `b987a8e`.
- Gateway `http://127.0.0.1:8787` with an untracked `.env`, fresh
  `errand-proof.db`, `ALLOW_LOCALHOST_DEV=true`, `SESSION_COOKIE_SECURE=false`
  for plain-http loopback, `OAUTH_REDIRECT_URI=http://127.0.0.1:8787/api/oauth/callback`.
- Web dev server `http://127.0.0.1:5173` (`vite --host 127.0.0.1`), mock MCP +
  OAuth services `http://127.0.0.1:4001`.
- In-app Chromium browser, desktop viewport. Logged in as the owner.
- Bun 1.4.4, TypeScript 7.0.2.

## What was driven

1. Pasted `https://mcp.notion.com/mcp` into Connect. The probe reported
   `Protected - it asks for oauth. 0 tools` and offered **Sign in (OAuth)**
   selected by default: `screens/01-notion-oauth-choice.png`.
2. Pressed **Sign in and connect**. Errand performed RFC 9728 discovery,
   dynamic client registration and a PKCE authorization request, then the
   browser landed on Notion's real login page: `screens/06-notion-login.png`.
   **This is where the run stopped: the browser profile has no Notion session.**
3. Pasted `https://mcp.linear.app/mcp` and repeated the steps. Linear showed
   Errand's real consent screen with the registered redirect URI
   `http://127.0.0.1:8787/api/oauth/callback` and scopes Read, Write:
   `screens/02-linear-oauth-choice.png`, `screens/03-linear-consent.png`.
   Pressing **Continue** led to Linear's login page, which also needs a human
   session.
4. Direct HTTP drives of the same flow outside the browser, with the gateway
   in-process and an in-memory database, completed discovery, registration and
   PKCE for both real services and returned authorization URLs:
   `logs/real-oauth-start.txt`.
5. To prove the whole paste-a-URL OAuth path mechanically against a real MCP
   server (not a stub), connected the mock authorization server's
   `http://127.0.0.1:4001/oauth/mcp`: consent (`screens/04-mock-oauth-consent.png`),
   callback (`screens/05-mock-connected.png`), then ingested catalog with classes
   and pinned hashes (`logs/catalog-after-mock-oauth.txt`):
   `list_events` read/requestable, `create_event` write/requestable,
   `delete_event` delete/human-only, every row with `definition_hash` equal to
   its `observed_hash`.

## Not driven

- Notion consent and tool catalog: needs a signed-in Notion workspace in the
  browser.
- Linear consent and tool catalog: needs a signed-in Linear workspace in the
  browser.
- A read-only slip end to end: the branch has no approval, policy pipeline or
  forwarder yet (tickets #10 and #11 are open). The agent surface stops at
  `request_errand` and acknowledges calls as `awaiting_approval`.

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| 1 | blocker | Neither real workspace is signed in in the browser, so consent cannot be granted without the human | `screens/06-notion-login.png` | blocked on human |
| 2 | blocker | A read-only slip cannot run end to end without the P4/P5 pipeline (#10, #11) | - | blocked on tickets |
| 3 | low | After the OAuth callback the browser lands on a plain gateway page with a link to the JSON catalog; there is no route back into the web app | `screens/05-mock-connected.png` | filed as #43 |
| 4 | medium | Abandoned or expired OAuth attempts leave a permanently `pending` connector row; no UI or API deletes it | `logs/catalog-after-mock-oauth.txt` (four pending rows from three starts) | filed as #42 |

## Verdict

Verdict: fail - not because a step misbehaved, but because two required steps
have not been driven. Re-run from consent after the human signs in, and after
#10/#11 merge, then replace this verdict.
