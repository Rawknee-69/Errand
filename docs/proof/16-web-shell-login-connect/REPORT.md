# Ticket #16 — P7 · Web shell, login and Connect screen

## Files built

Gateway

- `apps/gateway/src/auth/session.ts` — HS256 JWT via `jose`, issuer/audience
  pinned, expiry from config; `readSession` returns `undefined` on any failure.
- `apps/gateway/src/auth/api.ts` — `/api/auth/login`, `/api/auth/session`,
  `/api/auth/logout`; httpOnly + Secure + SameSite=Lax cookie (Lax keeps the
  OAuth callback redirect from #7 inside the session); owner
  passphrase compared in constant time; demo user creation and `demo.login`
  journal event; middleware that requires a session for every other `/api/*`
  route and injects the session user id.
- `apps/gateway/src/auth/rate-limit.ts` — global sliding-window limiter for the
  one passphrase; `retryAfterSeconds` drives the 429 and `Retry-After`.
- `apps/gateway/src/auth/passphrase.ts`, `apps/gateway/src/auth/owner.ts` —
  constant-time compare and the one owner-id home.
- `apps/gateway/src/config.ts`, `apps/gateway/src/index.ts` — required
  `OWNER_PASSPHRASE` (≥12 chars), `DEMO_MODE`, `SESSION_COOKIE_SECURE`,
  `SESSION_TTL_HOURS`; all wired in `index.ts`.
- `apps/gateway/src/app.ts` — the session middleware plus a per-request user id
  for every connector, catalog and agent-key route; `DEFAULT_OWNER_ID` moved to
  `auth/owner.ts`. The agent-key create/list/revoke routes and `/mcp` are
  ticket #8's, reused here rather than duplicated.
- `packages/shared/src/index.ts` — single home for the wire types and Zod
  schemas: session, login, probe, connector, catalog, ingest summary, connector
  detail, agent key, error; connector auth input moved here from the gateway.
- `apps/gateway/src/connectors/{auth,catalog,service}.ts` and `db/schema.ts` —
  now import those shared shapes instead of restating them.

Web

- `apps/web/src/api.ts` — fetch client parsed by the shared schemas; typed
  `ApiError`.
- `apps/web/src/App.tsx`, `src/useScreen.ts`, `src/navigation.ts`,
  `src/screens/{Shell,Login,Connect,Placeholder}.tsx` — eight-screen shell in
  one navigation source, with a bottom tab bar on phones and a sidebar on
  desktop, session bootstrap, sign-in (owner or demo guest), and a three-step
  Connect flow: URL → auth → connected → key.
- `apps/web/src/components/AgentKeyPanel.tsx` — the key-once panel, client
  snippet table and copy controls, split out of Connect.
- `apps/web/src/components/CopyButton.tsx` — Clipboard API with an
  `execCommand` fallback and an honest Copied/Failed state.
- `apps/web/src/agentSnippets.ts` — Claude Code one-liner and Cursor
  `.cursor/mcp.json` JSON from the gateway origin and key.
- `apps/web/src/styles.css` — mobile-first dark UI; 44px minimum controls,
  safe-area bottom padding, phone tab bar and desktop sidebar.
- `apps/web/vite.config.ts` — dev/preview proxy for `/api`, `/health`, `/mcp`.
- `apps/web/index.html`, `src/main.tsx`, `tsconfig.json`, `package.json` —
  viewport-fit, theme colour, stylesheet, test include, shared dependency.

Tests and docs

- `apps/gateway/tests/auth/api.test.ts` — unauthorised API, cookie flags, wrong
  passphrase, rate limit and window reset, logout, tampered cookie, demo off,
  demo journal, per-guest scoping.
- `apps/web/tests/agentSnippets.test.ts` — both snippets and the MCP URL.
- `docs/VERSIONS.md`, `.env.example`, `apps/gateway/tests/config.test.ts`.
- `docs/proof/16-web-shell-login-connect/` — PROOF.md, screens, logs.

## Commands run

```
bun add jose@6.2.18 --cwd apps/gateway
bun add zod@4.6.7 --cwd apps/web
bun add zod@4.6.7 --cwd packages/shared
bun add @errand/shared@workspace:* --cwd apps/web
bun run typecheck
bun test
bun run --cwd apps/web build
bun run --cwd apps/mock-services dev
bun run --cwd apps/gateway dev          # proof env in an untracked .env
bun run apps/gateway/src/index.ts       # second instance, DEMO_MODE=false, port 8789
bun run --cwd apps/web dev              # http://localhost:5173
# HTTP transcripts, SQLite reads, phone/desktop captures and metrics:
# docs/proof/16-web-shell-login-connect/logs/
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
 250 pass
 0 fail
 675 expect() calls
Ran 250 tests across 33 files.

$ bun run --cwd apps/web build
✓ 121 modules transformed.
dist/index.html                   0.49 kB │ gzip:  0.30 kB
dist/assets/index-BmYY9Fd8.css    9.93 kB │ gzip:  2.94 kB
dist/assets/index-0blVK7Vk.js   326.58 kB │ gzip: 98.81 kB
✓ built in 1.64s
```

## Proof

- `docs/proof/16-web-shell-login-connect/PROOF.md` — verdict: pass, with three
  fixed findings (touch targets, clipboard fallback, phone tool-name wrap) and
  what was not proven.
- `docs/proof/16-web-shell-login-connect/logs/http-auth-transcript.txt` — 401
  without a session, cookie attributes, 200 session read, journal verify, and
  the demo-off 403 on the second gateway.
- `docs/proof/16-web-shell-login-connect/logs/rate-limit-transcript.txt` — five
  401s then 429 with `Retry-After: 60`.
- `docs/proof/16-web-shell-login-connect/logs/journal-and-keys.txt` — demo login
  event, key-issue events with no key material, and 64-hex hash-only storage.
- `docs/proof/16-web-shell-login-connect/logs/phone-metrics.json` — 390×844
  viewport and zero controls under 44×44.
- `docs/proof/16-web-shell-login-connect/logs/secret-scan.txt` — no plaintext
  `errand_` key anywhere in the artifacts or gateway directory.
- Screens: `01`–`11` desktop 1440×900, `12`–`16` phone 390×844, `17`–`18` demo
  picker and scoped demo session. Keys are redacted in the committed captures.

## Versions changed

| Package | Workspace | Version | `latest` evidence |
|---|---|---|---|
| `jose` | gateway | 6.2.18 | `latest => 6.2.18` |
| `zod` | web, shared | 4.6.7 | `latest => 4.6.7` |
| `@errand/shared` | web | 0.1.0 | local workspace |

`docs/VERSIONS.md` records all three; nothing was pinned from memory.

## Review findings addressed

Standards:

- `ToolClass`, `ToolState`, `ConnectorAuthType` were written twice in
  `packages/shared` as a literal union and a `z.enum`. The schema now owns the
  values and each type is `z.infer`.
- `DEFAULT_OWNER_ID` had three homes. It now lives only in
  `apps/gateway/src/auth/owner.ts`; `app.ts`, `api.ts` and `index.ts` import it.
- The sidebar and tab bar were pasted variants; both now render one `NavList`
  with a variant class.
- The shell's seven near-identical `Placeholder` branches collapsed into one
  lookup, and `screens`/`nav` collapsed into one entry list that drives paths,
  labels, titles and placeholder copy.
- The shared transport shape had loosened to `string`; `mcpTransportSchema`
  now owns it, the connectors row is typed with it, and `transportLabel` takes
  the enum.
- The two login branches shared the same issue → cookie → view tail; extracted
  `signIn` and `sessionCookieOptions`. `AuthDeps` no longer re-carries
  `ttlSeconds`/`secureCookie`.
- The login guard was opt-in when `auth` was omitted. `auth` is now required
  and either an `AuthOptions` object or the explicit `"disabled"` test value,
  so a production app cannot be built without choosing.
- `Connect` was 437 lines with a duplicated snippet block; the key panel moved
  to `AgentKeyPanel` and the two snippets became one table-driven render.

Spec:

- Only seven screens existed; Connectors was missing. It now has a route, nav
  entry and ticket placeholder, giving the eight control-panel screens.
- A demo cookie outlived demo mode. Sessions now reject a `demo` claim when the
  mode is off.
- Demo sign-ins bypassed the limiter. Every demo attempt counts, with a
  regression test for the 429.

## Deviations / not done

- The diff is larger than the workflow's ~300-line review threshold. The ticket
  is a vertical slice (gateway auth plus the shell plus the Connect flow) and was
  reviewed as one; no behaviour was left unreviewed.
- Ticket #8 merged into `integration` while this branch was open. The rebase
  replaced this branch's minimal key issuer with #8's create/list/revoke routes
  and `/mcp`, and the Connect screen consumes its
  `{ key, agentKey, mcpUrl }` response. No second key endpoint, no second MCP
  endpoint.
- Demo guests type a free-form name. The three seeded friends belong to the P9
  demo-fixtures ticket; the scoping and journal behaviour they rely on is here.
  Because names are free text, two guests can deliberately pick the same name;
  the seeded picker removes that by construction.
- OAuth is not a selectable auth on the Connect screen. The gateway has no OAuth
  variant yet; that is ticket #7. The probe still reports the `oauth` challenge
  as a header hint, and the screen offers none/bearer/header/basic.
- Sessions are stateless JWTs, so sign-out clears the cookie but cannot revoke a
  copied token before its TTL. Single-owner login does not yet need a denylist.

## Unverified

- Claude Code and Cursor snippets were not executed against a live `/mcp`
  endpoint (ticket #8).
- OAuth connectors (ticket #7) and real Notion/Linear (ticket #9).
- Physical phone use; one-handed usability was assessed by viewport and a
  touch-target audit.
- Rate-limit window reset in the browser; the unit test injects the clock.

## Next

Closing #16 makes the Catalog and Connectors screens runnable, alongside the two
tickets that were already unblocked:

```
/implement 9    (branch ticket/09-approval-signing)
/implement 17   (branch ticket/17-catalog-connectors)
/implement 21   (branch ticket/21-real-notion-linear)
```
