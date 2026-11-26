# Proof — P1 · Vault: envelope encryption, rotation, leak test (#4)

Backend-only ticket: no UI route or button is added, so proof is a command
transcript with the negative cases, the full test suite, a real gateway process
window, and a leak scan, per `docs/proof/README.md` ("Pure logic" and
"API / agent surface").

Environment: Windows, `bun 1.4.4`, `node v26.13.1`, SQLite in memory for the
transcript and tests, a temporary file database for the running gateway. The
key-encryption keys below are throwaway test material, not deployment keys.

## What was driven

- Envelope round trip: one credential stored, ciphertext and a 61-byte wrapped
  data key in the row, no plaintext in the row
  (`logs/vault-transcript.txt` → "envelope round trip").
- Call-time use: `withCredential` decrypted the secret inside its callback and
  forwarded it as a bearer header to a local upstream, which answered 200
  (`logs/vault-transcript.txt` → "usable at call time").
- **Negative case, key id:** the stored `key_id` was rewritten to another known
  key's id → `VaultError/decrypt_failed`.
- **Negative case, AAD:** the stored credential id was rewritten → `VaultError/decrypt_failed`.
- **Negative case, callback:** returning the secret, directly or wrapped in an
  object, raises `VaultError/secret_escaped`.
- **Negative case, cross-user:** a second user's vault asked for the same
  service id → `VaultError/credential_not_found`.
- Rotation: `rewrapped: 1`, ciphertext / nonce / auth tag byte-identical before
  and after, wrapped data key changed, and a vault holding only the new key
  decrypted the secret.
- Agent keys: format valid, 64-char hash stored, database contains no plaintext
  key, issued key verifies, an altered key does not, revocation stops
  verification.
- Leak scan: a freshly generated secret was seeded, used, and looked for in
  every GET response (`/health`, `/api/journal/verify`), the journal payloads,
  receipts, catalog tool rows, stored credential rows and captured console
  output — 0 matches in every artifact, while the upstream received it
  (`logs/vault-transcript.txt` → "leak scan").
- A real gateway process was booted against a seeded file database; `/health`
  and `/api/journal/verify` were fetched with a real client, and the process
  log and response bodies were grepped for the seeded secret → 0 matches
  (`logs/server.txt`, `logs/api-capture.txt`, `logs/leak-scan.txt`).
- The two endpoints were also opened in the in-app browser at desktop viewport;
  console errors: none, failed requests: none
  (`screens/01-health.png`, `screens/02-journal-verify.png`, `logs/browser-window.txt`).
- Full suite and typecheck: `logs/test-output.txt`, `logs/typecheck.txt`.

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| 1 | low | No SSE endpoint exists in P1, so no SSE frames could be captured; the live feed arrives in P7. Absence of an emitter is the stronger state, but it is recorded rather than implied. | logs/browser-window.txt | accepted |
| 2 | low | The browser shows raw JSON only; no control-panel route exists yet (P7). Not a regression. | screens/02-journal-verify.png | accepted |

## Not proven

- Rotation under concurrent writers: SQLite here is single-writer; the rotation
  transaction is not exercised against a second writer.
- Destruction of the old key after rotation: the keyring keeps previous
  material so rows written by an in-flight old-key path still decrypt. Discard
  is an operator step, not automated by this ticket.
- Multi-user selection: `withCredential(serviceId, fn)` stays the glossary's
  single operation and is scoped to the user the vault was opened for; the
  agent-facing route that chooses that user lands in P3.
- Gateway wiring: no HTTP route consumes a credential until P2, so the running
  gateway boots without constructing a vault. `openVaultForUser` is the
  config-to-keyring path and is covered by a test; a route is deliberately
  absent, not merely unproven.
- SSE frames: no endpoint exists until P7, so the leak criterion is proven for
  responses, journal, receipts, rows and logs only.
- Upstream transport security: the proof forwards to a local HTTP server; real
  connector egress is P2.

Verdict: pass
