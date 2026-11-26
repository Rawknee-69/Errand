# Ticket #5 — P2 · Egress guard against pasted-URL abuse

## Files built

- `apps/gateway/src/egress/address.ts` — `classifyAddress`: IPv4/IPv6 range
  classification (loopback, private, link-local, CGNAT, unspecified, multicast,
  reserved, cloud metadata, IPv4-mapped and NAT64 forms).
- `apps/gateway/src/egress/guard.ts` — `assertFetchableUrl` (scheme, literal
  address, and every DNS-resolved address), `egressFetch` (redirects
  re-validated with a hard limit of three, timeout, response size cap), and
  `EgressRefusal` with a typed code.
- `apps/gateway/src/connectors/quota.ts` — `countConnectors`,
  `assertConnectorQuota`, `ConnectorLimitError`.
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
 107 pass
 0 fail
 172 expect() calls
Ran 107 tests across 12 files.
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

None. No dependency was added; the guard uses `node:net`, `node:dns/promises`
and the platform `fetch`.

## Unverified

- DNS rebinding between resolve and connect is not pinned (recorded in
  `PROOF.md`, finding 1).
- No gateway route calls the guard yet; #6 consumes it for paste-URL
  connectors.
