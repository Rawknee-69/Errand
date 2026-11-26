import { z } from "zod";
import {
  agentKeyCreatedSchema,
  catalogResponseSchema,
  catalogToolResponseSchema,
  connectorDetailSchema,
  connectorReauthResponseSchema,
  errorResponseSchema,
  oauthStartResponseSchema,
  probeResultSchema,
  sessionViewSchema,
  slipApprovedSchema,
  slipDetailSchema,
  slipListResponseSchema,
  type AgentKeyCreated,
  type CatalogResponse,
  type CatalogToolResponse,
  type ConnectorAuthInput,
  type ConnectorDetail,
  type ConnectorReauthResponse,
  type OAuthStartResponse,
  type ProbeResult,
  type SessionView,
  type SlipApprovalInput,
  type SlipApproved,
  type SlipDetail,
  type SlipListResponse,
  type ToolClass,
} from "@errand/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const EVENTS_PATH = "/api/events";

async function send<T>(
  schema: z.ZodType<T>,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = errorResponseSchema.safeParse(payload);
    throw new ApiError(
      response.status,
      error.success ? error.data.error : "request_failed",
      error.success ? (error.data.message ?? error.data.error) : "The gateway did not answer",
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(response.status, "bad_response", "The gateway sent an unexpected response");
  }
  return parsed.data;
}

export const api = {
  session(): Promise<SessionView> {
    return send(sessionViewSchema, "/api/auth/session", "GET");
  },
  login(passphrase: string): Promise<SessionView> {
    return send(sessionViewSchema, "/api/auth/login", "POST", { passphrase });
  },
  demoLogin(name: string): Promise<SessionView> {
    return send(sessionViewSchema, "/api/auth/login", "POST", { demoUser: name });
  },
  logout(): Promise<unknown> {
    return send(z.unknown(), "/api/auth/logout", "POST");
  },
  probe(url: string): Promise<ProbeResult> {
    return send(probeResultSchema, "/api/connectors/probe", "POST", { url });
  },
  connect(input: ConnectorAuthInput): Promise<ConnectorDetail> {
    return send(connectorDetailSchema, "/api/connectors", "POST", input);
  },
  catalog(): Promise<CatalogResponse> {
    return send(catalogResponseSchema, "/api/catalog", "GET");
  },
  refreshConnector(id: string): Promise<ConnectorDetail> {
    return send(connectorDetailSchema, `/api/connectors/${id}/refresh`, "POST", {});
  },
  reauthConnector(id: string): Promise<ConnectorReauthResponse> {
    return send(connectorReauthResponseSchema, `/api/connectors/${id}/reauth`, "POST", {});
  },
  approveTool(id: string): Promise<CatalogToolResponse> {
    return send(catalogToolResponseSchema, `/api/catalog/${id}/approve`, "POST", {});
  },
  setToolClass(id: string, toolClass: ToolClass, confirm: boolean): Promise<CatalogToolResponse> {
    return send(catalogToolResponseSchema, `/api/catalog/${id}/class`, "POST", {
      class: toolClass,
      confirm,
    });
  },
  setToolRequestable(id: string, requestable: boolean): Promise<CatalogToolResponse> {
    return send(catalogToolResponseSchema, `/api/catalog/${id}/requestable`, "POST", {
      requestable,
    });
  },
  startOAuth(name: string, url: string): Promise<OAuthStartResponse> {
    return send(oauthStartResponseSchema, "/api/connectors/oauth/start", "POST", { name, url });
  },
  issueAgentKey(name: string): Promise<AgentKeyCreated> {
    return send(agentKeyCreatedSchema, "/api/agent-keys", "POST", { name });
  },
  slips(): Promise<SlipListResponse> {
    return send(slipListResponseSchema, "/api/slips", "GET");
  },
  slip(id: string): Promise<SlipDetail> {
    return send(slipDetailSchema, `/api/slips/${encodeURIComponent(id)}`, "GET");
  },
  approveSlip(id: string, input: SlipApprovalInput): Promise<SlipApproved> {
    return send(slipApprovedSchema, `/api/slips/${encodeURIComponent(id)}/approve`, "POST", input);
  },
  denySlip(id: string, reason?: string): Promise<SlipDetail> {
    return send(
      slipDetailSchema,
      `/api/slips/${encodeURIComponent(id)}/deny`,
      "POST",
      reason === undefined ? {} : { reason },
    );
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}
