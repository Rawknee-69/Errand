import type { GatewayHealth } from "@errand/shared";
import { Hono } from "hono";
import gatewayPackage from "../package.json" with { type: "json" };

export function createGatewayApp(): Hono {
  const app = new Hono();

  app.get("/health", (c) => {
    const health: GatewayHealth = {
      service: "gateway",
      status: "ok",
      version: gatewayPackage.version,
    };
    return c.json(health);
  });

  return app;
}
