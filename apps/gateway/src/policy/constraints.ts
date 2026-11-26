import { z } from "zod";
import type { ToolClass } from "@errand/shared";
import { parseJsonObject } from "./json.ts";

const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);
const allowlistsSchema = z.record(z.string(), z.array(scalarSchema).min(1));
const constraintsSchema = z.record(z.string(), allowlistsSchema);

export type ConstraintDenial = {
  ok: false;
  reason: "invalid_constraints" | "missing_allowlist" | "constraint_denied";
  message: string;
};

export type ConstraintCheck = { ok: true } | ConstraintDenial;

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function allowed(value: unknown, allowlist: (string | number | boolean)[]): boolean {
  if (Array.isArray(value)) {
    return value.length > 0 && value.every((entry) => isScalar(entry) && allowlist.includes(entry));
  }
  return isScalar(value) && allowlist.includes(value);
}

// A send needs an explicit recipient allowlist; every class may narrow an
// argument to a fixed set of values in the signed slip.
export function checkConstraints(
  raw: string,
  tool: string,
  toolClass: ToolClass,
  args: Record<string, unknown>,
): ConstraintCheck {
  const rawConstraints = parseJsonObject(raw);
  if (rawConstraints === undefined) {
    return {
      ok: false,
      reason: "invalid_constraints",
      message: "The slip constraints are not a JSON object",
    };
  }
  const result = constraintsSchema.safeParse(rawConstraints);
  if (!result.success) {
    return {
      ok: false,
      reason: "invalid_constraints",
      message: "The slip constraints are malformed and cannot be enforced",
    };
  }
  const parsed = result.data;

  const allowlists = parsed[tool];
  if (toolClass === "send" && (allowlists === undefined || Object.keys(allowlists).length === 0)) {
    return {
      ok: false,
      reason: "missing_allowlist",
      message: `A send tool needs an allowlist in the slip; ${tool} has none`,
    };
  }
  if (allowlists === undefined) return { ok: true };

  for (const [argument, values] of Object.entries(allowlists)) {
    // An allowlist constrains the values a call supplies; an absent optional
    // argument is the argument schema's concern, not this check's.
    if (args[argument] === undefined) continue;
    if (!allowed(args[argument], values)) {
      return {
        ok: false,
        reason: "constraint_denied",
        message: `${argument} is outside the allowlist the human approved`,
      };
    }
  }
  return { ok: true };
}
