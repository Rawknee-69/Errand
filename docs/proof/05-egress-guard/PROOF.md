# Proof — P2 · Egress guard against pasted-URL abuse (#5)

Backend-only infrastructure ticket: it adds no HTTP route and no button, so the
proof is a command transcript with the negative cases plus the full suite, per
`docs/proof/README.md` ("Pure logic"). The guard is the seam the paste-URL
connector ticket (#6) will call before a connector is saved or fetched.

## What was driven

- Literal addresses refused on resolve, one row each: loopback (`127.0.0.1`,
  `::1`), private (`10/8`, `172.16/12`, `192.168/16`, `fc00::/7`, `fec0::/10`),
  link-local (`169.254/16`, `fe80::/10`), CGNAT (`100.64/10`), unspecified
  (`0.0.0.0`, `::`), multicast (`224/4`, `ff00::/8`), reserved, the
  IPv4-mapped forms (`::ffff:127.0.0.1`, `::ffff:169.254.169.254`), the
  deprecated IPv4-compatible forms (`::127.0.0.1`, `::10.0.0.1`) and NAT64
  (`64:ff9b::a00:1`).
- Cloud metadata refused with its own reason: `169.254.169.254`,
  `169.254.170.2`, `100.100.100.200`, `fd00:ec2::254`.
- Hostname resolution: public-only resolves pass; a hostname resolving to a
  private address is refused; a host resolving to **both** a public and a
  metadata address is refused (every resolved address is checked).
- Scheme: `http://` to a public host refused; `http://localhost`,
  `http://127.0.0.1` and `http://[::1]` allowed only with the dev flag;
  `http://127.0.0.2` still refused, and `http://example.com` refused even with
  the flag.
- Connection pinning: the request handler is `node:http(s)` with a `lookup`
  that returns the address already validated, so a second DNS answer cannot
  swap in a private address between validation and connect. Driven for
  `localhost` resolved to `127.0.0.1` (`logs/egress-transcript.txt`); a
  hostname resolving only to `10.1.2.3` is refused before any connection.
- Redirects against a real local server: three redirects followed to a 200;
  a fourth refused; a redirect to `169.254.169.254` and one to `192.168.1.10`
  refused after re-validation; a redirect to `file://` refused. The redirect
  body is destroyed before the next hop.
- Limits: a declared body over the cap and a stream that grows past it both
  refuse with `response-too-large`; a slow server refused after a 50 ms
  deadline; the same server answered normally under the default cap; DNS
  resolution is bounded by the same timeout.
- Connector quota: two connectors for a user; a third refused at limit 2 and
  allowed at limit 3; a second user's connectors do not count.
- Full suite and typecheck: `logs/test-output.txt`, `logs/typecheck.txt`.

The driving script is ad hoc (run from the session temp directory) so it is not
committed; the same assertions live in the committed tests:
`tests/egress/address.test.ts`, `tests/egress/url.test.ts`,
`tests/egress/fetch.test.ts`, `tests/connectors/quota.test.ts`. Transcript:
`logs/egress-transcript.txt`.

## Findings

No open findings.

## Not proven

- The https transport with certificate verification is not exercised by the
  local tests: they use plain http on loopback with the dev flag. `node:https`
  is the same code path with default verification on.
- The response cap covers the whole body, so a long-lived SSE response is
  capped at the configured bytes like any other body. No ticket yet exercises
  an SSE stream through this function.
- Nothing calls the guard in the running gateway yet: the paste-URL connector
  flow that consumes it is #6, so there is no API surface to drive.
- The connector quota is a checked function, not an enforced insert path; #6
  owns connector creation and must call it before inserting.
- The env settings added in `config.ts` (`ALLOW_LOCALHOST_DEV`,
  `EGRESS_TIMEOUT_MS`, `EGRESS_MAX_RESPONSE_BYTES`,
  `MAX_CONNECTORS_PER_USER`) have no reader until #6 binds them to
  `EgressOptions` and the quota call. Parsing and defaults are tested; they
  are not yet in a request path.

Verdict: pass
