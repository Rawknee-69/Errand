import { createMcpHandler, McpServer, type CallToolResult, type McpHttpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import gatewayPackage from "../../package.json" with { type: "json" };
import type { Db } from "../db/client.ts";
import { agentCatalog } from "./catalog.ts";
import { submitCall } from "./call.ts";
import type { Forwarder } from "./forward.ts";
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

function agentServer(
  db: Db,
  userId: string,
  hmacKey: string | undefined,
  forwarder: Forwarder | undefined,
): McpServer {
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
        "Read a slip's state, remaining caps, expiry and, once approved, its capability. Poll this after requesting; nothing runs until it is approved.",
      inputSchema: z.object({ slip_id: z.string().min(1) }),
      annotations: { readOnlyHint: true },
    },
    async ({ slip_id }) => {
      const status = errandStatus(db, userId, slip_id, { hmacKey });
      if (status === undefined) return errorResult("not_found", `No slip ${slip_id} for this key`);
      return textResult(status);
    },
  );

  server.registerTool(
    "errand_call",
    {
      description:
        "Submit one call for an approved slip, with the capability from errand_status. The call is checked against the signed slip and the spend, call and rate caps, then forwarded for read, write and delete classes.",
      inputSchema: z.object({
        slip_id: z.string().min(1),
        tool: z.string().min(1),
        capability: z.string().min(1),
        arguments: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: { readOnlyHint: false },
    },
    async ({ slip_id, tool, capability, arguments: args }) => {
      const decision = submitCall(
        db,
        userId,
        { slipId: slip_id, tool, capability, arguments: args ?? {} },
        { hmacKey },
      );
      if (decision.outcome === "denied") {
        return errorResult(decision.reason, decision.message, { tool });
      }
      const remaining = {
        calls: decision.callsRemaining,
        spendCents: decision.spendRemainingCents,
      };
      if (forwarder === undefined) {
        return textResult({
          state: "not_forwarded",
          slipId: decision.slipId,
          tool: decision.tool,
          reason: "forwarder_not_installed",
          remaining,
        });
      }

      const outcome = await forwarder(userId, decision, args ?? {});
      if (outcome.state === "failed") {
        return errorResult(outcome.error, outcome.message, {
          slipId: decision.slipId,
          tool: decision.tool,
        });
      }
      if (outcome.state === "not_forwarded") {
        return textResult({
          state: "not_forwarded",
          slipId: decision.slipId,
          tool: decision.tool,
          reason: outcome.reason,
          remaining,
        });
      }
      return textResult({
        state: "forwarded",
        slipId: decision.slipId,
        tool: decision.tool,
        class: decision.class,
        result: outcome.result,
        durationMs: outcome.durationMs,
        remaining,
      });
    },
  );

  return server;
}

export function createAgentHandler(
  db: Db,
  hmacKey: string | undefined,
  forwarder?: Forwarder,
): McpHttpHandler {
  return createMcpHandler((context) => {
    const userId = context.authInfo?.clientId;
    if (userId === undefined) {
      throw new Error("Agent request reached the MCP handler without authentication");
    }
    return agentServer(db, userId, hmacKey, forwarder);
  });
}
