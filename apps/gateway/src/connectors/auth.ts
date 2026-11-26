import { z } from "zod";
import type { ConnectorAuthType } from "../db/schema.ts";
import { ConnectorError } from "./errors.ts";

export type ConnectorAuth =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "header"; headerName: string; value: string }
  | { type: "basic"; username: string; password: string }
  | { type: "oauth"; accessToken: string };

export const headerNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9-]+$/, "Header names may only contain letters, digits and hyphens")
  .refine(
    (name) =>
      !["host", "content-length", "connection", "transfer-encoding", "authorization"].includes(
        name.toLowerCase(),
      ),
    { message: "That header is managed by the gateway" },
  );

const connectorBase = {
  name: z.string().min(1).max(120),
  url: z.string().min(1),
};

// One schema and one switch per auth variant; adding a provider happens here,
// not in the route, the vault adapter and the MCP client separately.
export const connectorAuthInputSchema = z.discriminatedUnion("authType", [
  z.object({ ...connectorBase, authType: z.literal("none") }),
  z.object({ ...connectorBase, authType: z.literal("bearer"), token: z.string().min(1) }),
  z.object({
    ...connectorBase,
    authType: z.literal("header"),
    headerName: headerNameSchema,
    headerValue: z.string().min(1),
  }),
  z.object({
    ...connectorBase,
    authType: z.literal("basic"),
    username: z.string().min(1),
    password: z.string().min(1),
  }),
]);

export type ConnectorAuthInput = z.infer<typeof connectorAuthInputSchema>;

export function toConnectorAuth(input: ConnectorAuthInput): ConnectorAuth {
  switch (input.authType) {
    case "none":
      return { type: "none" };
    case "bearer":
      return { type: "bearer", token: input.token };
    case "header":
      return { type: "header", headerName: input.headerName, value: input.headerValue };
    case "basic":
      return { type: "basic", username: input.username, password: input.password };
  }
}

export function authHeaders(auth: ConnectorAuth): Record<string, string> {
  switch (auth.type) {
    case "none":
      return {};
    case "bearer":
      return { authorization: `Bearer ${auth.token}` };
    case "oauth":
      return { authorization: `Bearer ${auth.accessToken}` };
    case "header":
      return { [auth.headerName]: auth.value };
    case "basic":
      return {
        authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`,
      };
  }
}

export function serialiseCredential(auth: ConnectorAuth): string | undefined {
  switch (auth.type) {
    case "none":
      return undefined;
    case "bearer":
      return JSON.stringify({ token: auth.token });
    case "header":
      return JSON.stringify({ headerName: auth.headerName, value: auth.value });
    case "basic":
      return JSON.stringify({ username: auth.username, password: auth.password });
    case "oauth":
      return undefined;
  }
}

const bearerSecret = z.object({ token: z.string().min(1) });
const headerSecret = z.object({ headerName: z.string().min(1), value: z.string().min(1) });
const basicSecret = z.object({ username: z.string().min(1), password: z.string().min(1) });

export function parseCredential(authType: ConnectorAuthType, secret: string): ConnectorAuth {
  let raw: unknown;
  try {
    raw = JSON.parse(secret);
  } catch {
    throw new ConnectorError("credential", "The stored credential is not valid JSON");
  }
  if (authType === "bearer") {
    const parsed = bearerSecret.safeParse(raw);
    if (!parsed.success) throw new ConnectorError("credential", "The stored bearer token is invalid");
    return { type: "bearer", token: parsed.data.token };
  }
  if (authType === "header") {
    const parsed = headerSecret.safeParse(raw);
    if (!parsed.success) throw new ConnectorError("credential", "The stored header credential is invalid");
    return { type: "header", headerName: parsed.data.headerName, value: parsed.data.value };
  }
  if (authType === "basic") {
    const parsed = basicSecret.safeParse(raw);
    if (!parsed.success) throw new ConnectorError("credential", "The stored basic credential is invalid");
    return { type: "basic", username: parsed.data.username, password: parsed.data.password };
  }
  throw new ConnectorError("credential", `Auth type ${authType} has no stored credential`);
}

export type { ConnectorAuthType };
