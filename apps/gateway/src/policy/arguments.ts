import Ajv, { type ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import { parseJsonObject } from "./json.ts";

export type ArgumentsCheck = { ok: true } | { ok: false; message: string };

// Upstream servers declare either draft-07 or 2020-12, so accept both.
const validators = [
  new Ajv({ allErrors: true, strict: false }),
  new Ajv2020({ allErrors: true, strict: false }),
];
const compiled = new Map<string, ValidateFunction>();

function validatorFor(schemaJson: string): ValidateFunction | undefined {
  const cached = compiled.get(schemaJson);
  if (cached !== undefined) return cached;
  const schema = parseJsonObject(schemaJson);
  if (schema === undefined) return undefined;
  for (const ajv of validators) {
    try {
      const validate = ajv.compile(schema);
      compiled.set(schemaJson, validate);
      return validate;
    } catch {
      continue;
    }
  }
  return undefined;
}

// Upstream tool schemas are untrusted JSON Schema, so Ajv checks them; a schema
// that cannot be compiled fails closed rather than accepting any arguments.
export function checkArguments(
  schemaJson: string,
  args: Record<string, unknown>,
): ArgumentsCheck {
  const validate = validatorFor(schemaJson);
  if (validate === undefined) {
    return { ok: false, message: "The pinned tool schema cannot be enforced" };
  }
  if (validate(args) === true) return { ok: true };
  const first = validate.errors?.[0];
  const path = first?.instancePath || "arguments";
  return { ok: false, message: `${path} ${first?.message ?? "do not match the pinned schema"}` };
}
