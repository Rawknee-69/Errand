import { Database } from "bun:sqlite";

const databasePath = process.argv[2] ?? "docs/proof/11-forwarder/proof.db";
const db = new Database(databasePath, { readonly: true });
const secrets = ["calendar-demo-token", "big-demo-token", "pay-demo-key"];

for (const secret of secrets) {
  const pattern = `%${secret}%`;
  const journal = db
    .query("select count(*) as n from journal where payload like ?")
    .get(pattern) as { n: number };
  const calls = db
    .query(
      "select count(*) as n from calls where result like ? or error like ? or arguments like ?",
    )
    .get(pattern, pattern, pattern) as { n: number };
  console.log(`${secret}: journal=${journal.n} calls=${calls.n}`);
}

const rows = db.query("select count(*) as n from journal").get() as { n: number };
console.log(`journal rows scanned: ${rows.n}`);
db.close();
