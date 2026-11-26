# Proof — #7 P2 · OAuth 2.1 with PKCE, and a refresh lifecycle that survives rotation

## Environment

- Git branch `ticket/07-oauth-pkce`, cut from `integration` at `9647026`.
- Gateway on `http://127.0.0.1:8788`, SQLite at
  `%TEMP%\opencode\errand-07-proof.db`, `ALLOW_LOCALHOST_DEV=true`,
  `OAUTH_REDIRECT_URI=http://127.0.0.1:8788/api/oauth/callback`.
- Mock services on `http://127.0.0.1:4002` — a real authorization server plus
  a real MCP resource server from the SDK, not a stub. It serves RFC 9728
  protected-resource metadata, RFC 8414 authorization-server metadata, RFC 7591
  dynamic registration, an Authorization Code + PKCE (S256) consent form,
  RFC 9207 issuer responses, rotating refresh tokens, and a bearer-protected
  `/oauth/mcp`.
- Client: `docs/proof/07-oauth-pkce/drive.mjs` (Bun `fetch`, real HTTP) for the
  full API transcript; the in-app Chromium for the real consent click.
- Bun 1.4.4, TypeScript 7.0.2, `@modelcontextprotocol/client` and `/server`
  2.4.0.
- Ports 8787 and 4001 were occupied by the parallel ticket #8 session, so the
  proof runs on 8788/4002. Nothing in the ticket depends on the port.

## Steps driven

1. `POST /api/connectors/oauth/start` for the mock OAuth MCP server — 201.
   Connector is `authType: oauth`, `authStatus: pending`. The returned
   authorization URL carries `code_challenge_method=S256`, a 43-character
   `state`, the exact `redirect_uri`, and the resource indicator. Discovery and
   dynamic registration ran inside the SDK: the mock recorded exactly one
   client registration.
2. Open that URL in the in-app browser — the authorization server renders a
   consent form (`screens/01-consent.jpg`). The page contains no token, secret
   or client secret; console is empty.
3. Click **Approve** — 302 to the gateway callback with `code`, `state` and
   `iss`; the gateway exchanges the code, stores the tokens in the Vault,
   discovers three tools and shows the Connected page
   (`screens/02-connected.jpg`). Console and network are clean.
4. Click **Open the catalog** — `GET /api/catalog` shows the OAuth connector
   `active`, `lastAuthError: null`, and its three tools
   (`screens/03-catalog.jpg`, full body in `logs/catalog.json`).
5. `GET /api/journal/verify` — `{"ok":true,"checked":22}` after the whole run.
6. `POST /api/connectors/:id/refresh` — 200. The access token and the refresh
   token both change; the mock reports one refresh grant and one rotation. A
   stale refresh token would now be rejected, so the stored token is provably
   the rotated one.
7. Two refreshes issued concurrently — both 200, mock reports three rotations
   in total and exactly one live refresh token. Without the per-connector lock
   the second call would present a burned token and fail.
8. Revoke the refresh token at the authorization server, then refresh — 409
   `reauth`, connector `needs_reauth`. The mock shows one rejected refresh
   grant and no second attempt: the SDK reports `invalid_grant`, the hook
   deletes the tokens and journals `connector.needs_reauth` once. A second
   refresh while already `needs_reauth` makes no grant at all.
9. A second connector authorized normally, then the resource server set to
   answer 401 regardless of token. Refresh — 409, `lastAuthError:
   upstream_401`, `needs_reauth`. This is the repeated 401 after a successful
   refresh; the gateway stops rather than retrying.
10. A third attempt with `iss=https://evil.example` — 400 `oauth_issuer`,
    connector `needs_reauth`. The recorded discovery issuer did not match.
11. A fourth attempt whose callback is submitted twice — first 200, replay 400
    `oauth_state`. The attempt row is consumed and the connector stays active.
12. The driver leaves one authorization attempt uncompleted. Direct database
    read (`logs/db-scan.txt`): `oauth_attempts` has no `code_verifier` column;
    every OAuth credential row is sealed (`ciphertext`, `nonce`, `auth_tag`,
    `wrapped_data_key`), and no ciphertext or plain column contains
    `access_token`, `refresh_token`, `client_secret` or `codeVerifier`. The
    remaining state is 43 characters and its `expires_at - created_at` is
    exactly 600000 ms. Completed attempts are deleted, which is why only the
    pending one appears.
13. A callback delivered to a different `OAUTH_REDIRECT_URI` is rejected with
    400 `oauth_state` (unit test, `tests/connectors/oauth.test.ts`, "rejects a
    callback delivered to a different redirect URI than the attempt").

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| — | — | No open finding. | — | — |

Observations, not defects:

- The gateway log contains one SDK warning:
  `[mcp-sdk] OAuth "invalid_grant" — invalidating the stored tokens and
  retrying authorization` (`logs/gateway-server.txt`). It is the SDK narrating
  step 8 before the provider's invalidation hook deletes the tokens and marks
  `needs_reauth`. The retry it describes is the one the hook turns into a stop,
  not a loop; the mock grant count proves the endpoint was called once.
- After the rejected refresh, a later manual refresh updates `lastAuthError`
  from `invalidated_tokens` to `no_tokens`. Both are secret-free reasons for the
  same state; the `needs_reauth` journal event is emitted once, on the
  transition (`logs/db-scan.txt`, `connector.needs_reauth: 3`).

## Not proven

- Phone viewport 390×844: this ticket adds no control-panel screen. The only
  pages are the authorization server's single-column consent form and the
  gateway's callback confirmation; the control panel is #16.
- HTTPS certificate validation; the mock is loopback HTTP with the dev flag, as
  in #5 and #6.
- A real third-party authorization server (Notion/Linear) — their ticket is #9.
  The flow uses standard RFC 9728/8414/7591/RFC 9207 endpoints and was driven
  against the mock only.

## Verdict

Verdict: pass
