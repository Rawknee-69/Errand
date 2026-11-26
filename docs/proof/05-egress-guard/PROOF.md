# Proof — P2 · Egress guard against pasted-URL abuse (#5)

Backend-only infrastructure ticket: it adds no HTTP route and no button, so the
proof is a command transcript with the negative cases plus the full suite, per
`docs/proof/README.md` ("Pure logic"). The guard is the seam the paste-URL
connector ticket (#6) will call before a connector is saved or fetched.

## What was driven

- Literal addresses refused on resolve, one row each: loopback (`127.0.0.1`,
  `::1`), private (`10/8`, `172.16/12`, `192.168/16`, `fc00::/7`), link-local
  (`169.254/16`, `fe80::/10`), CGNAT (`100.64/10`), unspecified (`0.0.0.0`,
  `::`), multicast (`224/4`, `ff00::/8`), reserved, and the IPv4-mapped forms
  (`::ffff:127.0.0.1`, `::ffff:169.254.169.254`).
- Cloud metadata refused with its own reason: `169.254.169.254`,
  `169.254.170.2`, `100.100.100.200`, `fd00:ec2::254`.
- Hostname resolution: public-only resolves pass; a hostname resolving to a
  private address is refused; a host resolving to **both** a public and a
  metadata address is refused (every resolved address is checked).
- Scheme: `http://` to a public host refused; `http://localhost`,
  `http://127.0.0.1` and `http://[::1]` allowed only with the dev flag;
  `http://127.0.0.2` still refused, and `http://example.com` refused even with
  the flag.
- Redirects against a real local server: three redirects followed to a 200;
  a fourth refused; a redirect to `169.254.169.254` and one to `192.168.1.10`
  refused after re-validation; a redirect to `file://` refused.
- Limits: a declared body over the cap and a stream that grows past it both
  refuse with `response-too-large`; a slow server refused after a 50 ms
  deadline; the same server answered normally under the default cap.
- Connector quota: two connectors for a user; a third refused at limit 2 and
  allowed at limit 3; a second user's connectors do not count.
- Full suite and typecheck: `logs/test-output.txt`, `logs/typecheck.txt`.

The driving script is ad hoc (run from the session temp directory) so it is not
committed; the same assertions live in the committed tests:
`tests/egress/address.test.ts`, `tests/egress/url.test.ts`,
`tests/egress/fetch.test.ts`, `tests/connectors/quota.test.ts`. Transcript:
`logs/egress-transcript.txt`.

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| 1 | low | A hostname is resolved, then the fetch connects by name, so a DNS record that changes between the two steps (rebinding) is not pinned. The ticket only requires rejection "on resolve". | logs/egress-transcript.txt, "hostname -> 10.1.2.3" | accepted |

## Not proven

- DNS rebinding between validation and connect (finding 1). Mitigating it needs
  a transport that connects to the validated IP with the original Host/SNI.
- The response cap covers the whole body, so a long-lived SSE response is
  capped at the configured bytes like any other body. No ticket yet exercises
  an SSE stream through this function.
- Nothing calls the guard in the running gateway yet: the paste-URL connector
  flow that consumes it is #6, so there is no API surface to drive.
- The connector quota is a checked function, not an enforced insert path; #6
  owns connector creation and must call it before inserting.

Verdict: pass
