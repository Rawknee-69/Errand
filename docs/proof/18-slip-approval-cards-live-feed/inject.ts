import { createMigratedDatabase } from "../../../apps/gateway/src/db/client.ts";
import { appendJournalEvent } from "../../../apps/gateway/src/db/journal.ts";
import { journal, slips } from "../../../apps/gateway/src/db/schema.ts";

const db = createMigratedDatabase("docs/proof/18-slip-approval-cards-live-feed/proof.db");
db.$client.exec("PRAGMA busy_timeout = 5000;");

const now = new Date().toISOString();
db.insert(slips)
  .values({
    id: "proof-burn-slip",
    userId: "owner",
    errandType: "proof-burn-type",
    goal: "Export every contact to a spreadsheet",
    state: "burned",
    tier: "learner",
    tools: "[]",
    constraints: "{}",
    callCap: 3,
    spendCapCents: 0,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    createdAt: now,
    updatedAt: now,
    burnedAt: now,
    burnedReason: "A decoy tool was touched",
  })
  .onConflictDoNothing()
  .run();

const burn = appendJournalEvent(db, {
  userId: "owner",
  eventType: "slip.burned",
  payload: { slip_id: "proof-burn-slip", reason: "A decoy tool was touched" },
});
const receipt = appendJournalEvent(db, {
  userId: "owner",
  eventType: "receipt.created",
  payload: { slip_id: "proof-burn-slip", summary: "Listed one event; the calendar matches", verification: "matched" },
});
const checked = db.select().from(journal).all().length;
const verify = appendJournalEvent(db, {
  userId: "owner",
  eventType: "journal.verify",
  payload: { ok: true, checked },
});
console.log(`burn=seq ${burn.seq}; receipt=seq ${receipt.seq}; verify=seq ${verify.seq}; checked=${checked}`);
db.$client.close();
