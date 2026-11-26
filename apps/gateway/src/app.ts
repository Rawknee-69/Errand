import type { GatewayHealth } from "@errand/shared";
import { Hono } from "hono";
import gatewayPackage from "../package.json" with { type: "json" };
import { createMigratedDatabase, type Db } from "./db/client.ts";
import { verifyJournal } from "./db/journal.ts";

export function createGatewayApp(db: Db = createMigratedDatabase(":memory:")): Hono {
  const app = new Hono();

  app.get("/health", (c) => {
    const health: GatewayHealth = {
      service: "gateway",
      status: "ok",
      version: gatewayPackage.version,
    };
    return c.json(health);
  });

  app.get("/api/journal/verify", (c) => c.json(verifyJournal(db)));

  return app;
}
