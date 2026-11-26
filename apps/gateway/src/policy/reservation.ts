import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { slips } from "../db/schema.ts";
import { remainingAllowance } from "../slips/caps.ts";
import { RATE_WINDOW_MS } from "./rate.ts";

export type ReservationFailure =
  | "call_cap_reached"
  | "spend_cap_exceeded"
  | "rate_limited"
  | "not_approved";

export type ReservationResult =
  | { ok: true; callsRemaining: number; spendRemainingCents: number }
  | { ok: false; reason: ReservationFailure };

export type ReserveCallInput = {
  userId: string;
  slipId: string;
  amountCents: number;
  now: Date;
};

type SlipRow = typeof slips.$inferSelect;

function readSlip(
  tx: Pick<Db, "select">,
  userId: string,
  slipId: string,
): SlipRow | undefined {
  return tx
    .select()
    .from(slips)
    .where(and(eq(slips.userId, userId), eq(slips.id, slipId)))
    .all()[0];
}

function failureReason(slip: SlipRow, amountCents: number): ReservationFailure {
  if (slip.callsUsed >= slip.callCap) return "call_cap_reached";
  if (slip.spendUsedCents + amountCents > slip.spendCapCents) return "spend_cap_exceeded";
  if (slip.rateWindowCalls >= slip.rateCap) return "rate_limited";
  if (slip.state !== "approved") return "not_approved";
  throw new Error(`Reservation for slip ${slip.id} failed without a cap reason`);
}

// Calls, call rate and spend are reserved in one conditional update, so two
// concurrent attempts cannot both consume the last unit of a cap.
export function reserveCall(db: Db, input: ReserveCallInput): ReservationResult {
  return db.transaction((tx) => {
    const before = readSlip(tx, input.userId, input.slipId);
    if (before === undefined) throw new Error(`Slip ${input.slipId} vanished during reservation`);

    const nowMs = input.now.getTime();
    const windowStarted = before.rateWindowStartedAt === null ? Number.NaN : Date.parse(before.rateWindowStartedAt);
    if (!Number.isFinite(windowStarted) || nowMs - windowStarted >= RATE_WINDOW_MS) {
      tx.update(slips)
        .set({ rateWindowStartedAt: input.now.toISOString(), rateWindowCalls: 0 })
        .where(and(eq(slips.userId, input.userId), eq(slips.id, input.slipId)))
        .run();
    }

    const updated = tx
      .update(slips)
      .set({
        callsUsed: sql`${slips.callsUsed} + 1`,
        spendUsedCents: sql`${slips.spendUsedCents} + ${input.amountCents}`,
        rateWindowCalls: sql`${slips.rateWindowCalls} + 1`,
        updatedAt: input.now.toISOString(),
      })
      .where(
        and(
          eq(slips.userId, input.userId),
          eq(slips.id, input.slipId),
          eq(slips.state, "approved"),
          lt(slips.callsUsed, slips.callCap),
          sql`${slips.spendUsedCents} + ${input.amountCents} <= ${slips.spendCapCents}`,
          lt(slips.rateWindowCalls, slips.rateCap),
        ),
      )
      .returning()
      .all();

    const after = updated[0];
    if (after === undefined) {
      const current = readSlip(tx, input.userId, input.slipId);
      if (current === undefined) throw new Error(`Slip ${input.slipId} vanished during reservation`);
      return { ok: false, reason: failureReason(current, input.amountCents) };
    }

    const allowance = remainingAllowance(after, input.now);
    return {
      ok: true,
      callsRemaining: allowance.callsRemaining,
      spendRemainingCents: allowance.spendRemainingCents,
    };
  });
}
