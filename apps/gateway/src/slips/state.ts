import type { SlipState } from "@errand/shared";

export function effectiveSlipState(
  slip: { state: SlipState; expiresAt: string },
  now: Date,
): SlipState {
  if (slip.state !== "pending" && slip.state !== "approved") return slip.state;
  return Date.parse(slip.expiresAt) <= now.getTime() ? "expired" : slip.state;
}
