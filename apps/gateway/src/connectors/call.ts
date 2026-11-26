import {
  Client,
  SSEClientTransport,
  SdkError,
  SdkErrorCode,
  StreamableHTTPClientTransport,
  type Transport,
} from "@modelcontextprotocol/client";
import { z } from "zod";
import type { McpTransportKind } from "@errand/shared";
import type { ConnectorAuthType } from "../db/schema.ts";
import { EgressRefusal, egressRequest } from "../egress/guard.ts";
import { authHeaders, authSecrets, parseCredential, redactAuthSecrets, redactText, type ConnectorAuth } from "./auth.ts";
import type { DiscoverOptions } from "./mcp.ts";
import { refreshOAuthAccessToken, type OAuthServiceDeps } from "./oauth/service.ts";

export const DEFAULT_CALL_TIMEOUT_MS = 15_000;
export const DEFAULT_CONNECTOR_CONCURRENCY = 2;
export const DEFAULT_RESULT_CAP_BYTES = 256 * 1024;

export type ConnectorCallTarget = {
  id: string;
  url: string;
  transport: McpTransportKind;
  authType: ConnectorAuthType;
};

export type ConnectorCallOptions = {
  timeoutMs?: number;
  resultCapBytes?: number;
};

export type ConnectorToolResult = {
  content: unknown[];
  structuredContent?: unknown;
  isError: boolean;
  truncated: boolean;
  originalBytes: number;
};

export type ConnectorCallFailure = "auth" | "credential" | "timeout" | "egress" | "upstream";

export class ConnectorCallError extends Error {
  constructor(
    readonly code: ConnectorCallFailure,
    message: string,
  ) {
    super(message);
    this.name = "ConnectorCallError";
  }
}

const rawResultSchema = z.object({
  content: z.array(z.unknown()),
  structuredContent: z.unknown().optional(),
  isError: z.boolean().optional(),
});

type RawResult = z.infer<typeof rawResultSchema>;

async function withConnectorAuth<T>(
  deps: OAuthServiceDeps,
  connectorId: string,
  authType: ConnectorAuthType,
  fn: (auth: ConnectorAuth) => Promise<T>,
): Promise<T> {
  if (authType === "none") return fn({ type: "none" });
  if (authType === "oauth") {
    const accessToken = await refreshOAuthAccessToken(deps, connectorId);
    return fn({ type: "oauth", accessToken });
  }
  // The vault callback is the only place the stored secret exists; the call
  // runs inside it and the result leaves already redacted.
  return deps.vault.withCredential(connectorId, (secret) => fn(parseCredential(authType, secret)));
}

function truncateUtf8(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.byteLength <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && ((buffer[end] ?? 0) & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end).toString("utf8");
}

function boundedResult(raw: RawResult, capBytes: number): ConnectorToolResult {
  const base = {
    content: raw.content,
    isError: raw.isError ?? false,
    ...(raw.structuredContent === undefined ? {} : { structuredContent: raw.structuredContent }),
  };
  const serialized = JSON.stringify(base);
  const originalBytes = Buffer.byteLength(serialized, "utf8");
  if (originalBytes <= capBytes) return { ...base, truncated: false, originalBytes };

  const marker = "\n…[result truncated]";
  let previewBytes = Math.max(0, capBytes - Buffer.byteLength(marker, "utf8") - 256);
  for (;;) {
    const body: ConnectorToolResult = {
      content: [{ type: "text", text: `${truncateUtf8(serialized, previewBytes)}${marker}` }],
      isError: base.isError,
      truncated: true,
      originalBytes,
    };
    if (Buffer.byteLength(JSON.stringify(body), "utf8") <= capBytes || previewBytes === 0) return body;
    previewBytes = Math.floor(previewBytes * 0.9);
  }
}

function isTimeout(error: unknown): boolean {
  if (error instanceof SdkError) return error.code === SdkErrorCode.RequestTimeout;
  return error instanceof DOMException && error.name === "AbortError";
}

function isAuthFailure(error: unknown): boolean {
  if (!(error instanceof SdkError)) return false;
  return (
    error.code === SdkErrorCode.ClientHttpAuthentication ||
    error.code === SdkErrorCode.ClientHttpForbidden
  );
}

function failureFor(error: unknown, tool: string, timeoutMs: number): ConnectorCallError {
  if (error instanceof ConnectorCallError) return error;
  if (error instanceof EgressRefusal) {
    const code = error.code === "timeout" ? "timeout" : "egress";
    const message =
      code === "timeout"
        ? `The upstream call to ${tool} timed out after ${timeoutMs}ms`
        : `The upstream call to ${tool} was refused: ${error.message}`;
    return new ConnectorCallError(code, message);
  }
  if (isTimeout(error)) {
    return new ConnectorCallError(
      "timeout",
      `The upstream call to ${tool} timed out after ${timeoutMs}ms`,
    );
  }
  if (isAuthFailure(error)) {
    return new ConnectorCallError("auth", `The upstream rejected the stored credential for ${tool}`);
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new ConnectorCallError("upstream", `The upstream call to ${tool} failed: ${detail.slice(0, 300)}`);
}

async function invoke(
  auth: ConnectorAuth,
  connector: ConnectorCallTarget,
  tool: string,
  args: Record<string, unknown>,
  discoverOptions: DiscoverOptions,
  timeoutMs: number,
): Promise<unknown> {
  const endpoint = new URL(connector.url);
  const headers = authHeaders(auth);
  const guardedFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const target = input instanceof Request ? input.url : input;
    const requestInit = input instanceof Request ? { ...init, method: init?.method ?? input.method } : init;
    return egressRequest(target, requestInit ?? {}, { ...discoverOptions, timeoutMs });
  };
  const transport: Transport =
    connector.transport === "streamable-http"
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

  const client = new Client({ name: "errand-gateway", version: "0.1.0" });
  const deadline = Date.now() + timeoutMs;
  const remaining = (): number => Math.max(1, deadline - Date.now());
  try {
    await client.connect(transport, { timeout: remaining() });
    const result = await client.callTool({ name: tool, arguments: args }, { timeout: remaining() });
    const raw: unknown = JSON.parse(JSON.stringify(result));
    return raw;
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function callConnectorTool(
  deps: OAuthServiceDeps,
  connector: ConnectorCallTarget,
  tool: string,
  args: Record<string, unknown>,
  options: ConnectorCallOptions = {},
): Promise<ConnectorToolResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const capBytes = options.resultCapBytes ?? DEFAULT_RESULT_CAP_BYTES;

  return withConnectorAuth(deps, connector.id, connector.authType, async (auth) => {
    const secrets = authSecrets(auth);
    try {
      const raw = await invoke(auth, connector, tool, args, deps.discoverOptions, timeoutMs);
      const redacted = redactAuthSecrets(raw, auth);
      const parsed = rawResultSchema.safeParse(redacted);
      if (!parsed.success) {
        throw new ConnectorCallError("upstream", `The upstream returned an unreadable result for ${tool}`);
      }
      return boundedResult(parsed.data, capBytes);
    } catch (error) {
      const failure = failureFor(error, tool, timeoutMs);
      throw new ConnectorCallError(failure.code, redactText(failure.message, secrets));
    }
  });
}
