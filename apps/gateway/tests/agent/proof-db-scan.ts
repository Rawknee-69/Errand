import { Database } from "bun:sqlite";
import { z } from "zod";

const path = process.argv[2] ?? "docs/proof/08-agent-keys-catalog/proof.db";
const db = new Database(path, { readonly: true });

const agentKeyRows = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    key_hash: z.string(),
    created_at: z.string(),
    revoked_at: z.string().nullable(),
  }),
);
const nameRows = z.array(z.object({ name: z.string() }));

const keys = agentKeyRows.parse(
  db.query("SELECT id, name, key_hash, created_at, revoked_at FROM agent_keys").all(),
);
console.log("agent_keys rows (there is no plaintext key column):");
for (const key of keys) {
  console.log(
    `  ${key.id} name=${key.name} key_hash=${key.key_hash.length} hex chars (prefix ${key.key_hash.slice(0, 12)}) created=${key.created_at} revoked=${key.revoked_at ?? "no"}`,
  );
}

const tables = nameRows.parse(
  db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all(),
);
let leaks = 0;
for (const table of tables) {
  const columns = nameRows.parse(db.query(`PRAGMA table_info(${table.name})`).all());
  for (const column of columns) {
    const rows = z
      .array(z.object({ value: z.string() }))
      .parse(
        db
          .query(`SELECT ${column.name} AS value FROM ${table.name} WHERE typeof(${column.name}) = 'text'`)
          .all(),
      );
    for (const row of rows) {
      if (/errand_[A-Za-z0-9_-]{43}/.test(row.value)) {
        leaks++;
        console.log(`  PLAINTEXT KEY FOUND in ${table.name}.${column.name}`);
      }
    }
  }
}
console.log(`full key pattern occurrences across every text column: ${leaks}`);
db.close();
