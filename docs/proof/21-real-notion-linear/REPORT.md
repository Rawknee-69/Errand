# #21 session report - paused

Ticket: **P9 - Real Notion and Linear through the paste-a-URL flow**
Branch: `ticket/21-real-notion-linear` (from `integration` at `b987a8e`)
State: open. Not merged, not closed.

## What this branch changes

- `packages/shared/src/index.ts` - `AuthHint` gains `oauth`; adds
  `oauthStartResponseSchema` / `OAuthStartResponse` so the web and gateway
  share one shape for the start response.
- `apps/gateway/src/connectors/service.ts` - a Bearer challenge carrying
  `resource_metadata` is reported as the `oauth` hint (RFC 9728), instead of
  the generic `bearer` hint.
- `apps/web/src/screens/Connect.tsx`, `apps/web/src/api.ts` - the paste-a-URL
  auth step offers **Sign in (OAuth)** when the probe found one, defaults to
  it, and starts the PKCE flow by navigating to the authorization URL.
- `apps/gateway/tests/connectors/api.test.ts`, `tests/connectors/support.ts` -
  probe against the mock authorization server's protected resource now asserts
  the `oauth` hint.
- `docs/proof/21-real-notion-linear/` - artifacts and `PROOF.md`.

No dependency or version changes.

## Commands run

```powershell
bun install
bun test apps/gateway/tests/connectors/api.test.ts
bun run typecheck
bun test
bun run apps/gateway/src/index.ts
bun run --cwd apps/web dev -- --host 127.0.0.1
bun run --cwd apps/mock-services dev
```

## Test output

```text
bun test v1.4.4 (38afee6c8)

 12 pass
 0 fail
 59 expect() calls
Ran 12 tests across 1 file. [463.00ms]
```

```text
bun run typecheck
@errand/shared typecheck: Exited with code 0
@errand/mock-services typecheck: Exited with code 0
@errand/web typecheck: Exited with code 0
@errand/gateway typecheck: Exited with code 0
✓ 4 checks passed: comments, installed, no-any, oauth-verifier
```

```text
bun test
 251 pass
 0 fail
 678 expect() calls
Ran 251 tests across 33 files. [1433.00ms]
```

## Proven

- Notion's official endpoint (`https://mcp.notion.com/mcp`) and Linear's
  (`https://mcp.linear.app/mcp`) both answer 401 with `resource_metadata`; the
  gateway probe now names that `oauth` and the Connect screen offers sign-in
  (`docs/proof/21-real-notion-linear/logs/real-oauth-start.txt`).
- RFC 9728 discovery, dynamic client registration, PKCE and the authorization
  URL complete in the running gateway for both real services
  (`logs/real-oauth-start.txt`, with `client_id`, `code_challenge`,
  `redirect_uri`, `state`, `resource`).
- Notion consent completed for workspace `rawknee .69's`, the code exchange
  succeeded, and 77 tools were ingested and pinned
  (`screens/07-notion-consent.png`, `screens/08-notion-connected.png`,
  `logs/catalog-notion-active.txt`). Classes: 38 read, 19 write, 2 send, 18
  delete; every `definition_hash` equals `observed_hash`; delete and send are
  not requestable.
- A real agent key requested a read-only slip for `notion__notion_search`
  (`pending`, `learner`) and `errand_call` returned `not_forwarded` /
  `awaiting_approval` (`logs/agent-read-only-request.txt`).
- Linear accepts the registered redirect URI and shows Errand's consent screen
  (`screens/03-linear-consent.png`); pressing Continue still lands on Linear's
  login.
- The full paste-a-URL OAuth path, consent, callback and catalog ingestion works
  against the local MCP authorization server:
  `screens/04-mock-oauth-consent.png`, `screens/05-mock-connected.png`,
  `logs/catalog-after-mock-oauth.txt`. Every tool is classified
  (`read`/`write`/`delete`) and pinned (`definition_hash` equals
  `observed_hash`), and `delete_event` is not requestable.

## Unverified / blocked

1. **Linear consent.** The in-app browser has no Linear session, so the human
   must sign in. The authorization URL cannot complete the code exchange
   without it.
2. **Read-only slip end to end.** The branch has no approval, capability or
   forwarding pipeline; `apps/gateway/src/agent/call.ts` acknowledges calls as
   `awaiting_approval` / `policy_pipeline_not_installed`. Tickets #10 and #11
   are open. The slip request works against Notion, but the call does not run.
3. **Linear tool catalog.** Classification and pinning for Linear is
   unverified until (1) completes. Notion's is proven.
4. The ticket's DEVIATIONS rule is recorded as row 6: Notion is connected;
   Linear reaches its own login, consent awaits the owner's signed-in browser
   session, and nothing was simulated.

## Side finding

Abandoned or expired OAuth attempts leave a connector row `pending` forever.
Filed as #42 with the evidence; not fixed here because it is outside #21.

## Next

Human sign-in for Linear, then re-run consent and capture its catalog. Finish
the slip criterion after #10/#11.
