import { z } from "zod";
import { authHintSchema } from "@errand/shared";
import { CONNECTOR_AUTH_STATUSES } from "../../src/db/schema.ts";

export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});

export const toolClassSchema = z.enum(["read", "write", "send", "delete", "spend", "unknown"]);
export const toolStateSchema = z.enum(["new", "active", "changed", "removed"]);

export const connectorSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  transport: z.string(),
  authType: z.string(),
  authStatus: z.enum(CONNECTOR_AUTH_STATUSES),
  lastAuthError: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const summarySchema = z.object({
  new: z.number(),
  changed: z.number(),
  removed: z.number(),
  unchanged: z.number(),
  total: z.number(),
});

export const catalogToolSchema = z.object({
  id: z.string(),
  connectorId: z.string(),
  name: z.string(),
  agentName: z.string(),
  description: z.string(),
  inputSchema: z.string(),
  annotations: z.string(),
  class: toolClassSchema,
  definitionHash: z.string(),
  observedDescription: z.string(),
  observedInputSchema: z.string(),
  observedAnnotations: z.string(),
  observedClass: toolClassSchema,
  observedHash: z.string(),
  state: toolStateSchema,
  requestable: z.boolean(),
  changedAt: z.string().nullable(),
  removedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const connectResponseSchema = z.object({
  connector: connectorSchema,
  transport: z.string(),
  summary: summarySchema,
  tools: z.array(catalogToolSchema),
});

export const oauthStartResponseSchema = z.object({
  connector: connectorSchema,
  authorizationUrl: z.string(),
  attemptId: z.string(),
});

export const catalogResponseSchema = z.object({
  tools: z.array(catalogToolSchema),
  connectors: z.array(connectorSchema),
});

export const approveResponseSchema = z.object({
  tool: catalogToolSchema,
});

export const reauthResponseSchema = z.object({
  connector: connectorSchema,
  authorizationUrl: z.string(),
});

export const probeResponseSchema = z.object({
  reachable: z.boolean(),
  transport: z.string().nullable(),
  requiresAuth: z.boolean(),
  authHint: authHintSchema.nullable(),
  toolCount: z.number(),
});

export async function readJson<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(await response.json());
}
