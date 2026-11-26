# Ticket #9 — P4 · Human approval, slip signing, and the capability token

## Files built

- `packages/shared/src/index.ts` — shared slip vocabulary and HTTP shapes:
  `slipStateSchema`, `tierSchema`, `slipToolSchema`, `slipSummarySchema`,
  `approvalCardSchema`, `capTrimSchema`, `slipApprovalInputSchema`, plus the
  response shapes the control panel will consume.
- `apps/gateway/src/policy/slip-signing.ts` — canonical slip document (goal,
  tools, constraints, caps, tier, expiry, approval time, owner), HMAC-SHA256
  signature with a purpose-derived key separate from the vault key, constant-time
  verification.
- `apps/gateway/src/policy/capability.ts` — deterministic HMAC capability bound
  to one slip id and owner with the slip's exact expiry; only its SHA-256 hash
  is stored; verification checks hash, signature, audience, owner and
  millisecond expiry.
- `apps/gateway/src/slips/state.ts` — the one effective-state rule (`pending` /
  `approved` past expiry read `expired`).
- `apps/gateway/src/slips/row.ts`, `src/slips/caps.ts` — the slip row type and
  the one remaining-caps/countdown calculation, used by both the card and
  `errand_status`.
- `apps/gateway/src/slips/card.ts` — the plain-language approval card: goal,
  services, can/cannot, call and spend caps, remaining calls and money, time
  left, tier and the persisted trim record.
- `apps/gateway/src/slips/view.ts` — slip summary/detail reads and the newest-first
  list.
- `apps/gateway/src/slips/approval.ts` — approve (with trim-only cap edits and
  `human_trim` reasons) and deny in one transaction with the journal entry;
  signing, capability issuance and persisted trims.
- `apps/gateway/src/agent/status.ts` — `errand_status` now returns remaining
  caps, time left, and the capability only while approved, correctly signed and
  unexpired.
- `apps/gateway/src/agent/mcp.ts`, `src/app.ts`, `src/index.ts` — carry the HMAC
  key into the agent surface; add `GET /api/slips`, `GET /api/slips/:id`,
  `POST /api/slips/:id/approve`, `POST /api/slips/:id/deny`.
- `apps/gateway/src/connectors/labels.ts` — one home for the human tool label,
  now used by both the agent catalog and the approval card.
- `apps/gateway/src/db/schema.ts`, `drizzle/0004_tense_forge.sql`,
  `src/agent/slip-tools.ts` — a `trims` column (default `[]`) and the shared
  slip types instead of local restatements.
- Tests: `apps/gateway/tests/policy/slip-signing.test.ts`,
  `apps/gateway/tests/policy/capability.test.ts`,
  `apps/gateway/tests/slips/{card,approval,api}.test.ts`,
  `apps/gateway/tests/agent/{status,mcp}.test.ts` (new cases),
  `apps/gateway/tests/slips/proof-drive.ts` (live proof driver).
- Proof: `docs/proof/09-approval-signing/` (`PROOF.md`, MCP/API transcript,
  server windows, typecheck and full-suite output).

## Commands run

```
bun install --frozen-lockfile
bunx drizzle-kit generate                     # apps/gateway, adds 0004
bun run typecheck
bun test
bun run apps/mock-services/src/index.ts        # PORT=4109
bun run apps/gateway/src/index.ts              # PORT=8831, proof env
bun run apps/gateway/tests/slips/proof-drive.ts http://127.0.0.1:8831 <proof.db> http://127.0.0.1:4109
```

## Test output

```
$ bun run typecheck
@errand/shared typecheck: Exited with code 0
@errand/mock-services typecheck: Exited with code 0
@errand/web typecheck: Exited with code 0
@errand/gateway typecheck: Exited with code 0
✓ 4 checks passed: comments, installed, no-any, oauth-verifier

$ bun test
 293 pass
 0 fail
 769 expect() calls
Ran 293 tests across 38 files.
```

## Proof

- `docs/proof/09-approval-signing/PROOF.md` — verdict: pass.
- `logs/slip-transcript.txt` — real MCP client and live gateway: pending
  request, card, trim approval with reasons, capability on approval, audience
  rejection, deny, exact-expiry loss and tampered-slip rejection.
- `logs/gateway-server.txt`, `logs/mock-services.txt` — clean window.
- `logs/test-output.txt`, `logs/typecheck.txt` — full output.

## Versions changed

None. The ticket reuses `HMAC_KEY` from the existing config (already required
to boot) and `@errand/shared`; no dependency was added, removed or upgraded.

## Review findings addressed

Standards:
- Extracted `SlipRow` (`slips/row.ts`) and derived `SlipRecord` / `CardSlip` from
  it with `Pick`, so the schema is the only shape definition.
- Extracted `remainingAllowance` (`slips/caps.ts`) and used it from both the card
  and `errand_status`; the duplicated cap and countdown arithmetic is gone.
- The dead `try/catch` around `Buffer.from(..., "base64url")` was removed.
- Trim semantics now read `requested: original cap`, `applied: trimmed cap`
  (`50 → 4`), matching the clamp shape the agent already sees.
- `issueValidCapability` replaced the issue-then-reverify block in status.
- Test assertions and the proof driver now narrow `unknown` with Zod schemas
  instead of `as` casts; `slipDetailSchema` and `slipApprovedSchema` have real
  consumers.
- Security: approval/deny are one conditional `pending` update plus the journal
  entry in the same transaction, so a crash or a concurrent decision cannot
  leave an approved-but-unsigned slip; malformed JSON is `400 invalid_json`
  instead of an implicit approve-at-full-caps; a signing key under 32 bytes is
  refused when the app is constructed.
- Spec: trims are persisted in `slips.trims`, returned on the card and survive a
  reload; the proof drives the reload.

Spec / scope notes:
- The rendered approval screen is ticket #18; this ticket supplies the card
  model, persistence and JSON surface it will consume.
- The `burned` transition and capability revocation-on-burn belong to #12;
  `errand_status` already reports the state and withholds the capability.
- The capability proves the approved slip's identity, owner and exact expiry;
  tool/scope admission is checked from the signed slip in #10/#11, not duplicated
  into the token.

## Deviations / not done

- The diff is larger than the workflow's ~300-line review threshold because the
  ticket is one vertical slice (signing, capability, card, approval API,
  status, trims persistence) and the proof transcript is committed beside it.
  Both review axes were run over the whole diff.

## Unverified

- The rendered approval screen is ticket #18; this ticket proves the card model
  and JSON surface, not a UI walkthrough.
- Capability admission on a forwarded call is ticket #10/#11.
- HMAC signing-key rotation is not implemented: changing `HMAC_KEY` invalidates
  existing signatures and capabilities. No rotation is claimed.

## Next

`/implement 10` (branch `ticket/10-policy-pipeline`) is the direct dependent of
this ticket. Other runnable work is listed on the issue tracker.
