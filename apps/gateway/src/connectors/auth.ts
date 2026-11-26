import { z } from "zod";
import { connectorAuthInputSchema, type ConnectorAuthInput } from "@errand/shared";
import type { ConnectorAuthType } from "../db/schema.ts";
import { ConnectorError } from "./errors.ts";

export { connectorAuthInputSchema, type ConnectorAuthInput };

export type ConnectorAuth =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "header"; headerName: string; value: string }
  | { type: "basic"; username: string; password: string }
  | { type: "oauth"; accessToken: string };

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
