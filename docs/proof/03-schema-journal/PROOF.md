# Proof â€” P1 Â· Schema plus hash-chained journal (#3)

Backend-only ticket: no UI route or button is added, so proof is a command
transcript plus a real client against the running gateway, per
`docs/proof/README.md` ("Pure logic" and "API / agent surface").

## What was driven

- Migrations on a fresh database, listing the created tables
  (`logs/journal-transcript.txt` Â§ "schema").
- Three appended events: genesis `prev_hash` is 64 zeros, each event's
  `prevHash` equals the previous `hash`, payload is canonical JSON
  (`logs/journal-transcript.txt` Â§ "append three events").
- Clean verify â†’ `{"ok":true,"checked":3}`.
- **Negative case:** raw-SQL tamper of one payload row â†’ verify reports
  `{"ok":false,"checked":1,"firstBrokenSeq":2}`; tampered hash row â†’ seq 1.
- Real `GET /api/journal/verify` and `GET /health` against a running gateway
  (`logs/api-journal-verify.txt`), with the matching server log
  (`logs/server.txt`).
- Same two endpoints rendered in the browser (`screens/01-health.png`,
  `screens/02-journal-verify-clean.png`).
- Full suite and typecheck: `logs/test-output.txt`, `logs/typecheck.txt`.

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| 1 | low | The browser shows empty-state JSON only; no control-panel route exists yet (P7 adds the journal screen). Not a regression, recorded so the gap is explicit. | screens/02-journal-verify-clean.png | accepted |

## Not proven

- Tamper-evidence cannot detect deletion of trailing events (a shorter chain
  is still internally consistent); no criterion requires an external head
  anchor.
- No per-user journal screen is driven (P7); scoping is proven at the query
  layer by `logs/test-output.txt` (scoped-reads tests).

Verdict: pass
