import { openDatabase } from "../../src/db/client.ts";
import { reserveCall, type ReservationResult } from "../../src/policy/reservation.ts";

const [databasePath, slipId, attempts] = process.argv.slice(2);
if (databasePath === undefined || slipId === undefined || attempts === undefined) {
  throw new Error("usage: reserve-worker.ts <database> <slip> <attempts>");
}

const db = openDatabase(databasePath);
db.$client.exec("PRAGMA busy_timeout = 5000;");

function reserve(slip: string): ReservationResult {
  let lastError: unknown;
  for (let retry = 0; retry < 5; retry++) {
    try {
      return reserveCall(db, { userId: "user-a", slipId: slip, amountCents: 0, now: new Date() });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("reservation failed");
}

const results: ReservationResult[] = [];
for (let index = 0; index < Number(attempts); index++) {
  results.push(reserve(slipId));
}
db.$client.close();
console.log(JSON.stringify(results));
