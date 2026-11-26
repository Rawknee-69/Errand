import { slipToolSchema, type SlipTool } from "@errand/shared";
import { z } from "zod";

export type { SlipTool } from "@errand/shared";

const slipToolsSchema = z.array(slipToolSchema);

export function parseSlipTools(raw: string): SlipTool[] {
  return slipToolsSchema.parse(JSON.parse(raw));
}
