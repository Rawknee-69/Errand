# Proof

Approval is based on what the running system does, not on reading a diff. A
diff tells you what someone intended; proof tells you what happened. Nobody
can hold 300 lines of change in their head and predict every button, so the
gate drives the thing instead.

The diff is still read — but only to locate a cause after proof fails.

## Layout

One directory per ticket, committed with the ticket:

```
docs/proof/<NN>-<slug>/
├── PROOF.md              required: what was driven, findings, verdict
├── screens/              NN-what-happened.png
├── logs/                 console.log, network.log, server.log, sse.log
└── video/                optional .webm, only when motion is the point
```

## What counts as proof

| Change | Proof |
|---|---|
| UI | Browser walkthrough: every route, every button pressed, empty / loading / error states, phone viewport 390×844 and desktop 1440×900. Screenshot per step, console and network logs captured. |
| API / agent surface | A real client, not a mock: an MCP client or `curl` against the running gateway, with request and full response captured, plus the server log for the same window. |
| Pure logic (vault, HMAC, journal) | Command transcript with the actual output, including the negative case (wrong key fails, tampered row breaks verify) — not a claim that it does. |
| Bug fix | The failing behaviour before, the same steps after, both captured. |

A passing test suite is necessary and never sufficient: it proves the paths
someone thought of.

## Driving it

- In-app browser first: open the app, click through it, read the console and
  network panes. Fall back to the Playwright MCP server when a flow needs
  recording or something the pane cannot do.
- Press every button at least once, including the ones that look boring.
  Cancel, deny, go back, refresh mid-flow, double-click.
- Check the phone viewport, since the human approves slips from a phone.
- Capture the console: any error or warning is a finding, even if the screen
  looks right.
- Capture failed network requests and the SSE frames for the window.
- Confirm no credential, token or key is visible in the page, the network
  payloads or the logs.
- Log everything as it happens. Reconstructing evidence from memory is how
  false passes get written.

## Findings

Every finding is one row and points at the artifact that shows it, so the
fixing agent works from evidence rather than description.

```markdown
## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| 1 | high | Approve button stays disabled after editing caps | screens/03-approve-disabled.png | open |
| 2 | low | Console warning: missing key on feed list | logs/console.log:41 | open |
```

Severity: `blocker` (cannot ship), `high` (breaks a demo path), `medium`
(wrong but recoverable), `low` (cosmetic or noisy).

## Verdict

End `PROOF.md` with one of:

- `Verdict: pass` — every step driven, no open blocker or high finding.
- `Verdict: fail` — with the findings that block, each linked to an artifact,
  and the fix either in this branch or filed as a ticket.

Say what was **not** proven. "Not driven: OAuth consent screen, needs a real
account" is worth more than an implied pass.

## Size

- Screenshots: PNG, ≤ 300 KB each.
- Video: `.webm`, ≤ 10 seconds, only when motion is the point (a burn, a live
  feed, an animation). Do not commit anything over 5 MB; keep it locally and
  link the path in `PROOF.md`.
- Logs: trim to the window that was driven, keep the timestamps.
