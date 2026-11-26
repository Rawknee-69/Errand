import { Database } from "bun:sqlite";

const db = new Database("C:/Users/Rem/AppData/Local/Temp/opencode/errand-19-proof.db");
db.query("UPDATE journal SET payload = ? WHERE seq = 7").run(JSON.stringify({ tampered: true }));
const row = db.query("SELECT seq, payload FROM journal WHERE seq = 7").get();
console.log(row);
db.close();
