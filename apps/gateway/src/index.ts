import { createGatewayApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { createMigratedDatabase } from "./db/client.ts";

const config = loadConfig(process.env);
const db = createMigratedDatabase(config.DATABASE_PATH);
const server = Bun.serve({ port: config.PORT, fetch: createGatewayApp(db).fetch });

console.log(`gateway listening on ${server.url}`);
