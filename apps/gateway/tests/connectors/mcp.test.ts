import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MOCK_AUTH, MOCK_PATHS, startMockServices } from "@errand/mock-services";
import { discoverMcpTools, McpConnectError } from "../../src/connectors/mcp.ts";

let server: ReturnType<typeof startMockServices>;
const dev = { allowLocalhostDev: true, timeoutMs: 5_000 };

function url(path: string): string {
  return `http://127.0.0.1:${server.port}${path}`;
}

function connectError(value: unknown): McpConnectError {
  if (!(value instanceof McpConnectError)) {
    throw new Error(`Expected McpConnectError, got ${String(value)}`);
  }
  return value;
}

beforeAll(() => {
  server = startMockServices({ port: 0 });
});

afterAll(() => {
  server.stop(true);
});

describe("discoverMcpTools", () => {
  test("connects to a streamable-http server with no auth and lists annotated tools", async () => {
    const connection = await discoverMcpTools(url(MOCK_PATHS.calendar), { type: "none" }, dev);

    expect(connection.transport).toBe("streamable-http");
    expect(connection.server.name).toBe("calendar");
    const names = connection.tools.map((tool) => tool.name);
    expect(names).toContain("list_events");
    expect(names).toContain("delete_event");
    const deleteEvent = connection.tools.find((tool) => tool.name === "delete_event");
    expect(deleteEvent?.annotations?.destructiveHint).toBe(true);
  });

  test("connects with a bearer token and refuses a wrong one", async () => {
    const wrong = await discoverMcpTools(
      url(MOCK_PATHS.calendarSecure),
      { type: "bearer", token: "wrong-token" },
      dev,
    ).catch((error: unknown) => error);

    expect(wrong).toBeInstanceOf(McpConnectError);
    expect(connectError(wrong).code).toBe("auth");
    expect(connectError(wrong).challenge).toContain("Bearer");

    const connection = await discoverMcpTools(
      url(MOCK_PATHS.calendarSecure),
      { type: "bearer", token: MOCK_AUTH.calendarBearer },
      dev,
    );
    expect(connection.server.name).toBe("calendar");
  });

  test("connects with a custom header and refuses a wrong one", async () => {
    const connection = await discoverMcpTools(
      url(MOCK_PATHS.pay),
      {
        type: "header",
        headerName: MOCK_AUTH.payHeaderName,
        value: MOCK_AUTH.payHeaderValue,
      },
      dev,
    );
    expect(connection.server.name).toBe("pay");
    expect(connection.tools.map((tool) => tool.name)).toContain("charge_card");

    const wrong = await discoverMcpTools(
      url(MOCK_PATHS.pay),
      { type: "header", headerName: MOCK_AUTH.payHeaderName, value: "nope" },
      dev,
    ).catch((error: unknown) => error);
    expect(connectError(wrong).code).toBe("auth");
  });

  test("falls back to legacy SSE when streamable HTTP is not served", async () => {
    const connection = await discoverMcpTools(
      url(MOCK_PATHS.dineOutSse),
      {
        type: "basic",
        username: MOCK_AUTH.dineOutUser,
        password: MOCK_AUTH.dineOutPassword,
      },
      dev,
    );

    expect(connection.transport).toBe("sse");
    expect(connection.server.name).toBe("dine-out");
    expect(connection.tools.map((tool) => tool.name)).toContain("search_restaurants");
  });

  test("reports an auth failure when legacy SSE credentials are wrong", async () => {
    const error = await discoverMcpTools(
      url(MOCK_PATHS.dineOutSse),
      { type: "basic", username: MOCK_AUTH.dineOutUser, password: "wrong" },
      dev,
    ).catch((caught: unknown) => caught);

    expect(connectError(error).code).toBe("auth");
  });

  test("routes the connection through the egress guard", async () => {
    const error = await discoverMcpTools(
      url(MOCK_PATHS.calendar),
      { type: "none" },
      { allowLocalhostDev: false, timeoutMs: 1_000 },
    ).catch((caught: unknown) => caught);

    expect(connectError(error).code).toBe("egress");
  });
});
