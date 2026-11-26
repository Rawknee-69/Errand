# Ticket #8 — P3 · Agent keys, the agent-facing endpoint, catalog and request_errand

## Files built

- `apps/gateway/src/vault/agent-keys.ts` — key issue, constant-time verify, and
  `revokeAgentKey` (scoped by user, idempotent, reports whether it changed).
- `apps/gateway/src/agent/mcp.ts` — the agent-facing MCP endpoint handler and
  exactly four tools: `errand_catalog`, `request_errand`, `errand_status`,
  `errand_call`.
- `apps/gateway/src/agent/catalog.ts` — requestable-only view, Errand labels,
  re-sanitised descriptions, decoys excluded.
- `apps/gateway/src/agent/limits.ts` — server maxima and the clamp report.
- `apps/gateway/src/agent/request.ts` — validation, `errand_type` derivation,
  pending-slip persistence, journal entry, immediate return.
- `apps/gateway/src/agent/status.ts` — slip status with caps, usage, expiry.
- `apps/gateway/src/agent/slip-tools.ts` — the stored slip-tool schema and type.
- `apps/gateway/src/agent/call.ts` — refuses out-of-slip tools, otherwise stops
  at `not_forwarded`; never reaches an upstream until the policy/forwarder
  tickets land.
- `apps/gateway/src/policy/decoys.ts` — the three bait names, bare or prefixed.
- `apps/gateway/src/policy/errand-type.ts` — sorted tool list + constraint shape.
- `apps/gateway/src/db/schema.ts` — `SlipState` type for the slip lifecycle.
- `apps/gateway/src/app.ts` — `/api/agent-keys` (list/create/revoke) and `/mcp`
  bearer-key authentication; per-request `AuthInfo` carries the key's user.
- Tests: `apps/gateway/tests/agent/{mcp,keys-api,catalog,request,limits,status}.test.ts`,
  `apps/gateway/tests/policy/{decoys,errand-type}.test.ts`, the shared
  `tests/support/fixtures.ts` and `tests/agent/mcp-client.ts`, and the existing
  agent-key tests extended with revocation and cross-user refusal.
- Proof drivers: `apps/gateway/tests/agent/proof-drive.ts` (real MCP client) and
  `proof-db-scan.ts` (plaintext-key scan).
- `docs/VERSIONS.md` updated: `@modelcontextprotocol/server` now also in gateway.

## Commands run

```
bun add @modelcontextprotocol/server@2.4.0 --cwd apps/gateway
bun run typecheck
bun test
# live proof window:
bun run apps/gateway/src/index.ts                  # PORT=8838, proof.db, ALLOW_LOCALHOST_DEV=true
bun run apps/mock-services/src/index.ts            # PORT=4118
bun apps/gateway/tests/agent/proof-drive.ts http://127.0.0.1:8838 <proof.db> http://127.0.0.1:4118
bun apps/gateway/tests/agent/proof-db-scan.ts <proof.db>
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
 224 pass
 0 fail
 492 expect() calls
Ran 224 tests across 29 files.
```

## Proof

- `docs/proof/08-agent-keys-catalog/PROOF.md` — verdict: pass.
- `docs/proof/08-agent-keys-catalog/logs/mcp-transcript.txt` — real MCP client
  listing four tools, catalog with decoy removed, clamped `request_errand`,
  pending status, `not_forwarded` call, second user's isolated catalog, revoked
  key refused. The key itself appears only as a length and SHA-256 prefix.
- `docs/proof/08-agent-keys-catalog/logs/db-key-scan.txt` — every text column
  scanned; 64-hex key hashes present, plaintext key pattern found 0 times.
- `docs/proof/08-agent-keys-catalog/logs/{gateway-server,mock-services-server}.txt`
  — clean server window for the same run.
- `docs/proof/08-agent-keys-catalog/logs/{test-output,typecheck}.txt` — the
  pasted output above, captured from the same commit.

## Versions changed

| Package | Workspace | Version | `latest` evidence |
|---|---|---|---|
| `@modelcontextprotocol/server` | gateway (new), mock-services (existing) | 2.4.0 | `latest => 2.4.0` |

`docs/VERSIONS.md` records it; nothing was pinned from memory.

## Review findings addressed

Standards:
- Extracted the shared test fixtures (`TS`, `KEK`, `userDb`) to
  `apps/gateway/tests/support/fixtures.ts`; vault and agent support import them
  instead of each carrying a copy.
- One home for the slip-tool shape: `src/agent/slip-tools.ts` owns the schema
  and `SlipTool` type; request and status import it instead of restating it.
- `revokeAgentKey` now uses the scoped `getAgentKey` read rather than a third
  hand-written user-id query.
- `errand_call` no longer advertises `arguments` it never used; it now refuses
  a tool outside the slip as `out_of_scope`, and its description no longer
  claims a check it does not perform. The function is named
  `acknowledgeCall`, which is what it does.
- The MCP test and the live proof driver share `tests/agent/mcp-client.ts`
  instead of duplicating connect/call/parse logic.
- Catalogue and request path share one `isRequestableTool` predicate.

Spec:
- The key-creation response now carries the one URL to paste (`mcpUrl`), so the
  "one URL and one key" surface exists for the P7 screen to render.
- Status reports `expired` for an approved slip past `expires_at` as well as a
  pending one, with a test for both.
- `errand_call` is present only because the ticket requires exactly four tools;
  it is the honest interim surface for #10/#11. `errand_status` is the same:
  present, with no capability and no persisted transitions, which is #9's work.

Accepted without change:
- `labelFor` derives a display label from the connector and tool names; it is a
  presentation concern, not a second implementation of the agent-name grammar.
- `AGENT_LIMITS` follows the ticket's word "limits"; the glossary's "caps" is
  used for the caps on a slip.
- Proof drivers live under `tests/` so they are typechecked with the code they
  drive.
- `app.ts` stays the single composition root for the JSON API and MCP mount, as
  it already was for connectors and journal.

## Deviations / assumptions

- The diff is larger than the workflow's ~300-line threshold. The ticket is one
  vertical slice (keys → endpoint → catalog → request) and splitting it after
  the fact would not change the running system; the review axes were run over
  the whole branch. Code and tests are the bulk; proof logs are generated.
- No ticket names the fourth tool. It is `errand_call`, matching the `errand_`
  prefix of `errand_catalog`/`errand_status` and user story 19 ("one call at a
  time through a single tool"). Tickets #10/#11 should use this name or rename
  it with the same four-tool count.
- `errand_call` returns `not_forwarded` / `awaiting_approval`; it is present so
  the endpoint exposes exactly four tools, and deliberately cannot reach an
  upstream before approval.
- Status computes `expired` from `expires_at` but does not persist the
  transition; approval, capability and persisted transitions are ticket #9.

## Unverified

- Approval, capability issuance and the post-`pending` status transitions
  (ticket #9).
- Policy pipeline enforcement and real forwarding (tickets #10/#11).
- Real Notion/Linear endpoints (ticket #21); the isolation proof seeds a second
  user's rows rather than connecting a second live upstream.
- The control-panel screens that will consume `/api/agent-keys` (P7).

## Next

(Printed by `complete-ticket` when this closes.)
