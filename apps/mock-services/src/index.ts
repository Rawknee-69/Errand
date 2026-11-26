import { DEFAULT_PORT, startMockServices } from "./server.ts";

const port = Number(process.env.PORT ?? DEFAULT_PORT);
const server = startMockServices({ port });

console.log(`mock services listening on ${server.url}`);
