# ADR-0003: Undo is a human act, not a Slip call

**Status:** Accepted (2026-11-27)

## Context

Every agent call passes `admitCall`: capability, signature, decoy, scope, class,
constraints and an atomic cap reservation. Undo runs a stored inverse instead.
It is session-authenticated and journaled, but it carries no capability and
reserves no cap, because the Slip it reverses may already be expired, denied or
burned.

An architecture review flagged that gap as a second, unguarded path to an
upstream tool and proposed routing undo through admission.

## Decision

1. An undo is authorised by the **human's authenticated session**, not by the
   Slip's capability. A revoked capability must not block cleanup of a change it
   made, so `admitCall` is the wrong gate for undo.
2. Undo still crosses the same upstream module (`connectors/upstream.ts`) as the
   forwarder, and claims its `undo_actions` row with the same typed, conditional
   write the rest of the schema uses. That is the shared seam.
3. `undo.applied` / `undo.mismatched` / `undo.failed` are journaled, so the human
   act is auditable even though no Slip authorised it.

## Consequences

- A future review should not re-suggest passing undo through capability
  admission; doing so breaks undo after a burn.
- Any new feature that calls an upstream tool must go through
  `connectors/upstream.ts`; the check suite watches for a second call path only
  indirectly, through code review.
- If undo ever becomes agent-initiated, it must become a Slip call and lose this
  exemption.
