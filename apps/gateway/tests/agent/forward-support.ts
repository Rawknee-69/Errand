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

export async function requestAndApprove(
  client: Client,
  tools: string[],
  approve: (slipId: string) => Promise<void>,
): Promise<{ slipId: string; capability: string }> {
  const requested = await callTool(client, "request_errand", { goal: "forward test", tools });
  if (requested.result.isError === true) throw new Error("request_errand was refused");
  const slipId = requestedSchema.parse(requested.body).slipId;
  await approve(slipId);

  const status = await callTool(client, "errand_status", { slip_id: slipId });
  const capability = statusSchema.parse(status.body).capability;
  if (capability === null) throw new Error("approved slip has no capability");
  return { slipId, capability };
}
