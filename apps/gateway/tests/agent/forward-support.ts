import type { Client } from "@modelcontextprotocol/client";
import { z } from "zod";
import { callTool } from "./mcp-client.ts";

export const requestedSchema = z.object({ slipId: z.string() });

export const statusSchema = z.object({
  capability: z.string().nullable(),
  callsUsed: z.number(),
});

export const forwardedSchema = z.object({
  state: z.literal("forwarded"),
  slipId: z.string(),
  tool: z.string(),
  result: z.unknown(),
});

export const errorSchema = z.object({ error: z.string() });

export function call(
  client: Client,
  slipId: string,
  capability: string,
  tool: string,
  args: Record<string, unknown> = {},
) {
  return callTool(client, "errand_call", { slip_id: slipId, tool, capability, arguments: args });
}

export function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
