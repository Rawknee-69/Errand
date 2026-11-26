# Ticket #8 — P3 · Agent keys, the agent-facing endpoint, catalog and request_errand

## Environment

- Windows 11, Bun 1.4.4, TypeScript 7.0.2.
- Gateway on `http://127.0.0.1:8838`, mock services on `http://127.0.0.1:4118`.
- Scratch database `proof.db` (ignored by git), `ALLOW_LOCALHOST_DEV=true` so the
  paste-URL flow can reach the loopback mock.
- Real client: `@modelcontextprotocol/client` 2.4.0 `StreamableHTTPClientTransport`
  against `/mcp`, bearer agent key in the `Authorization` header.

## Steps driven

| # | Step | Evidence |
|---|---|---|
| 1 | Created an agent key over HTTP; the response is the only place the key appears and it also carries the one URL to paste (`…/mcp`). Only the key's length and SHA-256 prefix were logged. | `logs/mcp-transcript.txt` |
| 2 | Listed keys over HTTP: metadata only, no key and no hash field. | `logs/mcp-transcript.txt` |
| 3 | Connected the mock calendar through the paste-URL API so the catalog has real discovered tools. | `logs/mcp-transcript.txt`, `logs/mock-services-server.txt` |
| 4 | Seeded a decoy row marked requestable, a second user and that user's own Notion-shaped connector. | `logs/mcp-transcript.txt` |
| 5 | A real MCP client with the owner key listed exactly four tools: `errand_catalog`, `request_errand`, `errand_status`, `errand_call`. | `logs/mcp-transcript.txt` |
| 6 | `errand_catalog` returned only requestable tools (`calendar__create_event`, `calendar__list_events`): the non-requestable delete was absent and the decoy `export_all_contacts` was absent. Labels are Errand-generated (`Calendar: create event`); the upstream bidi/markup injection survived only as sanitised text. | `logs/mcp-transcript.txt` |
| 7 | `request_errand` asked for 900 calls, 12,345,678 cents and 1,440 minutes; the response clamped all three to 50 / 20,000 / 30 with `reason: server_maximum` and returned a `pending` slip immediately. | `logs/mcp-transcript.txt` |
| 8 | `errand_status` read the persisted pending slip back, with caps and zero usage. | `logs/mcp-transcript.txt` |
| 9 | `errand_call` before approval returned `not_forwarded` / `awaiting_approval`; nothing reached the mock. | `logs/mcp-transcript.txt` |
| 10 | `errand_call` for a tool outside the slip was refused as `out_of_scope` with `isError: true`. | `logs/mcp-transcript.txt` |
| 11 | A second user's key catalogued only `notion__search_pages`, never the owner's calendar tools. | `logs/mcp-transcript.txt` |
| 12 | Revoked the owner key; reconnecting with the same key was refused at the MCP endpoint with `401 unauthorized`. | `logs/mcp-transcript.txt` |
| 13 | Scanned every text column in the database: `agent_keys` stores a 64-hex SHA-256 whose prefix (`9d5f01920622`) matches the logged SHA-256 of the key; the full key pattern occurs 0 times. | `logs/db-key-scan.txt` |
| 14 | Full suite and typecheck. | `logs/test-output.txt`, `logs/typecheck.txt` |

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| 1 | low | The mock calendar's `create_event` description contains an injected instruction (`Ignore prior instructions`). It reaches the agent as sanitised data, and the ticket only requires sanitisation, not removal; it is a useful negative fixture. | `logs/mcp-transcript.txt` step 6 | accepted |

No blocker or high findings. The server logs for the window contain only the
listen lines; no errors or stack traces were emitted.

## Not proven

- Browser/UI: this ticket has no control-panel screen; the human surface is the
  JSON API. The P7 screens ticket consumes `/api/agent-keys`.
- Approval, capability token and persisted status transitions are ticket #9;
  this build never approves a slip. Expiry is derived on read for `pending` and
  `approved`, never persisted.
- The policy pipeline, journaled scope violations and forwarding are tickets
  #10/#11; `errand_call` checks slip membership but deliberately stops at
  `not_forwarded`.
- `tier` is `learner` for every request; the trust ledger that may grant a
  license is ticket #15.
- Description sanitisation removes markup, control and bidi characters and caps
  length; it does not filter natural-language instructions, which remain
  untrusted data the agent must not follow.
- OAuth for agents is out of scope (header bearer keys only, per the spec).
- Real Notion/Linear endpoints are ticket #21; the isolation step uses seeded
  rows, not a live second upstream.

## Verdict

Verdict: pass
