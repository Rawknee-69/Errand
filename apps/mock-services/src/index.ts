type MockServicesOptions = {
  port?: number;
};

export function startMockServices(options: MockServicesOptions = {}) {
  return Bun.serve({
    port: options.port ?? 4001,
    fetch(request) {
      const { pathname } = new URL(request.url);

      if (pathname === "/health") {
        return Response.json({ service: "mock-services", status: "ok" });
      }

      return Response.json({ error: "not_found" }, { status: 404 });
    },
  });
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 4001);
  const server = startMockServices({ port });
  console.log(`mock services listening on ${server.url}`);
}
