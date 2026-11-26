# Proof — #9 P4 · Human approval, slip signing, and the capability token

## Environment

- Git branch `ticket/09-approval-signing`, cut from `integration` at `b987a8e`.
- Gateway on `http://127.0.0.1:8831`, fresh SQLite at
  `docs/proof/09-approval-signing/proof.db` (removed after the run; the
  transcript is the committed artifact), `ALLOW_LOCALHOST_DEV=true`,
  `SESSION_COOKIE_SECURE=false` for loopback.
- Mock services on `http://127.0.0.1:4109` — the real `@modelcontextprotocol/server`
  calendar from `apps/mock-services`, not a stub.
- Client: a real MCP client (`@modelcontextprotocol/client` 2.4.0) for
  `request_errand` / `errand_status`, plus the gateway's human JSON API over
  loopback HTTP for the approval card, approve and deny.
- Bun 1.4.4, TypeScript 7.0.2. No dependency changed.

## Steps driven

1. `POST /api/auth/login` as the owner — authenticated session cookie.
2. `POST /api/agent-keys` — key created; the plaintext key was passed to the
   MCP client and never printed.
3. `POST /api/connectors` with the mock calendar — three tools catalogued;
   `calendar__list_events` is `read`.
4. `request_errand` over MCP with `calls: 900`, `spend_cents: 12_345_678` — a
   pending slip returns at once with caps clamped to 50 calls / 20,000 cents
   and both clamps stated with `reason: "server_maximum"`.
5. `errand_status` — `pending`, `callsRemaining: 50`,
   `spendRemainingCents: 20000`, `capability: null`.
6. `GET /api/slips/:id` — the approval card states the goal, the Calendar
   service and tool, what the agent can do (`Calendar: list events`), what it
   cannot (any unlisted tool, after expiry, over the call cap, change, delete,
   send, spend), the call and spend caps, `timeLeftSeconds: 1799` and
   `tier: "learner"`.
7. `POST /api/slips/:id/approve` with `callCap: 4`, `spendCapCents: 1000` —
   both caps applied; the response returns two trims (`50 → 4`, `20000 → 1000`),
   each with `reason: "human_trim"`, and the card now says “Make more than 4
   calls”.
8. `GET /api/slips/:id` again — the card still carries both trims with their
   reasons after reload, so the decision is not only visible in the one-shot
   approval response.
9. `errand_status` — `approved`, remaining caps 4 / 1000, and a capability
   (`cap_…`, redacted in the transcript).
10. Verification through the running system: the stored signature verifies; the
    capability verifies for its own slip and is refused when checked against
    another slip id (audience binding).
11. Second slip requested, then `POST /api/slips/:id/deny` with a reason —
    state `denied`, card shows denied, `errand_status` returns `denied` and
    `capability: null`.
12. A pending slip was seeded to expire in four seconds, approved, and read at
    once — `approved` with a capability and `timeLeftSeconds: 3`. After 4.5
    seconds: `expired`, `capability: null`. The unit suite also pins the
    millisecond boundary (valid at `12:29:59.999Z`, invalid at `12:30:00.000Z`).
13. The approved slip's goal was changed in the database, leaving its signature
    untouched — `verifySlipSignature` returns `false`, and `errand_status`
    still reports the stored state but returns `capability: null`. The byte
    alteration fails verification.

The transcript is `logs/slip-transcript.txt`; the gateway and mock server
windows are `logs/gateway-server.txt` and `logs/mock-services.txt`.

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| — | — | No finding: every step above passed | `logs/slip-transcript.txt` | — |

No credential, agent key or capability token is printed in the committed
transcript: the capability is shown as `cap_… redacted`, and keys are never
printed.

## Not proven

- The approval card was driven through the JSON API, not a rendered screen:
  the control-panel slip screen is ticket #18 and does not exist yet.
- Capability use inside a forwarded call is ticket #10/#11 (the policy
  pipeline). This ticket proves issue and verification, not call admission.
- HMAC key rotation: `HMAC_KEY` has no previous-key ring, so rotating it
  invalidates existing slip signatures and capabilities. The vault rotation
  path is separate; no rotation of the signing key is claimed here.

Verdict: pass
