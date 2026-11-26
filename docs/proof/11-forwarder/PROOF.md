# Ticket #11 — P5 · Forwarder, class handling and result cap

## Environment

- Windows 11, Bun 1.4.4, TypeScript 7.0.2.
- Gateway on `http://127.0.0.1:8841`, mock services on `http://127.0.0.1:4121`.
- Scratch database `docs/proof/11-forwarder/proof.db` (ignored by git), with
  `ALLOW_LOCALHOST_DEV=true`, `SESSION_COOKIE_SECURE=false`, `CALL_TIMEOUT_MS=500`
  and `CONNECTOR_CONCURRENCY=2`.
- Temporary 32-byte vault, HMAC and JWT keys were set for the run and are not
  recorded anywhere.
- Real client: `@modelcontextprotocol/client` 2.4.0
  `StreamableHTTPClientTransport` against `/mcp`, bearer agent key.
- Upstreams are real MCP servers from `apps/mock-services`: Calendar behind a
  bearer credential, Big behind a bearer credential, Pay behind a custom header.
- No UI on this ticket, so there is no browser walkthrough; the evidence is the
  agent-facing MCP surface, the calls table and the journal.

## Steps driven

| # | Step | Evidence |
|---|---|---|
| 1 | Logged in as the owner and created an agent key; the response carried one MCP URL. Only the key id and URL were logged. | `logs/forward-transcript.txt` |
| 2 | Connected Calendar (`/calendar-secure/mcp`, bearer), Big (`/big/mcp`, bearer) and Pay (`/pay/mcp`, custom header) through the paste-URL API. All three accepted their stored credentials. | `logs/forward-transcript.txt`, `logs/mock-services.txt` |
| 3 | A real MCP client listed exactly four tools: `errand_call`, `errand_catalog`, `errand_status`, `request_errand`. | `logs/forward-transcript.txt` |
| 4 | Requested and approved a read slip, then called `calendar__list_events`: `state: forwarded`, `class: read`, the event payload returned, `callsUsed` 1 and 49 calls remaining. | `logs/forward-transcript.txt` |
| 5 | A write slip called `calendar__create_event`: `state: forwarded`, `class: write`, `evt-new` returned. | `logs/forward-transcript.txt` |
| 6 | A delete slip called `calendar__delete_event`: `state: forwarded`, `class: delete`. The same call on a read slip returned `out_of_scope` and consumed no cap. | `logs/forward-transcript.txt` |
| 7 | `big__large_result` returned 300 KB: `truncated: true`, `originalBytes` 307255, returned result 261993 bytes, and the stored calls row is also at or under 262144 bytes. | `logs/forward-transcript.txt` |
| 8 | `big__echo_token` echoed the bearer credential it received: the agent saw `{"token":"[redacted]"}`, and the raw token appears nowhere in the result, calls table or journal. | `logs/forward-transcript.txt`, `logs/secret-scan.txt` |
| 9 | A 1000 ms upstream call with a 500 ms per-call limit returned `upstream_timeout`; `callsUsed` stayed at 1 for the attempt, the journal held `call.failed` with reason `upstream_timeout`, and the calls row has `result: null` plus the timeout error. | `logs/forward-transcript.txt` |
| 10 | Six concurrent `big__slow_result` calls with a per-connector limit of two ran in three waves; the mock measured `maxActive: 2`. | `logs/forward-transcript.txt` |
| 11 | The journal and calls table were scanned for all three upstream credentials: 0 matches in 46 journal rows and 12 calls rows. | `logs/secret-scan.txt`, `db-scan.ts` |
| 12 | `/api/journal/verify` returned `{ok:true, checked:46}` after the forwarded and failed entries. | `logs/forward-transcript.txt` |
| 13 | Full suite and typecheck. | `logs/test-output.txt`, `logs/typecheck.txt` |

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| — | — | No open findings. | — | — |

## Not proven here

- OAuth credential forwarding is covered in process by
  `apps/gateway/tests/connectors/oauth.test.ts` (a live OAuth consent flow, then
  a forwarded read through the stored token), but the live transcript in this
  directory uses bearer and header credentials only.
- Send and spend deferral is covered in process (`forward.test.ts`) but not in
  the live transcript; the outbox and spend tap are ticket #12.
- An upstream response above the 10 MB egress ceiling is refused rather than
  truncated; the truncation rule was proven at 300 KB, inside that ceiling.
- The concurrency limit is per gateway process; no multi-process race was
  driven.

Verdict: pass
