# The 6pm demo

Branch: `demo/6pm`, cut from `integration` at `13ec86c` (Notion/Linear real
connectors + the Slips approval screen and live feed are already in it).

The demo has one job: show that an agent gets one door, one key and only the
tools for the job — and that the hiding is enforced by the gateway, not by a
prompt.

## Bring it up

```sh
bun install          # once
bun run demo:up      # gateway :8787, web :5173, mock services :4001
bun run demo:seed    # offline fallback data + one agent key
```

`demo:up` writes secrets, the SQLite file and logs under `.demo/` (gitignored).
It prints the owner passphrase: `errand-demo-passphrase`.

- Control panel: <http://127.0.0.1:5173>
- Logs: `.demo/logs/{gateway,web,mock-services}.log`
- `bun run demo:up --fresh` starts with an empty database.
- `Ctrl+C` stops all three processes.

Everything below works with network. If Notion login fails on the day, use the
offline calendar path at the end; it is the same policy path and the same UI.

## The six-minute run

### 1. The boundary screen (30s)

Sign in with the passphrase and land on **Demo**.

Read the four numbers aloud: connectors, tools discovered, tools the agent can
name, tools hidden from it. They come from `GET /api/boundary`, which is the
same filter the agent endpoint uses. Nothing here is a slide.

Point at **Bottom layer** (what Errand holds) versus **Top layer** (one URL, one
key, four tools).

### 2. Connect Notion (90s)

**Connect** → tap **Notion** → **Check server**. The probe reports the URL is
protected and offers **Sign in (OAuth)**. Continue, sign in to Notion, approve
the workspace. The browser returns to **Connectors** with the connector active.

In **Catalog**, Notion appears with its full tool list, each classified
`read`, `write`, `send`, `delete` or `spend`, each with a pinned definition hash.
Risky classes start non-requestable.

Expose only what the story needs — for example `notion__notion_search` — and
leave the destructive tools off. The exact agent-side check happens in step 4.

### 3. Hand the agent the door (45s)

Back on **Demo**, use the **Job plan**. Pick *Read the calendar*: it names the
one required tool and the visible tool it leaves out
(`calendar__create_event`). For the Notion story, pick *Search Notion*; it names
`notion__notion_search` as the only tool the prompt needs.

The generated prompt tells the agent to request exactly that set and never to
add a tool "just in case". Issue a demo agent key. It is shown once. Copy the
Cursor config (or the Claude Code command) and the prompt. It reads:

```text
You are working through Errand, my MCP doorway. Use only the Errand tools: errand_catalog, request_errand, errand_status, errand_call. You have no other credential or connector URL.

Goal: Summarise this week's calendar

Required tools for this job: calendar__list_events.

1. Call errand_catalog only to confirm those tools are there. Do not request every tool you can see.
2. Call request_errand with exactly the required tools above and limits { "calls": 6 }. Do not add a tool "just in case".
3. Stop and tell me it is pending. I will approve the slip in Errand.
4. After I say approved, call errand_status to collect the capability, then errand_call one call at a time.
5. If a tool is not on the slip, stop. Do not retry, widen the request, or look for another route.
```

### 4. The agent asks; the human decides (90s)

The agent calls `errand_catalog`. It sees the four Errand tools and the few
upstream tools you exposed — not the other 70-odd Notion tools.

It asks for a slip. **Slips** shows a plain-language card: the goal, the tools,
`It can` / `It cannot`, call and spend caps, expiry. Trim the calls if you like,
then approve. The live feed records the approval.

The agent now has a capability that admits this slip and nothing else. When it
calls a tool outside the slip, the call is refused with `out_of_scope` before
anything is forwarded. That is the sentence to land: *the prompt asks, the
gateway enforces.*

### 5. Full transparency (60s)

Open **Trace**. Every row is a journal entry, newest first; filter by Slips,
Calls, Vault, Connectors, Catalog or Keys. Expand a call row to see:

- the exact **message** the agent sent (arguments),
- the exact **output** the connector returned,
- the **journal payload** with slip id, call id, class, duration and byte count.

The vault rows say `Credential sealed in the vault` and `Vault credential used`
with the connector and auth type — never the value. End with **Verify the
chain**: it reports the event count or the first broken sequence.

### 6. The safety objects (45s)

Four cards on **Demo**, all live:

- **Sign-in** — one owner, one passphrase. The demo guest picker is a journaled
  deviation; each guest sees only their own rows.
- **Vault** — connector credentials are envelope-encrypted. Only
  `withCredential(service, fn)` decrypts; there is no reveal endpoint. The leak
  test greps logs, API responses, SSE frames and receipts for the secret.
- **Slip** — HMAC-signed; what the human approved is byte-for-byte what runs.
- **Journal** — append-only hash chain. Tap **Verify the chain**; it reports the
  event count or the first broken sequence.

End by showing the journal after the demo: every request, approval, allowed call
and denial is an event.

## Offline path (network failure plan)

`demo:seed` connects the local mock calendar over its secured path (the token
lives only in the vault) and exposes `list_events` and `create_event` while
leaving `delete_event` hidden. Every call therefore adds a `vault.credential_used`
row to the Trace, next to the exact message and output.

Rehearse the whole agent pass with no human tap:

```sh
bun run demo:agent -- --auto-approve
```

It prints, in order:

1. the tools the agent may name;
2. a request for the hidden `calendar__delete_event` being refused;
3. a scoped slip request for `calendar__list_events`;
4. the approval, with a cap trim;
5. the allowed call and its result;
6. an attempted `calendar__create_event` refused as `out_of_scope`;
7. a journal verification.

On stage, drop `--auto-approve`: the script waits while you approve in
**Slips**, and the feed updates beside you.

## Claims to keep honest

- Notion and Linear are real remote MCP servers; Google Calendar is a local
  mock and the UI labels the connector as mock.
- No real payments, orders or trades run.
- Receipts, Trust, Journal and Keys screens are still placeholders on this
  branch; the Demo screen carries the live journal check and key issuance.
- Do not demo a decoy burn: the current policy rejects decoy calls but the burn
  path is not wired on this branch. Show the `out_of_scope` denial instead.

## If something is wrong

| Symptom | Check |
|---|---|
| `demo:up` exits or a port is taken | The log tail it prints; stop the old process or change ports in `scripts/demo-up.ts`. |
| Owner login fails | `.demo/secrets.json` holds the passphrase; `demo:up` printed it. |
| Notion returns to a dead page | `OAUTH_REDIRECT_URI` must be `http://127.0.0.1:8787/api/oauth/callback` and `WEB_ORIGIN` `http://127.0.0.1:5173` (set by `demo:up`). |
| Agent cannot see a tool | Catalog → the tool's **requestable** switch; a changed definition also blocks it until re-approved. |
| The agent script says the slip is pending | Approve it in **Slips**; the script polls for three minutes. |
