# Ticket #43 — OAuth callback returns to the control panel

## Files built

- `apps/gateway/src/app.ts` — `GatewayAppOptions.webOrigin`; the OAuth callback
  answers `302 Location: ${WEB_ORIGIN}/connectors` for an HTML caller when a web
  origin is configured, and keeps `oauthCallbackPage` otherwise.
- `apps/gateway/src/config.ts` — exported `webOriginSchema`: an absolute
  http(s) origin with no credentials, path, query or fragment, normalized to
  `URL.origin`; `WEB_ORIGIN` is optional.
- `apps/gateway/src/index.ts` — passes `config.WEB_ORIGIN` into the app only
  when set.
- `packages/shared/src/index.ts` — `CONNECTORS_PATH`, the one home for
  `/connectors`, used by the gateway redirect and the web router.
- `apps/web/src/navigation.ts` — the Connectors route uses `CONNECTORS_PATH`.
- `.env.example` — documents `WEB_ORIGIN` beside `OAUTH_REDIRECT_URI`.
- `apps/gateway/tests/config.test.ts` — absent, trailing-slash normalization,
  and rejection of relative, non-http, path-bearing, credentialed and
  whitespace-padded values.
- `apps/gateway/tests/connectors/oauth.test.ts` — one `createTestApp` helper
  replaces three copies of the app setup; tests for the configured redirect,
  the unset HTML fallback (already escaped), the ignored query parameters, the
  unchanged JSON response, and the trailing-slash normalization.
- `docs/proof/43-oauth-callback-web-origin/` — `PROOF.md`, `drive.mjs`,
  `browser.mjs`, before/after transcripts, browser window, server logs,
  test/typecheck output, and nine screenshots.

## Commands run

```
bun install --frozen-lockfile
bun test apps/gateway/tests/connectors/oauth.test.ts apps/gateway/tests/config.test.ts
bun run typecheck
bun test
PORT=4002 bun run apps/mock-services/src/index.ts
PORT=8788 ... WEB_ORIGIN=http://127.0.0.1:5173 bun run apps/gateway/src/index.ts
PORT=8789 ... bun run apps/gateway/src/index.ts
GATEWAY_URL=http://127.0.0.1:8788 bun run --cwd apps/web dev -- --host 127.0.0.1
bun run docs/proof/43-oauth-callback-web-origin/drive.mjs http://127.0.0.1:8788 http://127.0.0.1:4002 after
bun run docs/proof/43-oauth-callback-web-origin/drive.mjs http://127.0.0.1:8789 http://127.0.0.1:4002 before
bun run browser.mjs   # Edge via playwright-core, from a temp dir
```

## Test output

```
$ bun run typecheck
@errand/shared typecheck: Exited with code 0
@errand/mock-services typecheck: Exited with code 0
@errand/web typecheck: Exited with code 0
@errand/gateway typecheck: Exited with code 0
✓ 4 checks passed: comments, installed, no-any, oauth-verifier

$ bun test
apps\gateway\tests\connectors\oauth.test.ts:
[mcp-sdk] OAuth "invalid_grant" — invalidating the stored tokens and retrying authorization. Cause: "refresh token is invalid, rotated or revoked"
[mcp-sdk] OAuth "invalid_grant" — invalidating the stored tokens and retrying authorization. Cause: "refresh token is invalid, rotated or revoked"

 334 pass
 0 fail
 990 expect() calls
Ran 334 tests across 41 files. [2.18s]
```

Full output: `docs/proof/43-oauth-callback-web-origin/logs/typecheck.txt` and
`logs/test-output.txt`.

## Proof

- `docs/proof/43-oauth-callback-web-origin/PROOF.md` — verdict: pass.
- `screens/05-connectors-after-redirect-desktop.png` — the browser lands on the
  Connectors screen with the new `Mock calendar (browser)` card `ACTIVE`.
- `screens/09-before-deadend-desktop.png` — the same callback with no
  `WEB_ORIGIN` still shows the bare “Connected” page.
- `logs/after-transcript.txt` — exact `302
  http://127.0.0.1:5173/connectors`, replay and unknown-state `400`, mid-flow
  consent refresh, unchanged JSON, and the ignored `webOrigin`/`next` query
  parameters.
- `logs/before-transcript.txt` — `200 text/html` dead end and the unchanged
  failure response.
- `logs/browser-window.txt` — console and network for the driven window,
  including `302 GET :8788/api/oauth/callback` → `200 GET :5173/connectors`.

## Versions changed

None. No dependency was added or bumped.

## Review findings addressed

Standards:

- Extracted `CONNECTORS_PATH` into `packages/shared`; the gateway redirect and
  the web router now share one route instead of two literals.
- Replaced the third copy of the test app setup with `createTestApp`, used by
  `beforeEach`, the web-origin tests and the different-redirect test.
- Replaced bare `z.string().url()` with `webOriginSchema`: absolute http(s)
  origin only, no credentials, path, query, fragment or surrounding whitespace,
  normalized to `URL.origin`. The schema is the type-level fix ADR 0002 asks
  for, and `test.each` records each rejected shape.
- Moved the trailing-slash normalization out of the route and into that schema,
  and had the route parse through it.
- Expanded the proof beyond the happy path: consumed-state replay, unknown
  state, mid-flow consent refresh, first and non-HTML callers, and an attempted
  open redirect; regenerated every log in UTF-8 and cited it.
- The gateway has no per-request logging; `PROOF.md` says so and points the
  request window at the browser network log and the driver transcripts.

Spec:

- The configured redirect, unset fallback with escaping, query-parameter
  immunity, JSON path, boot with and without the variable, and the open-redirect
  test are all covered.
- The trailing-slash normalization is kept as a defensive input normalization;
  it never changes the target for a well-formed origin.

## Deviations / not done

- Chrome is not installed and `playwright install chrome` needs Administrator,
  so the browser pass used Microsoft Edge with `playwright-core` from a temp
  directory. The repo gains no dependency.
- The mock consent page offers only **Approve**, so the deny path was not
  driven; the gateway's OAuth failure response is explicitly out of scope.
- The Connect screen still has no OAuth entry point; the flow was started via
  `POST /api/connectors/oauth/start` from the control-panel origin, as #21
  does. A UI entry point is not part of this ticket.

## Unverified

- A real third-party authorization server (Notion/Linear).
- HTTPS and the production proxy; `WEB_ORIGIN` behind Caddy is P10.
- Chrome itself.
