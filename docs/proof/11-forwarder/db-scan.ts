import { Database } from "bun:sqlite";

// Matching values of MOCK_AUTH in apps/mock-services; this script runs outside
// a workspace, so it cannot import the mock server's dependency graph.
const secrets = ["calendar-demo-token", "big-demo-token", "pay-demo-key"];

function count(row: unknown): number {
  if (row === null || typeof row !== "object") throw new Error("expected a database row");
  const value: unknown = Reflect.get(row, "n");
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error("expected a non-negative count");
  }
  return value;
}

const databasePath = process.argv[2] ?? "docs/proof/11-forwarder/proof.db";
const db = new Database(databasePath, { readonly: true });

for (const secret of secrets) {
  const pattern = `%${secret}%`;
  const journal = count(
    db.query("select count(*) as n from journal where payload like ?").get(pattern),
  );
  const calls = count(
    db
      .query(
        "select count(*) as n from calls where result like ? or error like ? or arguments like ?",
      )
      .get(pattern, pattern, pattern),
  );
  console.log(`${secret}: journal=${journal} calls=${calls}`);
}

console.log(`journal rows scanned: ${count(db.query("select count(*) as n from journal").get())}`);
db.close();
