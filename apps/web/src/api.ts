import { z } from "zod";
import {
  agentKeyCreatedSchema,
  connectorDetailSchema,
  errorResponseSchema,
  probeResultSchema,
  sessionViewSchema,
  type AgentKeyCreated,
  type ConnectorAuthInput,
  type ConnectorDetail,
  type ProbeResult,
  type SessionView,
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
  issueAgentKey(name: string): Promise<AgentKeyCreated> {
    return send(agentKeyCreatedSchema, "/api/agent-keys", "POST", { name });
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}
