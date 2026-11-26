// The demo's spend tools carry their amount in `cents`; one name so the
// pipeline and the fixtures cannot drift.
export const SPEND_AMOUNT_ARGUMENT = "cents";

export function spendRequestCents(args: Record<string, unknown>): number | undefined {
  const cents = args[SPEND_AMOUNT_ARGUMENT];
  if (typeof cents !== "number" || !Number.isInteger(cents) || cents < 0) return undefined;
  return cents;
}
