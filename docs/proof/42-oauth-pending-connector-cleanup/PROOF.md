# Proof — #42 OAuth pending-connector cleanup

## Environment

- Windows, Bun 1.4.4, SQLite file database.
- Before: `integration` at `13ec86c` in `D:\errand-42-before`.
- After: `ticket/42-oauth-pending-connector-cleanup` cut from the same `integration` commit.
- Gateway served over real HTTP with `createGatewayApp` (`auth: "disabled"` for local proof,
  owner user, `ALLOW_LOCALHOST_DEV=true`) against the real mock OAuth 2.1 + PKCE server in
  `apps/mock-services`. The OAuth start and callback endpoints were driven over `fetch`.
- The 10-minute attempt TTL was not waited out: `oauth_attempts.expires_at` was moved one
  second into the past with SQL, which is the same state the TTL produces. This is the only
  simulated step.

## Steps driven

Each scenario used a fresh database and gateway server.

1. **Expired attempt, then a new start.** Start a paste-a-URL flow, list connectors, expire
   the attempt, start a second flow, list connectors and inspect attempts/credentials.
2. **Pending connector with no tokens and no attempt row.** Start a flow, delete its attempt
   row and attempt secret (the state an earlier build left behind), start another flow.
3. **Authorized connector with an expired reauth attempt.** Complete an OAuth flow, insert an
   expired reauth attempt for the same connector, mark it `pending`, then start another flow.
4. **Another user's pending connector.** Insert a `pending` OAuth connector for `user-b`, then
   start a flow as the owner.

Commands:

```powershell
$env:PROOF_DIR="C:\Users\Rem\AppData\Local\Temp\opencode\errand-42-proof"
bun run run.ts D:\errand-42-before before 8779
bun run run.ts D:\errand-42       after  8780
```

Full transcripts, including every request, response and DB snapshot:
`logs/before.txt` and `logs/after.txt`. Connector and attempt UUIDs are replaced by stable
`id-N` labels, and one-shot `code`/`state` values plus PKCE challenges are redacted.

## Results

| Scenario | Before (`13ec86c`) | After (this branch) |
|---|---|---|
| 1. Expired attempt then new start | 2 `pending` connectors; abandoned connector and its credential remain | 1 `pending` connector; abandoned connector and its credential removed |
| 2. Pending connector with no attempt row | 2 `pending` connectors; orphan remains | 1 `pending` connector; orphan removed |
| 3. Authorized connector + expired reauth attempt | Connector and token credential survive; attempt removed | Same: connector and token credential survive; attempt removed |
| 4. Another user's pending connector | Untouched | Untouched |

Evidence:

- Scenario 1 before: `logs/before.txt` line `GET /api/connectors -> 200` shows both
  `Abandoned calendar` and `Replacement calendar`; the DB snapshot still lists the abandoned
  connector's `oauth` credential.
- Scenario 1 after: the same step lists only `Replacement calendar`; the snapshot has only the
  replacement connector's `oauth` credential and its attempt secret.
- Scenario 2 before/after: the orphan survives before and is gone after.
- Scenario 3: `credentials` still contains the authorized connector id and no
  `oauth_attempt:<id>` for the expired reauth attempt.
- Scenario 4: the `connectors` table still contains `user-b-oauth` for `user-b`.

## Test suite

```text
bun test tests/connectors/oauth.test.ts
22 pass, 0 fail, 235 expect() calls

bun test
365 pass, 0 fail, 1194 expect() calls, 45 files

bun run typecheck
@errand/shared typecheck: Exited with code 0
@errand/mock-services typecheck: Exited with code 0
@errand/web typecheck: Exited with code 0
@errand/gateway typecheck: Exited with code 0
✓ 4 checks passed: comments, installed, no-any, oauth-verifier
```

The new tests drive the real mock OAuth server and assert connector, attempt and credential
counts for the expired-attempt, orphan, consumed-attempt, token-survival, live-attempt,
reauth and other-user cases.

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| 1 | blocker | An expired attempt left its `pending` connector behind; two starts produced two rows | `logs/before.txt` | fixed |
| 2 | blocker | A pending connector with no tokens and no attempt row was never swept | `logs/before.txt` | fixed |

## Review findings addressed

Standards:

- One discard predicate (`connectorIsDiscardable`) now serves pruning and sweeping; the
  status/type scope is part of it instead of being duplicated differently at each call site.
- One `cleanupDeadConnectors` entry point owns the prune-then-sweep order for both starts.
- `attemptIdsFor` is the single attempt-id query used when discarding.
- The kept re-auth target is checked before any vault read, so a re-auth does not pay for
  decrypting its own state.
- Tests use `connectorRows()` like the existing `storedTokens()` helper.
- Committed transcripts now carry ISO timestamps and redact the one-shot `code` and `state`
  values from the callback.

Spec:

- Pruning now discards with every attempt id for the connector, so consumed attempts and
  their secrets cannot outlive a deleted connector.
- Pruning only discards OAuth connectors that are still `pending`, and an unreadable vault
  credential leaves the connector alone instead of failing the whole start.
- Added a real `startOAuthReauth` regression test for `keepConnectorId`, a sweep test that
  removes a still-present consumed-attempt secret, and the missing post-start attempt-count
  assertion.

## Not proven

- The Connectors screen was not driven in a browser: this change is gateway-side and does not
  alter that screen. The API responses and database above are the behaviour under test.
- A real 10-minute wait was not performed; expiry was set directly in SQLite as described.
- No live Notion or Linear account was used; the repo's OAuth 2.1 mock server is the real
  authorization server for this environment and exercises discovery, registration, PKCE,
  authorization code and issuer response.

Verdict: pass
