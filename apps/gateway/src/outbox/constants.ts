// A send waits this long before it is released, and the human can stop it
// anywhere in the window.
export const SEND_HOLD_MS = 30_000;

// Past `expiresAt` an outbox item has missed its window and must never fire.
// Sends get one extra minute after release; spends get five minutes to tap.
export const SEND_EXPIRY_GRACE_MS = 60_000;
export const SPEND_TAP_TTL_MS = 5 * 60_000;
