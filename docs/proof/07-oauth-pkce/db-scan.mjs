// Reads the proof database directly: the verifier column is gone, and every
// OAuth secret is ciphertext, never a token or verifier in a clear column.
import { Database } from "bun:sqlite";

const path = process.env.DB;
if (!path) throw new Error("set DB to the proof database path");

const db = new Database(path, { readonly: true });
const tables = db
  .query("select name from sqlite_master where type = 'table' order by name")
  .all()
  .map((row) => row.name);

console.log(`database: ${path}`);
console.log(`tables: ${tables.join(", ")}`);

const attemptColumns = db.query("pragma table_info(oauth_attempts)").all();
console.log("\noauth_attempts columns:");
for (const column of attemptColumns) console.log(`  ${column.name} ${column.type}`);
if (attemptColumns.some((column) => column.name === "code_verifier")) {
  throw new Error("oauth_attempts still has a plaintext code_verifier column");
}

const connectorColumns = db.query("pragma table_info(connectors)").all().map((column) => column.name);
console.log(`\nconnectors auth columns: ${connectorColumns.filter((name) => name.startsWith("auth")).join(", ")}`);

const credentialRows = db
  .query("select kind, count(*) as count from credentials group by kind order by kind")
  .all();
console.log("\ncredential rows by kind:");
for (const row of credentialRows) console.log(`  ${row.kind}: ${row.count}`);

const rows = db.query("select service_id, kind, ciphertext, nonce, auth_tag, wrapped_data_key from credentials").all();
const markers = ["access_token", "refresh_token", "codeVerifier", "code_verifier", "client_secret"];
let findings = 0;
for (const row of rows) {
  for (const marker of markers) {
    if (row.ciphertext.includes(marker)) {
      findings += 1;
      console.log(`  LEAK: ${row.kind}/${row.service_id} ciphertext contains ${marker}`);
    }
  }
  if (row.ciphertext.length === 0 || row.nonce.length === 0 || row.auth_tag.length === 0) {
    findings += 1;
    console.log(`  LEAK: ${row.kind}/${row.service_id} is missing sealed columns`);
  }
}
console.log(`\nplaintext secret markers in ciphertext: ${findings}`);
if (findings > 0) throw new Error("credential scan failed");

const attempts = db.query("select id, connector_id, length(state) as state_length, redirect_uri, created_at, expires_at, consumed_at from oauth_attempts").all();
console.log("\noauth attempts:");
for (const attempt of attempts) {
  const ttl = Date.parse(attempt.expires_at) - Date.parse(attempt.created_at);
  console.log(
    `  state ${attempt.state_length} chars, ttl ${ttl} ms, consumed ${attempt.consumed_at === null ? "no" : "yes"}, redirect ${attempt.redirect_uri}`,
  );
}

const events = db
  .query("select event_type, count(*) as count from journal group by event_type order by event_type")
  .all();
console.log("\njournal events:");
for (const event of events) console.log(`  ${event.event_type}: ${event.count}`);
