import { createMcpHandler, McpServer, type CallToolResult, type McpHttpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import gatewayPackage from "../../package.json" with { type: "json" };
import type { Db } from "../db/client.ts";
import { agentCatalog } from "./catalog.ts";
import { callErrand } from "./call.ts";
import { AGENT_LIMITS, type RequestedLimits } from "./limits.ts";
import { ErrandRequestError, requestErrand } from "./request.ts";
import { errandStatus } from "./status.ts";

export const AGENT_PATH = "/mcp";

const limitsInput = z
  .object({
    calls: z.number().int().positive().optional(),
    spend_cents: z.number().int().nonnegative().optional(),
    minutes: z.number().int().positive().optional(),
  })
  .strict();

const requestInput = z
  .object({
    goal: z.string().min(1).max(500),
    tools: z
      .array(z.string().min(1))
      .min(1)
      .max(AGENT_LIMITS.tools)
      .refine((tools) => new Set(tools).size === tools.length, { message: "tools must be unique" }),
    limits: limitsInput.optional(),
  })
  .strict();

function textResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function errorResult(error: string, message: string, extra: Record<string, unknown> = {}): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error, message, ...extra }) }],
    isError: true,
  };
}

function toRequestedLimits(limits: z.infer<typeof limitsInput> | undefined): RequestedLimits | undefined {
  if (limits === undefined) return undefined;
  return {
    ...(limits.calls === undefined ? {} : { calls: limits.calls }),
    ...(limits.spend_cents === undefined ? {} : { spendCents: limits.spend_cents }),
    ...(limits.minutes === undefined ? {} : { minutes: limits.minutes }),
  };
}

function agentServer(db: Db, userId: string): McpServer {
  const server = new McpServer({ name: "errand", version: gatewayPackage.version });

  server.registerTool(
    "errand_catalog",
    {
      description:
        "List the tools you may request right now. Only requestable tools appear, with Errand labels; blocked tools and decoys never do.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => textResult({ tools: agentCatalog(db, userId), limits: AGENT_LIMITS }),
  );

  server.registerTool(
    "request_errand",
    {
      description:
        "Request a scoped errand with a goal, tool names from errand_catalog and optional limits. Returns a pending slip immediately; a human approves it later.",
      inputSchema: requestInput,
      annotations: { readOnlyHint: false },
    },
    async (input) => {
      try {
        const limits = toRequestedLimits(input.limits);
        return textResult(
          requestErrand(
            db,
            userId,
            limits === undefined
              ? { goal: input.goal, tools: input.tools }
              : { goal: input.goal, tools: input.tools, limits },
          ),
        );
      } catch (error) {
        if (error instanceof ErrandRequestError) {
          return errorResult(
            error.code,
            error.message,
            error.tool === undefined ? {} : { tool: error.tool },
          );
        }
        throw error;
      }
    },
  );

  server.registerTool(
    "errand_status",
    {
      description:
        "Read a slip's state, remaining caps and expiry. Poll this after requesting; nothing runs until it is approved.",
      inputSchema: z.object({ slip_id: z.string().min(1) }),
      annotations: { readOnlyHint: true },
    },
    async ({ slip_id }) => {
      const status = errandStatus(db, userId, slip_id);
      if (status === undefined) return errorResult("not_found", `No slip ${slip_id} for this key`);
      return textResult(status);
    },
  );

  server.registerTool(
    "errand_call",
    {
      description:
        "Make one call through an approved slip. Calls are checked against the slip before anything reaches a service.",
      inputSchema: z.object({
        slip_id: z.string().min(1),
        tool: z.string().min(1),
        arguments: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ slip_id, tool }) => {
      const result = callErrand(db, userId, slip_id, tool);
      if (result === undefined) return errorResult("not_found", `No slip ${slip_id} for this key`);
      return textResult(result);
    },
  );

  return server;
}

export function createAgentHandler(db: Db): McpHttpHandler {
  return createMcpHandler((context) => {
    const userId = context.authInfo?.clientId;
    if (userId === undefined) {
      throw new Error("Agent request reached the MCP handler without authentication");
    }
    return agentServer(db, userId);
  });
}
