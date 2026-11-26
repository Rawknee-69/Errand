import { createHash } from "node:crypto";
import { canonicalJson } from "../db/journal.ts";
import type { ToolAnnotations } from "./classifier.ts";

const MAX_AGENT_NAME = 64;
export const MAX_DESCRIPTION = 500;

const formattingCharacters = /[\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g;
const controlCharacters = /[\u0000-\u001F\u007F]/g;

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(formattingCharacters, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// The agent sees `connector__tool`, so two upstreams cannot present the same
// name to it and every name fits the tool-name grammar.
export function sanitiseAgentName(connectorName: string, toolName: string): string {
  const service = slug(connectorName) || "service";
  const tool = slug(toolName) || "tool";
  return `${service}__${tool}`.slice(0, MAX_AGENT_NAME).replace(/_+$/, "");
}

// Upstream descriptions are untrusted text: markup, control characters and
// bidi overrides are removed, whitespace is collapsed, and the result is cut
// to a size that cannot bury the human in instructions.
export function sanitiseDescription(raw: string, max = MAX_DESCRIPTION): string {
  const cleaned = raw
    .replace(/<[^>]*>/g, " ")
    .replace(formattingCharacters, "")
    .replace(controlCharacters, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, Math.max(0, max - 1))}…`;
}

export type ToolDefinition = {
  name: string;
  description?: string | undefined;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: ToolAnnotations | undefined;
};

export function hashToolDefinition(tool: ToolDefinition): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        name: tool.name,
        description: tool.description ?? "",
        input_schema: tool.inputSchema ?? {},
        output_schema: tool.outputSchema ?? null,
        annotations: tool.annotations ?? null,
      }),
    )
    .digest("hex");
}
