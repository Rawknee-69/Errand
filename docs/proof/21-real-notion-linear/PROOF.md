# Proof - #21 Real Notion and Linear through the paste-a-URL flow

> Status: **Both real services connected, classified and pinned; the read-only
> slip call is blocked on the P4/P5 pipeline (#10, #11).**
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
   dynamic client registration and a PKCE authorization request. Before the
   owner signed in, the browser stopped at Notion's login page:
   `screens/06-notion-login.png`.
3. After the owner signed in, the same flow reached Notion's real consent
   screen for workspace `rawknee .69's`, showing the registered redirect URI
   `http://127.0.0.1:8787/api/oauth/callback` (`screens/07-notion-consent.png`).
   **Continue** completed the code exchange, the gateway ingested the catalog,
   and the callback page reported success (`screens/08-notion-connected.png`).
   Pinned catalog: 77 Notion tools - 38 read, 19 write, 2 send, 18 delete,
   every `definition_hash` equal to its `observed_hash`; delete/send tools are
   not requestable (`logs/catalog-notion-active.txt`).
4. With a real agent key, an MCP client connected to `/mcp`, saw the four
   Errand tools, and requested a read-only slip for
   `notion__notion_search`. The slip was created as `pending` / `learner`.
   `errand_call` answered `not_forwarded` / `awaiting_approval`, which is the
   current end of the agent surface (`logs/agent-read-only-request.txt`).
   The call itself did not run: no approval or forwarder exists yet.
5. Pasted `https://mcp.linear.app/mcp` and repeated the steps. Linear showed
   Errand's real consent screen with the registered redirect URI
   `http://127.0.0.1:8787/api/oauth/callback` and scopes Read, Write:
   `screens/02-linear-oauth-choice.png`, `screens/03-linear-consent.png`.
   Before the owner signed in, **Continue** landed on Linear's login page.
6. After the owner signed in, the same flow completed: the code exchange
   succeeded and the callback page reported success
   (`screens/09-linear-connected.png`). Pinned catalog: 70 Linear tools - 38
   read, 6 write, 1 send, 25 delete, every `definition_hash` equal to its
   `observed_hash`; delete and send tools are not requestable
   (`logs/catalog-both-active.txt`: Linear 70/70 pinned, Notion 77/77 pinned).
7. Direct HTTP drives of the same flow outside the browser, with the gateway
   in-process and an in-memory database, completed discovery, registration and
   PKCE for both real services and returned authorization URLs:
   `logs/real-oauth-start.txt`.
8. To prove the whole paste-a-URL OAuth path mechanically against a real MCP
   server (not a stub), connected the mock authorization server's
   `http://127.0.0.1:4001/oauth/mcp`: consent (`screens/04-mock-oauth-consent.png`),
   callback (`screens/05-mock-connected.png`), then ingested catalog with classes
   and pinned hashes (`logs/catalog-after-mock-oauth.txt`):
   `list_events` read/requestable, `create_event` write/requestable,
   `delete_event` delete/human-only, every row with `definition_hash` equal to
   its `observed_hash`.

9. Refreshed both connected connectors through the API with the stored tokens:
   Notion re-listed 77 tools (all unchanged), Linear 70 (all unchanged),
   proving the tokens work beyond the first exchange
   (`logs/connector-refresh.txt`).

## Not driven

- A read-only slip running end to end: the branch has no approval, policy
  pipeline or forwarder yet (tickets #10 and #11 are open). The agent surface
  stops at `request_errand` and acknowledges calls as `awaiting_approval`.

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| 1 | high | Before the owner signed in, Linear consent stopped at its login page | `screens/03-linear-consent.png` | resolved after sign-in (`screens/09-linear-connected.png`) |
| 2 | blocker | A read-only slip cannot run end to end without the P4/P5 pipeline (#10, #11) | `logs/agent-read-only-request.txt` | blocked on tickets |
| 3 | low | After the OAuth callback the browser lands on a plain gateway page with a link to the JSON catalog; there is no route back into the web app | `screens/05-mock-connected.png` | filed as #43 |
| 4 | medium | Abandoned or expired OAuth attempts leave a permanently `pending` connector row; no UI or API deletes it | `logs/catalog-after-mock-oauth.txt` (four pending rows from three starts) | filed as #42 |

## Verdict

Verdict: fail - one required step has not been driven: a read-only slip
actually running (needs #10/#11). Both real services connect, classify and pin,
and a read-only slip can be requested against Notion. Re-run the call once the
pipeline exists, then replace this verdict.
