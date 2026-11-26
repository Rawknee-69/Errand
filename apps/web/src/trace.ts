import type { TraceEvent } from "@errand/shared";
import { count, text } from "./feed.ts";

export type TraceFamily = "all" | "slip" | "call" | "vault" | "connector" | "catalog" | "auth";

export const TRACE_FAMILIES: Array<{ id: TraceFamily; label: string }> = [
  { id: "all", label: "All" },
  { id: "slip", label: "Slips" },
  { id: "call", label: "Calls" },
  { id: "vault", label: "Vault" },
  { id: "connector", label: "Connectors" },
  { id: "catalog", label: "Catalog" },
  { id: "auth", label: "Keys" },
];

export function familyOf(eventType: string): TraceFamily {
  if (eventType.startsWith("call.")) return "call";
  if (eventType.startsWith("slip.")) return "slip";
  if (eventType.startsWith("vault.")) return "vault";
  if (eventType.startsWith("connector.")) return "connector";
  if (eventType.startsWith("catalog.")) return "catalog";
  return "auth";
}

function humanise(value: string): string {
  const words = value.replace(/[._-]+/g, " ").trim();
  return words === "" ? "Event" : words.charAt(0).toUpperCase() + words.slice(1);
}

function toolList(payload: Record<string, unknown>): string | null {
  const tools = payload.tools;
  if (!Array.isArray(tools)) return null;
  const names = tools.filter((tool): tool is string => typeof tool === "string");
  return names.length === 0 ? null : names.join(", ");
}

function joined(parts: (string | null)[]): string {
  return parts.filter((part): part is string => part !== null && part !== "").join(" · ");
}

export type TraceLine = { title: string; detail: string };

export function describeTraceEvent(event: TraceEvent): TraceLine {
  const { payload } = event;
  const tool = text(payload, "tool");
  const goal = text(payload, "goal");
  const reason = text(payload, "reason");
  const message = text(payload, "message");
  const duration = count(payload, "duration_ms");
  const bytes = count(payload, "result_bytes");
  const calls = count(payload, "call_cap");
  const connector = event.connectorName ?? text(payload, "connector_id");
  const host = text(payload, "host");
  const authType = text(payload, "auth_type");
  const toolCount = count(payload, "tool_count") ?? count(payload, "total");

  switch (event.eventType) {
    case "slip.requested":
      return {
        title: goal === null ? "Slip requested" : `Slip requested — ${goal}`,
        detail: joined([toolList(payload), calls === null ? null : `${calls} calls`]),
      };
    case "slip.approved":
      return {
        title: "Slip approved",
        detail: joined([
          calls === null ? null : `${calls} calls`,
          Array.isArray(payload.trims) && payload.trims.length > 0
            ? `${payload.trims.length} cap trimmed`
            : "no cap trimmed",
        ]),
      };
    case "slip.denied":
      return { title: "Slip denied", detail: joined([text(payload, "slip_id"), reason]) };
    case "call.allowed":
      return {
        title: `Call allowed — ${tool ?? "unknown tool"}`,
        detail: joined([
          text(payload, "class"),
          count(payload, "calls_remaining") === null
            ? null
            : `${count(payload, "calls_remaining")} calls left`,
          count(payload, "amount_cents") === 0 ? "no spend" : null,
        ]),
      };
    case "call.succeeded":
      return {
        title: `Call succeeded — ${tool ?? "unknown tool"}`,
        detail: joined([
          duration === null ? null : `${duration} ms`,
          bytes === null ? null : `${bytes} bytes`,
          payload.truncated === true ? "truncated" : null,
          payload.upstream_is_error === true ? "upstream reported an error" : null,
        ]),
      };
    case "call.failed":
      return {
        title: `Call failed — ${tool ?? "unknown tool"}`,
        detail: joined([reason, message, duration === null ? null : `${duration} ms`]),
      };
    case "call.scope_violation":
      return {
        title: `Scope violation — ${tool ?? "unknown tool"}`,
        detail: joined([reason, "refused before forwarding"]),
      };
    case "call.denied":
      return { title: `Call denied — ${tool ?? "unknown tool"}`, detail: reason ?? "" };
    case "call.not_forwarded":
      return { title: `Call not forwarded — ${tool ?? "unknown tool"}`, detail: reason ?? "" };
    case "vault.credential_used":
      return {
        title: "Vault credential used",
        detail: joined([authType, connector]),
      };
    case "vault.credential_sealed":
      return {
        title: "Credential sealed in the vault",
        detail: joined([connector, authType]),
      };
    case "connector.connected":
      return {
        title: host === null ? "Connector connected" : `Connector connected — ${host}`,
        detail: joined([
          connector,
          authType,
          toolCount === null ? null : `${toolCount} tools`,
          text(payload, "transport"),
        ]),
      };
    case "catalog.ingested":
    case "catalog.refreshed":
      return {
        title: `${humanise(event.eventType)} — ${toolCount ?? 0} tools`,
        detail: joined([
          count(payload, "new") === null ? null : `${count(payload, "new")} new`,
          count(payload, "changed") === null ? null : `${count(payload, "changed")} changed`,
          count(payload, "removed") === null ? null : `${count(payload, "removed")} removed`,
        ]),
      };
    case "agent_key.created":
      return {
        title: `Agent key created — ${text(payload, "name") ?? "unnamed"}`,
        detail: "the value is shown once and stored only as a hash",
      };
    case "agent_key.revoked":
      return { title: "Agent key revoked", detail: "" };
    default:
      return {
        title: humanise(event.eventType),
        detail: joined([tool, reason, message, connector, authType]),
      };
  }
}

export function prettyJson(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}
