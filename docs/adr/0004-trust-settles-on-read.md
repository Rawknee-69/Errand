# ADR-0004: The trust list settles runs when it is read

**Status:** Accepted (2026-11-27)

## Context

A run settles when its cap is reached or its Slip expires: calls and receipts
are judged by `evaluateRun`, a clean run raises `cleanRuns`, and an unclean one
demotes the errand type. Settlement therefore mutates the Slip and the trust row
and appends journal events.

There are three triggers: the forwarder settles when the last call completes,
`requestErrand` settles before creating the next Slip, and `listTrustViews`
settles every approved, unsettled run. The last one means `GET /api/trust`
writes.

## Decision

Keep the read trigger. The Trust screen is the only place a human sees whether a
run counted, and there is no trust scheduler in the gateway; removing the read
trigger would show a stale verdict indefinitely after an expiry that no later
call touched. A mutating read is the price of a truthful screen at this scale.

The pure verdict (`evaluateRun`) stays separate from the trigger so the rules are
tested directly. The trigger is exercised through the trust API tests.

## Consequences

- A future review should treat "the GET writes" as a known trade-off, not a
  defect, unless a scheduler is introduced.
- If a background settlement worker is added, delete the read trigger and update
  the trust API tests in the same change; the two triggers are one decision.
- `listTrustViews` is not a pure read. Callers that need a pure read of the trust
  rows must not use it.
