import { createGatewayApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig(process.env);
const server = Bun.serve({ port: config.PORT, fetch: createGatewayApp().fetch });

console.log(`gateway listening on ${server.url}`);
