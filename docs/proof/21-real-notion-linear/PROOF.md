# Proof - #21 Real Notion and Linear through the paste-a-URL flow

> Status: **Notion connected; paused for Linear sign-in and the slip pipeline
> (#10, #11).**
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
   Pressing **Continue** led to Linear's login page, which still needs the
   owner's session.
6. Direct HTTP drives of the same flow outside the browser, with the gateway
   in-process and an in-memory database, completed discovery, registration and
   PKCE for both real services and returned authorization URLs:
   `logs/real-oauth-start.txt`.
7. To prove the whole paste-a-URL OAuth path mechanically against a real MCP
   server (not a stub), connected the mock authorization server's
   `http://127.0.0.1:4001/oauth/mcp`: consent (`screens/04-mock-oauth-consent.png`),
   callback (`screens/05-mock-connected.png`), then ingested catalog with classes
   and pinned hashes (`logs/catalog-after-mock-oauth.txt`):
   `list_events` read/requestable, `create_event` write/requestable,
   `delete_event` delete/human-only, every row with `definition_hash` equal to
   its `observed_hash`.

## Not driven

- Linear consent and tool catalog: the browser stops at Linear's login page,
  which needs the owner's session.
- A read-only slip running end to end: the branch has no approval, policy
  pipeline or forwarder yet (tickets #10 and #11 are open). The agent surface
  stops at `request_errand` and acknowledges calls as `awaiting_approval`.

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| 1 | blocker | Linear consent cannot be granted until the owner signs in in the browser | `screens/03-linear-consent.png` | blocked on human |
| 2 | blocker | A read-only slip cannot run end to end without the P4/P5 pipeline (#10, #11) | `logs/agent-read-only-request.txt` | blocked on tickets |
| 3 | low | After the OAuth callback the browser lands on a plain gateway page with a link to the JSON catalog; there is no route back into the web app | `screens/05-mock-connected.png` | filed as #43 |
| 4 | medium | Abandoned or expired OAuth attempts leave a permanently `pending` connector row; no UI or API deletes it | `logs/catalog-after-mock-oauth.txt` (four pending rows from three starts) | filed as #42 |

## Verdict

Verdict: fail - not because a step misbehaved, but because two required steps
have not been driven: Linear consent (owner sign-in) and the read-only slip
call (needs #10/#11). Notion is connected, classified and pinned. Re-run the
two remaining steps, then replace this verdict.
