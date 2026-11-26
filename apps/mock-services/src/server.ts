import type { MockServicesHealth } from "@errand/shared";

export const DEFAULT_PORT = 4001;

type MockServicesOptions = {
  port?: number;
};

export function startMockServices(options: MockServicesOptions = {}) {
  return Bun.serve({
    port: options.port ?? DEFAULT_PORT,
    fetch(request) {
      const { pathname } = new URL(request.url);

      if (pathname === "/health") {
        const health: MockServicesHealth = { service: "mock-services", status: "ok" };
        return Response.json(health);
      }

      return Response.json({ error: "not_found" }, { status: 404 });
    },
  });
}
