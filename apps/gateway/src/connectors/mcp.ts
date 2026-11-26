import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  type Tool,
  type Transport,
} from "@modelcontextprotocol/client";
import type { McpTransportKind } from "@errand/shared";
import { DEFAULT_TIMEOUT_MS, EgressRefusal, egressRequest, type EgressOptions } from "../egress/guard.ts";
import { authHeaders, type ConnectorAuth } from "./auth.ts";
import type { DiscoveredTool } from "./catalog.ts";
import type { ToolAnnotations } from "./classifier.ts";

export type McpConnection = {
  transport: McpTransportKind;
  server: { name: string; version: string };
  tools: DiscoveredTool[];
};

export type DiscoverOptions = EgressOptions & {
  timeoutMs?: number;
};

export type McpConnectErrorCode = "auth" | "egress" | "connect";

export class McpConnectError extends Error {
  constructor(
    readonly code: McpConnectErrorCode,
    message: string,
    readonly challenge?: string,
  ) {
    super(message);
    this.name = "McpConnectError";
  }
}

function annotationsOf(tool: Tool): ToolAnnotations | undefined {
  const annotations = tool.annotations;
  if (annotations === undefined) return undefined;
  return {
    ...(annotations.title === undefined ? {} : { title: annotations.title }),
    ...(annotations.readOnlyHint === undefined ? {} : { readOnlyHint: annotations.readOnlyHint }),
    ...(annotations.destructiveHint === undefined
      ? {}
      : { destructiveHint: annotations.destructiveHint }),
    ...(annotations.idempotentHint === undefined
      ? {}
      : { idempotentHint: annotations.idempotentHint }),
    ...(annotations.openWorldHint === undefined
      ? {}
      : { openWorldHint: annotations.openWorldHint }),
  };
}

function definitionOf(tool: Tool): DiscoveredTool {
  return {
    name: tool.name,
    ...(tool.description === undefined ? {} : { description: tool.description }),
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema === undefined ? {} : { outputSchema: tool.outputSchema }),
    ...(annotationsOf(tool) === undefined ? {} : { annotations: annotationsOf(tool) }),
  };
}

type Attempt = {
  connection: McpConnection;
  client: Client;
};

export type McpTransportSetup = {
  transport: Transport;
  client: Client;
};

// Discovery and forwarding share one transport builder so the egress guard,
// auth headers and redirect policy cannot drift between the two paths.
export function createMcpTransport(
  kind: McpTransportKind,
  url: string,
  auth: ConnectorAuth,
  options: DiscoverOptions,
  onResponse?: (response: Response) => void,
): McpTransportSetup {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers = authHeaders(auth);
  const guardedFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const target = input instanceof Request ? input.url : input;
    const requestInit = input instanceof Request ? { ...init, method: init?.method ?? input.method } : init;
    return egressRequest(target, requestInit ?? {}, { ...options, timeoutMs }).then((response) => {
      onResponse?.(response);
      return response;
    });
  };

  const endpoint = new URL(url);
  const transport: Transport =
    kind === "streamable-http"
      ? new StreamableHTTPClientTransport(endpoint, {
          fetch: guardedFetch,
          requestInit: { headers },
          redirectPolicy: "follow",
        })
      : new SSEClientTransport(endpoint, {
          fetch: guardedFetch,
          requestInit: { headers },
          redirectPolicy: "follow",
        });

  return {
    transport,
    client: new Client({ name: "errand-gateway", version: "0.1.0" }),
  };
}

async function connectOnce(
  kind: McpTransportKind,
  url: string,
  auth: ConnectorAuth,
  options: DiscoverOptions,
  statuses: number[],
  challenges: string[],
): Promise<Attempt> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { client, transport } = createMcpTransport(kind, url, auth, options, (response) => {
    statuses.push(response.status);
    const challenge = response.headers.get("www-authenticate");
    if (challenge !== null && (response.status === 401 || response.status === 403)) {
      challenges.push(challenge);
    }
  });

  const endpoint = new URL(url);
  try {
    await client.connect(transport, { timeout: timeoutMs });
    const listed = await client.listTools(undefined, { timeout: timeoutMs });
    const version = client.getServerVersion();
    return {
      connection: {
        transport: kind,
        server: { name: version?.name ?? endpoint.hostname, version: version?.version ?? "unknown" },
        tools: listed.tools.map(definitionOf),
      },
      client,
    };
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

// Streamable HTTP first, legacy SSE second. Both attempts go through the
// egress guard, so a pasted URL cannot reach an internal address.
export async function discoverMcpTools(
  url: string,
  auth: ConnectorAuth,
  options: DiscoverOptions = {},
): Promise<McpConnection> {
  const statuses: number[] = [];
  const challenges: string[] = [];
  const failures: string[] = [];

  for (const kind of ["streamable-http", "sse"] as const) {
    try {
      const attempt = await connectOnce(kind, url, auth, options, statuses, challenges);
      await attempt.client.close().catch(() => undefined);
      return attempt.connection;
    } catch (error) {
      if (error instanceof EgressRefusal) {
        throw new McpConnectError("egress", `${error.code}: ${error.message}`);
      }
      failures.push(`${kind}: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof McpConnectError) throw error;
    }
  }

  if (statuses.some((status) => status === 401 || status === 403)) {
    const challenge = challenges.at(0);
    if (challenge !== undefined) {
      throw new McpConnectError(
        "auth",
        `The server rejected the supplied credentials (${url})`,
        challenge,
      );
    }
    throw new McpConnectError("auth", `The server rejected the supplied credentials (${url})`);
  }
  throw new McpConnectError("connect", `Could not connect to ${url} — ${failures.join("; ")}`);
}
