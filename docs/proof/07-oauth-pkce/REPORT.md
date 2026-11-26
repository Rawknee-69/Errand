# Ticket #7 — P2 · OAuth 2.1 with PKCE, and a refresh lifecycle that survives rotation

## Files built

- `apps/gateway/src/connectors/oauth/service.ts` — start, callback and refresh
  orchestration on top of the SDK's `auth()`. Random 32-byte single-use state,
  ten-minute attempt, exact redirect URI, issuer check, per-connector refresh,
  `needs_reauth` transitions and journal events.
- `apps/gateway/src/connectors/oauth/provider.ts` — `OAuthClientProvider`
  adapter: client metadata, registration, tokens, discovery state, verifier
  and invalidation, all behind the vault; a background refresh never redirects.
- `apps/gateway/src/connectors/oauth/store.ts` — typed, vault-backed connector
  and attempt state; JSON is narrowed by Zod or a schema guard, never `any`.
- `apps/gateway/src/connectors/oauth/lock.ts` — per-connector lock so a rotated
  refresh token is never presented twice.
- `apps/gateway/src/connectors/oauth/errors.ts` — typed reauth failure.
- `apps/gateway/src/connectors/records.ts` — `ConnectorView` (now with
  `authStatus`/`lastAuthError`), scoped row lookup and status update, shared by
  the plain and OAuth services.
- `apps/gateway/src/connectors/discovery.ts` — the transport-update → ingest →
  journal sequence, extracted from `service.ts` for both callers.
- `apps/gateway/src/connectors/service.ts` — OAuth refresh now routes through
  the locked path; moved view/row/discovery helpers out.
- `apps/gateway/src/vault/credentials.ts` — transactional `mutateSecret`
  (read-modify-write of a rotated refresh token), `remove`, and the shared
  sealing path.
- `apps/gateway/src/app.ts` — `POST /api/connectors/oauth/start`,
  `GET /api/oauth/callback`, a secret-free confirmation page, and error
  mapping for `oauth_state`, `oauth_issuer` and `reauth`.
- `apps/gateway/src/config.ts`, `src/index.ts`, `.env.example` —
  `OAUTH_REDIRECT_URI` with a loopback default.
- `apps/gateway/src/db/schema.ts` plus migration `0003` — connector
  `auth_status`/`last_auth_error`; `oauth_attempts` loses `code_verifier`
  (the verifier lives encrypted in the Vault).
- `packages/shared/src/html.ts` — one `escapeHtml` used by the consent page and
  the gateway confirmation page.
- `scripts/checks/oauth-verifier.ts` — fails the build if `oauth_attempts`
  grows a plaintext verifier column again.
- `apps/mock-services/src/oauth.ts` and `server.ts` — a real mock authorization
  server: RFC 9728 and RFC 8414 metadata, RFC 7591 registration, consent form,
  S256 PKCE, RFC 9207 issuer, rotating refresh tokens, and a bearer-protected
  MCP resource.
- Tests: `apps/gateway/tests/connectors/oauth.test.ts` (8 tests),
  `apps/mock-services/tests/oauth.test.ts` (3 tests),
  `apps/gateway/tests/connectors/support.ts`, `tests/db/scoped.test.ts`.
- Proof: `docs/proof/07-oauth-pkce/` (`PROOF.md`, `drive.mjs`, `db-scan.mjs`,
  transcript, browser window, catalog body, screenshots).

## Commands run

```
bunx drizzle-kit generate --name oauth_connector_state   # in apps/gateway
bun run typecheck
bun test apps/gateway/tests/connectors/oauth.test.ts
bun test apps/mock-services/tests/oauth.test.ts
bun test
bun run apps/mock-services/src/index.ts                  # PORT=4002
bun run apps/gateway/src/index.ts                        # PORT=8788, proof env
bun run docs/proof/07-oauth-pkce/drive.mjs               # API transcript
$env:DB=...; bun run docs/proof/07-oauth-pkce/db-scan.mjs
# browser: open authorization URL, Approve, Open the catalog
```

## Test output

```
$ bun run typecheck
@errand/shared typecheck: Exited with code 0
@errand/web typecheck: Exited with code 0
@errand/mock-services typecheck: Exited with code 0
@errand/gateway typecheck: Exited with code 0
✓ 4 checks passed: comments, installed, no-any, oauth-verifier

$ bun test
apps\gateway\tests\connectors\oauth.test.ts:
[mcp-sdk] OAuth "invalid_grant" — invalidating the stored tokens and retrying authorization. Cause: "refresh token is invalid, rotated or revoked"

 236 pass
 0 fail
 629 expect() calls
Ran 236 tests across 31 files. [1255.00ms]
```

Full output: `docs/proof/07-oauth-pkce/logs/typecheck.txt` and
`logs/test-output.txt`.

## Proof

- `docs/proof/07-oauth-pkce/PROOF.md` — verdict: pass.
- `docs/proof/07-oauth-pkce/logs/oauth-transcript.txt` — start, consent,
  redirect, callback, refresh, concurrent refresh, rotation, invalid_grant,
  repeated 401, issuer mismatch, state replay, journal verify.
- `docs/proof/07-oauth-pkce/logs/db-scan.txt` — no verifier column, sealed
  credentials only, 43-character states, 600000 ms TTL.
- `docs/proof/07-oauth-pkce/logs/browser-window.txt` — the real consent click,
  callback page and catalog page, with console and network.
- `docs/proof/07-oauth-pkce/screens/01-consent.jpg`,
  `screens/02-connected.jpg`, `screens/03-catalog.jpg`.
- `docs/proof/07-oauth-pkce/logs/gateway-server.txt` and
  `logs/mock-services-server.txt` — clean window; one expected SDK warning.

## Versions changed

None. The OAuth client comes from the already-installed
`@modelcontextprotocol/client` 2.4.0; no dependency was added or bumped.

## Review findings addressed

Standards:
- Escaped the connector name on the confirmation page and moved `escapeHtml`
  into `packages/shared`, ending the second home for it.
- Replaced every `as { … }` JSON cast in the new tests with Zod schemas; the
  `Object.keys(...) as Array<keyof Counters>` reset is now explicit assignments.
- Extracted `deleteAttempt` (three copies) and `runAuthorizationLeg` (two
  copies of provider → `auth` → result check); attempts are now deleted on
  consume, expiry, issuer mismatch and discard instead of lingering.
- Added `scripts/checks/oauth-verifier.ts` so a plaintext verifier column fails
  the build, per ADR 0002.
- `ConnectorAuthStatus` is exported as `CONNECTOR_AUTH_STATUSES` and the test
  schema uses it; `MOCK_OAUTH_PATHS`/`MOCK_OAUTH_SCOPE` are no longer exported.
- Removed the storage-prefix assertions from the verifier test; it now checks
  the ten-minute lifetime and that no attempt row carries the verifier.

Spec:
- An issuer is required when discovery advertises
  `authorization_response_iss_parameter_supported`, so a missing `iss` is
  rejected as well as a mismatched one.
- A discovery failure after a successful code exchange no longer leaves the
  connector `pending`: an auth 401 marks `needs_reauth`, anything else keeps
  the connector `active` with a secret-free reason and a
  `connector.oauth_discovery_failed` event.
- `needs_reauth` is now only forced for `invalid_grant`, client errors, issuer
  mismatch and a redirect-required refresh. A transient network failure keeps
  the connector `active`, journals `connector.oauth_refresh_failed`, and
  returns 502 `oauth_failed` instead of making the human sign in again.
- Expired attempts are swept on each start and callback, so an abandoned
  verifier does not outlive its ten-minute window.

## Deviations / not done

- The diff exceeds the workflow's ~300-line review threshold, as #6 did. The
  ticket is a single vertical slice (discovery → registration → PKCE → token
  storage → refresh → invalidation) and splitting it after the fact would not
  change the running system; both review axes were run over the whole change.
- Discovery state is cached per connector in the Vault. Two simultaneous start
  attempts for the same connector are not a flow the surface exposes (start
  creates a new connector), so the cache is not sharded per attempt.
- The OAuth access token is passed to the MCP transport as a bearer header for
  each discovery. Transport-level `onUnauthorized` refresh is left to #8's
  agent-call path; this ticket refreshes in the connector service, under the
  lock, which is where the rotation is stored.

## Unverified

- A real third-party authorization server (Notion/Linear) is #9.
- HTTPS certificate validation; the mock is loopback HTTP with the dev flag.
- Phone viewport for the control-panel screens, which do not exist until #16.

## Next

`/implement 8` is already running in parallel. Remaining tickets after this
one are reported by `scripts/complete-ticket.ts` at close.
