import { z } from "zod";

const slipToolSchema = z.object({
  name: z.string(),
  connectorId: z.string(),
  class: z.enum(["read", "write", "send", "delete", "spend", "unknown"]),
});

const slipToolsSchema = z.array(slipToolSchema);

export type SlipTool = z.infer<typeof slipToolSchema>;

export function parseSlipTools(raw: string): SlipTool[] {
  return slipToolsSchema.parse(JSON.parse(raw));
}
