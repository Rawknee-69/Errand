# Ticket #11 — P5 · Forwarder, class handling and result cap

## Files built

- `apps/gateway/src/connectors/call.ts` — invokes one upstream tool through the
  shared MCP transport, inside the vault's credential callback; enforces a
  single deadline across connect and call, redacts credential values, and bounds
  the result at 256 KB with `truncated` / `originalBytes`.
- `apps/gateway/src/connectors/concurrency.ts` — one FIFO semaphore per
  connector; `run()` holds a slot across connect, call and close.
- `apps/gateway/src/connectors/mcp.ts` — extraction of `createMcpTransport`, so
  discovery and forwarding share the egress guard, auth headers and redirect
  policy.
- `apps/gateway/src/connectors/redaction.ts` — the value-tree redactor for
  upstream results and error messages; `auth.ts` keeps only auth knowledge.
- `apps/gateway/src/connectors/auth.ts` — `authSecrets` includes the basic
  password and its base64 `user:password` header form.
- `apps/gateway/src/connectors/service.ts` — `createConnectorServiceDeps`, one
  home for the vault/store/discovery bundle used by the HTTP service, OAuth and
  the forwarder.
- `apps/gateway/src/connectors/records.ts` — extracted
  `markConnectorNeedsReauth` and added `markConnectorSuccess` for connector
  health on the success path.
- `apps/gateway/src/connectors/oauth/service.ts` — split
  `refreshOAuthAccessToken` out of `refreshOAuthConnection` so a call can obtain
  the refreshed token without running discovery.
- `apps/gateway/src/agent/forward.ts` — class handling (read/write/delete
  forward; send/spend defer to #12; unknown fails), the per-connector limiter,
  success/failure calls rows, `call.succeeded` / `call.failed` journal entries,
  and needs-reauth handling on auth failures.
- `apps/gateway/src/agent/mcp.ts` — `errand_call` now forwards, returns the
  upstream result with counters, and includes remaining counters on failures.
- `apps/gateway/src/policy/pipeline.ts`, `src/agent/call.ts` — an admitted
  decision carries the connector id, upstream tool name and connector id in the
  journal.
- `apps/gateway/src/app.ts`, `src/index.ts`, `src/config.ts`, `.env.example` —
  forwarder wiring plus `CALL_TIMEOUT_MS` and `CONNECTOR_CONCURRENCY`.
- `apps/mock-services/src/server.ts` — a secured `Big` MCP server with
  `large_result`, `slow_result`, `echo_token`, and stats/reset endpoints used to
  prove truncation, timeouts, concurrency and echo redaction.
- Tests: `apps/gateway/tests/agent/forward.test.ts`,
  `apps/gateway/tests/agent/forward-support.ts`, and an OAuth forwarding test in
  `apps/gateway/tests/connectors/oauth.test.ts`.
- Proof driver and scan: `apps/gateway/tests/agent/forward-proof-drive.ts`,
  `docs/proof/11-forwarder/db-scan.ts`.
- Proof: `docs/proof/11-forwarder/` (`PROOF.md`, transcript, server logs,
  secret scan, typecheck and full-suite output).

## Commands run

```
bun run typecheck
bun test
bun run apps/mock-services/src/index.ts                 # PORT=4121
bun run apps/gateway/src/index.ts                       # PORT=8841, proof env
bun apps/gateway/tests/agent/forward-proof-drive.ts \
  http://127.0.0.1:8841 docs/proof/11-forwarder/proof.db http://127.0.0.1:4121
bun docs/proof/11-forwarder/db-scan.ts docs/proof/11-forwarder/proof.db
```

The proof gateway ran with `CALL_TIMEOUT_MS=500`, `CONNECTOR_CONCURRENCY=2`,
`ALLOW_LOCALHOST_DEV=true` and `SESSION_COOKIE_SECURE=false`.

## Test output

```
$ bun run typecheck
@errand/shared typecheck: Exited with code 0
@errand/mock-services typecheck: Exited with code 0
@errand/web typecheck: Exited with code 0
@errand/gateway typecheck: Exited with code 0
✓ 4 checks passed: comments, installed, no-any, oauth-verifier

$ bun test
 330 pass
 0 fail
 1030 expect() calls
Ran 330 tests across 42 files.
```

## Proof

- `docs/proof/11-forwarder/PROOF.md` — verdict: pass.
- `logs/forward-transcript.txt` — live mock services through a real MCP client:
  read, write and in-slip delete forwarded; off-slip delete denied; 300 KB
  result truncated (307255 → 261993 bytes); credential echo redacted; 500 ms
  timeout with `call.failed` and an error calls row; six parallel calls with
  `maxActive: 2`; `{ok:true, checked:46}`.
- `logs/secret-scan.txt` — 0 credential matches across proof logs, 46 journal
  rows and 12 calls rows.
- `logs/gateway-server.txt`, `logs/mock-services.txt` — clean window.
- OAuth forwarding is proven in process by the new OAuth test (consent flow,
  refresh, then `state: forwarded`); the live transcript uses bearer and header
  credentials.

## Versions changed

None. No dependency was added, upgraded, downgraded or removed.

## Review findings addressed

Standards:
- Extracted `createMcpTransport` so discovery and forwarding no longer copy the
  transport/egress block.
- Extracted `createConnectorServiceDeps` so `app.ts` and the forwarder share one
  vault/store/discovery bundle.
- Extracted shared proof/test schemas and the `call` helper into
  `tests/agent/forward-support.ts`; removed the duplicated helpers.
- Removed the `as { … }` assertions from the proof driver; bodies are narrowed
  with zod. The db-scan uses a type guard instead of casts.
- Moved generic value redaction to `connectors/redaction.ts`.
- Replaced the `send`/`spend` if-chain with an explicit `switch` over
  `ToolClass`, so `unknown` is a compile-visible case.
- Removed the `call.deferred` event; an admitted send/spend still returns
  `not_forwarded` and consumes the admission exactly as before.
- Collapsed the duplicated calls-row insert into `insertCall`.

Spec:
- Fixed basic-auth redaction to include the base64 header form.
- The result cap is measured on the whole returned result, including the
  `truncated` / `originalBytes` flags, not just its payload.
- The per-call deadline now starts before the concurrency queue, so waiting for
  a slot is inside the bound.
- OAuth reauth/failed refresh errors map to `upstream_auth`, not
  `upstream_error`.
- Failure responses now include the remaining counters.
- Added an in-process OAuth forwarding test.
- Kept `markConnectorSuccess` as the success-side connector counter; removed the
  speculative deferred journal event.

Open judgement calls:
- `authSecrets` is a third switch on `auth.type`; a single behaviour table would
  be a wider auth refactor, not needed for this ticket.
- The send/spend test builds an admitted decision directly to exercise the
  forwarder's class boundary rather than re-driving the whole slip pipeline.
- Each admitted call opens its own MCP session; connection reuse is a later
  performance change.
- Responses above the 10 MB egress ceiling are refused rather than truncated.

## Unverified

- No multi-process concurrency race was driven; the limiter is per gateway
  process.
- OAuth calls refresh the token on every call; the correctness is covered, the
  extra refresh traffic is not measured.
- The 300 KB truncation is live-proven; the exact 256 KB boundary is enforced in
  code and covered by the result-size assertion, but no test lands on the last
  byte.

## Next

Tickets unblocked when #11 closes: **#12** (P5 · Outbox and the spend tap),
**#13** (P5 · Decoys, burns and scope-violation escalation) and **#14** (P6 ·
Verifier, undo and receipts).

Next: `/implement 12` (branch `ticket/12-outbox-spend`) or `/implement 13`
(branch `ticket/13-decoys-burns`) or `/implement 14`
(branch `ticket/14-verifier-receipts`)
