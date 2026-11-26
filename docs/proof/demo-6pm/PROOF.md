# Proof — demo branch, 6pm walkthrough

> Branch `demo/6pm`, cut from `integration` at `13ec86c` (the merged Notion and
> Linear connectors plus the Slips approval screen and live feed). This is a
> demo branch, not a ticket: it adds one read-only boundary endpoint, a Demo
> screen, a one-command stack and a scripted agent pass.

## Environment

- Windows, Bun 1.4.4, TypeScript 7.0.2.
- Gateway `http://127.0.0.1:8787`, web `http://127.0.0.1:5173`, mock services
  `http://127.0.0.1:4001`, SQLite `D:\errand\.demo\errand.db`.
- `bun run demo:up` sets demo mode, an insecure local cookie, localhost egress
  and a fresh `.demo/secrets.json`; owner passphrase `errand-demo-passphrase`.
- Real Notion endpoint `https://mcp.notion.com/mcp` probed live; OAuth consent
  itself was not completed in this run (it needs a real Notion account tap).
  Ticket #21's proof already drives that flow end to end.

## Steps driven

1. Signed in as owner. Landed on **Demo**.
2. Read the live boundary: 1 connector, 3 tools discovered, 2 agent-visible,
   1 hidden (`calendar__delete_event`, not exposed). Numbers came from
   `GET /api/boundary`, the same filter `errand_catalog` uses.
3. **Connect** → tapped **Notion** → **Check server**. The probe answered in
   194 ms: protected, OAuth suggested, 0 unauthenticated tools. The auth step
   selected **Sign in (OAuth)** by default.
4. Returned to **Demo**, issued a demo agent key. The key, Claude Code command,
   Cursor JSON and the credential-free prompt all rendered.
5. Ran `bun run demo:seed`: connected the mock calendar, exposed
   `list_events` + `create_event`, hid `delete_event`, issued an agent key.
6. Ran `bun run demo:agent` and approved its pending slip in **Slips**, trimming
   calls 4 → 2. The agent received the capability, made the allowed call, and
   was refused an exposed-but-out-of-slip call (`out_of_scope`).
7. Ran `bun run demo:agent -- --auto-approve` as the rehearsal path.
8. Opened **Trace**. Ten journal rows: credential sealed, connector connected,
   catalog ingested, agent key created, slip requested, slip approved, call
   allowed, vault credential used, call succeeded, scope violation. Expanded
   the success row and read the exact message (`{}`) and output (178 bytes) next
   to the journal payload. Verified the chain.
9. Used the **Job plan**: the calendar job requires exactly
   `calendar__list_events`; `calendar__create_event` is named as left out; the
   generated prompt tells the agent to request exactly that set.
10. Captured the same screens at 390×844 with Chromium device metrics.

## Findings

| # | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| 1 | low | Tally and heading read “1 connectors”, “1 tools”, “1 credentials sealed” | `screens/01-demo-boundary.png` | Fixed: `plural()` in `Demo.tsx` |
| 2 | medium | Changing screens kept the previous scroll offset, so a heading could start above the viewport | `screens/03-connect-quick-picks.png` (before fix) | Fixed: `useScreen` scrolls to top on navigate and popstate |
| 3 | low | Probe said “it asks for oauth” | `screens/04-connect-notion-oauth.png` (before fix) | Fixed: `AUTH_HINT_LABEL` wording |
| 4 | low | Demo copy claimed receipts arrive on the live feed, but no Receipts screen is built on this branch | `screens/06-slips-feed.png` | Fixed: copy says calls, approvals and denials |
| 5 | info | Burned state is displayed nowhere on Demo because the burn path is not wired on this branch | `screens/05-slips-pending.png`, `logs/agent-run.txt` | Stayed honest: docs say demo the `out_of_scope` denial, not a burn |
| 6 | medium | The Trace showed raw connector UUIDs and a bare event count; a viewer could not tell which service was involved | Trace screen before the fix | Fixed: `connectorName` is resolved in `traceView` and summaries name the host, auth type and tool counts |
| 7 | high | A no-auth connector produced zero vault rows, so the vault story was not visible | Trace at 8 events, `0 vault uses` | Fixed: `demo:seed` uses the mock calendar's secured path; Trace now records `Credential sealed in the vault` and `Vault credential used` (bearer · Calendar), never the value |
| 8 | low | Job plan read “signed with exactly these 1 tool” | `screens/09-demo-job-plan.png` (before) | Fixed: “exactly 1 tool” |

No console errors were recorded in the browser during the pass.

## Evidence

- `screens/01-demo-boundary.png` — boundary ledger, both layers, hidden list.
- `screens/02-demo-key-prompt.png` — issued key, client config, demo prompt.
- `screens/03-connect-quick-picks.png` — Notion, Linear and offline presets.
- `screens/04-connect-notion-oauth.png` — live Notion probe and OAuth choice.
- `screens/05-slips-pending.png` — plain-language card, can/cannot, caps,
  tighten, approve/deny.
- `screens/06-slips-feed.png` — decided slip and live feed with allowed call,
  scope violation and approval.
- `screens/07-phone-demo.png` — 390×844 demo screen.
- `screens/08-trace-vault.png` — full Trace with the vault row expanded: auth
  type, connector name and purpose, with the value absent.
- `screens/09-demo-job-plan.png` — job plan naming the one required tool and
  the visible tool left out.
- `logs/agent-run.txt` — hidden-tool refusal, approval, capability, forwarded
  call, out-of-scope refusal, journal check.
- `logs/checks.txt` — suite, typecheck, build, seed and both agent runs.

## Verdict

**pass** — the UI's numbers come from the running gateway; the agent saw 2 of 3
discovered tools, requested 1 of those 2, could not request the hidden tool, and
could not step outside the approved slip. The Trace shows the exact message and
output for the call, and records vault sealing and use without the value.
Notion's probe and OAuth choice are live; the human consent tap is the one step
not repeated on this branch.
