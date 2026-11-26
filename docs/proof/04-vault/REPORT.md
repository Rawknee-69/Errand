# Ticket #4 — P1 · Vault: envelope encryption, rotation, leak test

## Files built

- `apps/gateway/src/vault/envelope.ts` — HKDF-derived key-encryption key,
  AES-256-GCM secret sealing and data-key wrapping, credential/service AAD.
- `apps/gateway/src/vault/keyring.ts` — active key plus previous keys during a
  rotation.
- `apps/gateway/src/vault/credentials.ts` — `CredentialStore.store` and
  `rotate`; re-wraps data keys and never touches ciphertext.
- `apps/gateway/src/vault/vault.ts` — `Vault.withCredential(serviceId, fn)`,
  user-scoped, the only read operation; rejects a callback result that carries
  the secret.
- `apps/gateway/src/vault/common.ts`, `context.ts` — shared error/helper and the
  config → keyring → vault deployment path.
- `apps/gateway/src/vault/agent-keys.ts` — issue (shown once), SHA-256 storage,
  comparison against every stored hash with `timingSafeEqual`.
- Tests: `tests/vault/vault.test.ts`, `tests/vault/agent-keys.test.ts`,
  `tests/vault/leak.test.ts`, `tests/vault/support.ts`.
- `apps/gateway/src/config.ts`, `.env.example` — optional `VAULT_KEY_PREVIOUS`
  for rotation.
- Proof: `docs/proof/04-vault/` (PROOF.md, transcript, server/API leak scan,
  browser window log, screens).

## Commands run

```
bun run typecheck
bun test
bun run C:\...\vault-transcript.ts
bun run apps/gateway/src/index.ts   # then curl /health and /api/journal/verify
```

## Test output

```
$ bun run typecheck
@errand/shared typecheck: Exited with code 0
@errand/web typecheck: Exited with code 0
@errand/mock-services typecheck: Exited with code 0
@errand/gateway typecheck: Exited with code 0
✓ 3 checks passed: comments, installed, no-any

$ bun test
bun test v1.4.4 (38afee6c8)
 127 pass
 0 fail
 221 expect() calls
Ran 127 tests across 15 files.
```

## Proof

Command transcript with the negative cases (wrong key id, tampered AAD,
rotation without re-encryption, agent-key verification) and the cross-cutting
leak scan, plus a real gateway process window:

- docs/proof/04-vault/logs/vault-transcript.txt
- docs/proof/04-vault/logs/server.txt
- docs/proof/04-vault/logs/api-capture.txt
- docs/proof/04-vault/logs/leak-scan.txt
- docs/proof/04-vault/logs/browser-window.txt
- docs/proof/04-vault/logs/test-output.txt
- docs/proof/04-vault/logs/typecheck.txt
- docs/proof/04-vault/screens/01-health.png
- docs/proof/04-vault/screens/02-journal-verify.png

Verdict: pass (see docs/proof/04-vault/PROOF.md).

## Versions changed

- None. Node's built-in `crypto` provides AES-256-GCM and `timingSafeEqual`;
  no dependency was added, so `docs/VERSIONS.md` is unchanged.

## Unverified / notes

- Rotation under concurrent writers and old-key destruction are not exercised;
  see the "Not proven" section of PROOF.md.
- No SSE endpoint exists until P7, so the leak scan covers responses, journal,
  receipts, rows and logs, not frames.
- No HTTP route consumes credentials until P2, so the running gateway boots
  without constructing a vault; `openVaultForUser` is the config → keyring
  deployment path and is covered by a test.
- `withCredential` is scoped to the user its vault was opened for, per the
  glossary's `withCredential(serviceId, fn)` signature; the agent-facing route
  that selects the user lands in P3.

## Review

`/code-review` run (Standards + Spec axes) against `integration`. Findings
addressed in-branch:

- Read surface widened beyond `withCredential`: storage and rotation moved to
  `CredentialStore`, the vault now exposes one class with one read method.
- `withCredential` ignored the user while storage keyed on `(user, service)`;
  the vault is now opened for a user and filters on it.
- A callback could return the secret; the result is now rejected with
  `secret_escaped`.
- Agent-key comparison was decided by the SQL lookup; verification now scans
  every stored hash with `timingSafeEqual` and no early exit.
- Bare SHA-256 key derivation replaced with HKDF; `VAULT_KEY_PREVIOUS` plus
  `openVaultForUser` give the config → keyring path.
- Duplicated row projection, duplicated test fixtures, a hard-coded key format,
  a middle-man factory and indexed-read `!` assertions removed or typed away.
- Unasked revocation helper removed; leak scan extended to catalog tool rows
  and callback escape tests.
