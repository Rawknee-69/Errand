# Ticket #5 — P2 · Egress guard against pasted-URL abuse

## Files built

- `apps/gateway/src/egress/address.ts` — `classifyAddress`: IPv4/IPv6 range
  classification (loopback, private, link-local, CGNAT, unspecified, multicast,
  reserved, cloud metadata, IPv4-mapped and NAT64 forms).
- `apps/gateway/src/egress/guard.ts` — `assertFetchableUrl` (scheme, literal
  address, and every DNS-resolved address), `egressFetch` (node:http(s) with
  the validated address pinned through `lookup`, redirects re-validated with a
  hard limit of three, timeout, response size cap), and `EgressRefusal` with a
  typed code.
- `apps/gateway/src/connectors/quota.ts` — `assertConnectorQuota` and
  `ConnectorLimitError`.
- `apps/gateway/src/config.ts` — `ALLOW_LOCALHOST_DEV`,
  `EGRESS_TIMEOUT_MS`, `EGRESS_MAX_RESPONSE_BYTES`, `MAX_CONNECTORS_PER_USER`,
  with defaults owned by the modules above.
- `.env.example` — the four settings documented.
- Tests: `tests/egress/address.test.ts`, `tests/egress/url.test.ts`,
  `tests/egress/fetch.test.ts`, `tests/connectors/quota.test.ts`, plus new
  config cases in `tests/config.test.ts`.

## Commands run

```
bun run typecheck
bun test
bun <temp>/drive-egress.ts        # hostile local server transcript
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
 113 pass
 0 fail
 178 expect() calls
Ran 113 tests across 12 files.
```

## Proof

- `docs/proof/05-egress-guard/PROOF.md` — verdict: pass.
- `docs/proof/05-egress-guard/logs/egress-transcript.txt` — refusals for every
  blocked range, metadata, scheme rules, redirect re-validation, fourth
  redirect, size cap, timeout, connector quota, with the allowed cases beside
  them.
- `docs/proof/05-egress-guard/logs/test-output.txt`.
- `docs/proof/05-egress-guard/logs/typecheck.txt`.

## Versions changed

None. No dependency was added; the guard uses `node:net`, `node:dns/promises`,
`node:http` and `node:https`.

## Unverified

- The https certificate path is not exercised by the local tests, which use
  plain http on loopback with the dev flag; pinning is driven for a resolved
  hostname. See `PROOF.md`.
- No gateway route calls the guard yet; #6 consumes it for paste-URL
  connectors.
- The new env settings are parsed and defaulted but have no reader until #6
  binds them to the guard and the quota call.
