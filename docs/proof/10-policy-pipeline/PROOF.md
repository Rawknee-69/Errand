# Ticket #10 — P4 · Policy pipeline steps 1–11

## Environment

- Windows 11, Bun 1.4.4, TypeScript 7.0.2.
- Gateway on `http://127.0.0.1:8840`, mock services on `http://127.0.0.1:4120`.
- Scratch database `docs/proof/10-policy-pipeline/proof.db` (ignored by git),
  `ALLOW_LOCALHOST_DEV=true` so the paste-URL flow reaches the loopback mocks,
  `SESSION_COOKIE_SECURE=false` because the proof is plain HTTP.
- Real client: `@modelcontextprotocol/client` 2.4.0
  `StreamableHTTPClientTransport` against `/mcp`, bearer agent key.
- No UI on this ticket, so there is no browser walkthrough; the evidence is the
  agent-facing MCP surface and the journal, per `docs/proof/README.md`.

## Steps driven

| # | Step | Evidence |
|---|---|---|
| 1 | Logged in as the owner and created an agent key; the response carried one MCP URL. Only the key id and URL were logged. | `logs/policy-transcript.txt` |
| 2 | Connected the mock Calendar and Pay servers through the paste-URL API; the catalog was discovered and pinned from the real MCP servers. | `logs/policy-transcript.txt`, `logs/mock-services.txt` |
| 3 | A real MCP client listed exactly four tools: `errand_call`, `errand_catalog`, `errand_status`, `request_errand`. | `logs/policy-transcript.txt` |
| 4 | Requested and approved a read slip, read its capability from `errand_status`, then called `calendar__list_events`: `not_forwarded`, `callsUsed` went 0 → 1, `callsRemaining` 49, spend untouched. | `logs/policy-transcript.txt` |
| 5 | Called `calendar__delete_event`, which is not in the slip: `isError: true`, `out_of_scope`, and a `call.scope_violation` journal row. No cap was consumed. | `logs/policy-transcript.txt` |
| 6 | Called with a forged capability: `capability_invalid`. | `logs/policy-transcript.txt` |
| 7 | Approved a slip with a call cap of 1: the first call was admitted, the second returned `call_cap_reached`. | `logs/policy-transcript.txt` |
| 8 | Approved a spend slip with a 100-cent cap: a 60-cent charge was admitted (`spendRemainingCents` 40), a second 60-cent charge returned `spend_cap_exceeded`. | `logs/policy-transcript.txt` |
| 9 | Approved a slip whose rate cap was 2 calls/minute: two calls were admitted, the third returned `rate_limited`. | `logs/policy-transcript.txt` |
| 10 | Requested a slip for a send-class tool with no allowlist: `missing_allowlist`, even though the tool name and class are known. | `logs/policy-transcript.txt` |
| 11 | Tampered with an approved slip's goal after signing: `signature_invalid`. | `logs/policy-transcript.txt` |
| 12 | Marked the tool `changed`, then the connector `needs_reauth`: `tool_unavailable`, then `connector_unhealthy`. | `logs/policy-transcript.txt` |
| 13 | Journal held 5 `call.allowed`, 1 `call.scope_violation` and 8 `call.denied` rows, each with its reason; `/api/journal/verify` returned `{ok:true, checked:33}`. | `logs/policy-transcript.txt`, `logs/gateway-server.txt` |
| 14 | The `calls` table stayed empty: no test or proof claims an upstream call happened. | `logs/policy-transcript.txt` |
| 15 | Full suite and typecheck. | `logs/test-output.txt`, `logs/typecheck.txt` |

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| — | — | No open findings. | — | — |

## Not proven here

- Ownership crossing, pending/denied/expired states, decoy refusal, unknown and
  mismatched classes, argument-schema refusal and allowlist value denial are
  covered by `apps/gateway/tests/agent/call.test.ts` at the same MCP seam, but
  were not each repeated against the live gateway in this transcript.
- Concurrency is proven by a test that spawns two Bun processes racing ten
  reservations against one file-backed slip with a cap of three; exactly three
  were admitted and `callsUsed` ended at three. The live transcript exercises
  the sequential cap path.
- The allowlisted-send pass path and the non-default rate cap need a seeded slip
  because `request_errand` does not yet accept constraints or a rate; both are
  covered by the in-process tests, not by the live transcript.
- The forwarder does not exist yet (ticket #11), so "permitted" ends at
  `not_forwarded`; nothing reaches the mock services and the empty `calls` table
  is the evidence.
- Burn-on-decoy and burn-on-second-scope-violation are ticket #12; this ticket
  only denies and journals the violation.

Verdict: pass
