import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { appendJournalEventIn } from "../db/journal.ts";
import { slips, trust } from "../db/schema.ts";

type BurnReason = "decoy" | "second_scope_violation";

export type ViolationInput = {
  userId: string;
  slipId: string;
  tool: string;
  reason: "decoy" | "out_of_scope";
  arguments: Record<string, unknown>;
  now?: Date;
};

export type ViolationOutcome = { burned: BurnReason | null; burnedAt: string | null };

// A decoy burns immediately; a scope violation burns on the second attempt.
// The call event, the slip mutation, the capability revocation, the trust
// demotion and the burn event commit together or not at all.
export function recordViolation(db: Db, input: ViolationInput): ViolationOutcome {
  const now = input.now ?? new Date();
  const at = now.toISOString();
  const isDecoy = input.reason === "decoy";
  const slipFilter = and(eq(slips.userId, input.userId), eq(slips.id, input.slipId));

  return db.transaction((tx) => {
    const row = tx.select().from(slips).where(slipFilter).all()[0];
    if (row === undefined) {
      throw new Error(`Slip ${input.slipId} vanished while recording a violation`);
    }

    const scopeViolations = isDecoy ? row.scopeViolations : row.scopeViolations + 1;
    const burned: BurnReason | null = isDecoy
      ? "decoy"
      : scopeViolations >= 2
        ? "second_scope_violation"
        : null;

    appendJournalEventIn(tx, {
      userId: input.userId,
      eventType: isDecoy ? "call.denied" : "call.scope_violation",
      payload: {
        slip_id: row.id,
        tool: input.tool,
        reason: input.reason,
        arguments: input.arguments,
        scope_violations: scopeViolations,
        burned: burned !== null,
      },
    });

    if (burned === null) {
      tx.update(slips)
        .set({ scopeViolations, updatedAt: at })
        .where(slipFilter)
        .run();
      return { burned, burnedAt: null };
    }

    // The burn event's timestamp is the slip's burn time, so the audit trail
    // and the slip row cannot disagree.
    const burnEvent = appendJournalEventIn(tx, {
      userId: input.userId,
      eventType: "slip.burned",
      payload: {
        slip_id: row.id,
        errand_type: row.errandType,
        reason: burned,
        tool: input.tool,
        scope_violations: scopeViolations,
        capability_revoked: true,
      },
    });
    tx.update(slips)
      .set({
        state: "burned",
        scopeViolations,
        capabilityHash: null,
        burnedAt: burnEvent.createdAt,
        burnedReason: burned,
        updatedAt: burnEvent.createdAt,
      })
      .where(slipFilter)
      .run();

    tx.update(trust)
      .set({ tier: "learner", cleanRuns: 0, caps: "{}", updatedAt: burnEvent.createdAt })
      .where(and(eq(trust.userId, input.userId), eq(trust.errandType, row.errandType)))
      .run();

    return { burned, burnedAt: burnEvent.createdAt };
  });
}
