# Ticket #13 — P5 · Decoys, burns and scope-violation escalation

## Environment

- Windows 11, Bun 1.4.4, TypeScript 7.0.2.
- Gateway on `http://127.0.0.1:8843`, mock services on
  `http://127.0.0.1:4123`, web control panel on `http://localhost:5173`
  (Vite proxy to the gateway).
- Scratch database `docs/proof/13-decoys-burns/proof.db` (ignored by git),
  `ALLOW_LOCALHOST_DEV=true` for the loopback mock, `SESSION_COOKIE_SECURE=false`
  because the proof is plain HTTP.
- Real client: `@modelcontextprotocol/client` 2.4.0
  `StreamableHTTPClientTransport` against `/mcp`, bearer agent key. The same
  session logged in through the real web control panel.

## Steps driven

| # | Step | Evidence |
|---|---|---|
| 1 | Logged in as the owner, created an agent key, connected the mock Calendar server through the paste-URL API. | `logs/burn-transcript.txt` |
| 2 | Opened the live feed SSE stream (`/api/events?since=0`) before any violation, so each later frame was captured live. | `logs/burn-transcript.txt` |
| 3 | Requested and approved a slip, then called `calendar__export_all_contacts`: the triggering response is `decoy` with `slip_state: "burned"`; the slip became `burned`, `capabilityHash` was cleared, the seeded `license` trust row became `learner` with `cleanRuns: 0` and `caps: {}`. | `logs/burn-transcript.txt` |
| 4 | Repeated step 3 for `calendar__transfer_all_funds` and `calendar__delete_all_data`: all three decoys are recognised in the call path and inert. | `logs/burn-transcript.txt` |
| 5 | After each burn, called an in-slip tool with the old capability: structured `burned` error with `slip_state: "burned"` and `burned_reason`; `errand_status` returned `state: burned`, `capability: null`. | `logs/burn-transcript.txt` |
| 6 | On a fresh approved slip, called `calendar__delete_event` once: `out_of_scope`, slip still `approved`, `scopeViolations: 1`, capability still live, trust still `license`. | `logs/burn-transcript.txt` |
| 7 | Called `calendar__delete_event` a second time: the triggering response is `out_of_scope` with `slip_state: "burned"`; the slip is `burned` with reason `second_scope_violation`, `scopeViolations: 2`, capability revoked, trust demoted to `learner` with caps cleared. | `logs/burn-transcript.txt` |
| 8 | Called again after the second violation: structured `burned` error with `burned_reason: "second_scope_violation"`. | `logs/burn-transcript.txt` |
| 9 | The live feed carried all four `slip.burned` frames with their reasons over SSE. | `logs/burn-transcript.txt` |
| 10 | `/api/journal/verify` returned `{ok: true, checked: 24}` over the full run. | `logs/burn-transcript.txt` |
| 11 | Opened the control panel, logged in and loaded Slips: four burned slips and the burn/scope frames appear in the live feed without a refresh; console had no errors or warnings, and no API request failed. | `screens/01-slips-burned.png`, `screens/02-live-feed-burns.png`, `logs/console.txt`, `logs/network.txt` |
| 12 | Full suite and typecheck. | `logs/test-output.txt`, `logs/typecheck.txt` |

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| — | — | No open findings. | — | — |

## Not proven here

- The phone viewport (390×844) was not driven: the attached in-app browser has
  no viewport control and the Playwright MCP server has no Chrome install on
  this machine. This ticket changes no UI; the desktop walkthrough above is the
  whole UI surface it touches.
- Two simultaneous scope violations on one slip were not raced against the live
  gateway. The count and burn happen in one SQLite transaction, and the
  in-process suite covers the sequential escalation; a two-process race is
  not repeated here.
- Scope escalation is deliberately tied to the pipeline's `out_of_scope` step
  (a tool not in the slip). A class mismatch, failed argument schema, missing
  send allowlist or unhealthy connector is a different denial and does not
  count toward the two-strike burn.
- The web UI shows burn reasons as the stored identifiers (`decoy`,
  `second_scope_violation`), which are glossary terms. Human-friendly copy for
  those identifiers belongs to the screen tickets, not this policy ticket.

Verdict: pass
