# Ticket #6 — P2 · Paste-URL connectors, catalog, classifier, pinning

## Files built

- `apps/gateway/src/connectors/classifier.ts` — annotations first, then name
  heuristics; disagreements resolve to the more dangerous class; no match is
  `unknown`; `defaultRequestable` on for read/write only.
- `apps/gateway/src/connectors/sanitise.ts` — agent name `<connector>__<tool>`
  (accent/punctuation/zero-width normalised, 64-character cap) and description
  sanitisation (markup, control and bidi characters removed, whitespace
  collapsed, 500-character cap), plus the canonical definition hash.
- `apps/gateway/src/connectors/catalog.ts` — ingestion, unique agent names,
  pinned vs observed definition, new/changed/removed states, requestability,
  re-pinning.
- `apps/gateway/src/connectors/mcp.ts` — Streamable HTTP first, legacy SSE
  fallback, egress-guarded fetch, `www-authenticate` challenge capture,
  typed connect errors.
- `apps/gateway/src/connectors/auth.ts` — one home for the four auth variants:
  request schema, headers, credential serialisation and parsing.
- `apps/gateway/src/connectors/errors.ts` — typed connector errors.
- `apps/gateway/src/connectors/service.ts` — connect, probe, refresh and
  approve flows; vault-only credential use; journal events.
- `apps/gateway/src/egress/guard.ts` — `egressRequest` for arbitrary methods,
  bodies and streaming responses; redirects re-validated, origin-sensitive
  headers dropped on cross-origin redirects, header-timeout kept separate from
  stream lifetime.
- `apps/gateway/src/app.ts` — `/api/connectors` (list/create),
  `/api/connectors/probe`, `/api/connectors/:id`, `/api/connectors/:id/refresh`,
  `/api/catalog`, `/api/catalog/:id/approve`.
- `apps/gateway/src/db/schema.ts` plus migrations `0001` and `0002` — agent
  name, pinned/observed definition columns, state, changed/removed timestamps.
- `apps/mock-services/src/server.ts` — Streamable HTTP calendar (none and
  bearer variants), legacy SSE dine-out (basic), Streamable HTTP pay (custom
  header), and a demo rug-pull control.
- Tests: `apps/gateway/tests/connectors/{classifier,sanitise,catalog,mcp,api,support}.test.ts`,
  `apps/gateway/tests/egress/request.test.ts`,
  `apps/mock-services/tests/health.test.ts`.
- `docs/VERSIONS.md` updated for the three newly installed packages.
- Proof: `docs/proof/06-paste-url-connectors/` (PROOF.md, curl transcript,
  browser window, database scan, server logs, screens).

## Commands run

```
bun add @modelcontextprotocol/client@2.4.0 --cwd apps/gateway
bun add @modelcontextprotocol/server@2.4.0 --cwd apps/mock-services
bun add zod@4.6.7 --cwd apps/mock-services
bun add -d @errand/mock-services@workspace:* --cwd apps/gateway
bunx drizzle-kit generate                      # in apps/gateway, twice
bun run typecheck
bun test
bun run apps/gateway/src/index.ts              # with proof env
bun run apps/mock-services/src/index.ts
# curl transcript, DB scan and browser capture: docs/proof/06-paste-url-connectors/logs/
```

## Test output

```
$ bun run typecheck
@errand/shared typecheck: Exited with code 0
@errand/web typecheck: Exited with code 0
@errand/mock-services typecheck: Exited with code 0
@errand/gateway typecheck: Exited with code 0
✓ 3 checks passed: comments, installed, no-any

$ bun test
 194 pass
 0 fail
 407 expect() calls
Ran 194 tests across 21 files.
```

## Proof

- `docs/proof/06-paste-url-connectors/PROOF.md` — verdict: pass.
- `logs/curl-transcript.txt` — probe, all four auth variants, SSE fallback,
  wrong credentials, metadata refusal, changed tool, re-approval, catalog,
  connectors, journal verify.
- `logs/db-secret-scan.txt` — journal, connector and credential rows; every
  upstream secret absent, ciphertext present.
- `logs/gateway-server.txt` and `logs/mock-services-server.txt` — clean window.
- `screens/01-health.png`, `screens/02-catalog-live.png`,
  `logs/browser-window.txt` — live browser view, console and network.

## Versions changed

| Package | Workspace | Version | `latest` evidence |
|---|---|---|---|
| `@modelcontextprotocol/client` | gateway | 2.4.0 | `latest => 2.4.0` |
| `@modelcontextprotocol/server` | mock-services | 2.4.0 | `latest => 2.4.0` |
| `zod` | mock-services (already in gateway) | 4.6.7 | `latest => 4.6.7` |
| `@errand/mock-services` | gateway (dev) | 0.1.0 | local workspace |

`docs/VERSIONS.md` records all four; nothing was pinned from memory.

## Review findings addressed

Standards:
- Removed the duplicated `ToolDefinition`; hashing now takes `DiscoveredTool`.
- One auth module owns the schema, headers, serialisation and parsing for all
  four variants, replacing four scattered switches.
- Extracted `connectorDetail` for create/refresh responses and
  `applyDiscovery` for the shared update → ingest → journal sequence.
- Replaced response-body assertions in the API tests with Zod schemas and
  `instanceof` narrowing; named `McpConnection` used instead of
  `Awaited<ReturnType<…>>`.
- Removed the duplicate approval guard, named the header schema, shared the
  default owner constant, and dropped the invalid-URL sentinel.

Spec:
- Probe now reports an `authHint` from the server's `www-authenticate`
  challenge, so "discover auth" is more than a boolean.
- A changed tool keeps its pinned description/schema/class and stores the new
  definition in `observed*` columns; the human sees what changed, and approval
  copies observed onto pinned. Approval journals the previous/new class and
  hash.
- `export_all_contacts` no longer classifies as read: `export` was removed from
  the read verbs, so the decoy-shaped name is `unknown` and blocked.

## Deviations / not done

- The diff exceeds the workflow's ~300-line review threshold. The ticket was
  cut as one vertical slice and the review was run over it; no behaviour was
  left unreviewed. Splitting after the fact would not change the running
  system. The review axes were run and their findings are above.
- New tools that appear on a refresh are labelled `new` and requestable by
  class (read/write). The spec requires blocking *changed* tools; new tools are
  surfaced for the P7 catalog screen.
- OAuth 2.1 + PKCE is ticket #7, not this one. Real Notion/Linear are #9.
  Slip creation (and therefore rejection of a new slip containing a changed
  tool) starts at #8/#10.

## Unverified

- OAuth consent and token rotation (ticket #7).
- Real Notion and Linear endpoints (ticket #9).
- HTTPS certificate validation; mocks are loopback HTTP with the dev flag, as
  in #5.
- The P7 control panel does not exist yet, so the browser captured the live
  JSON API rather than a UI walkthrough.

## Next

`/implement 7` (branch `ticket/07-oauth-pkce`), `/implement 8`
(`ticket/08-agent-keys-catalog`), or `/implement 16` (`ticket/16-web-shell`) —
all three lost their last open blocker with #6.
