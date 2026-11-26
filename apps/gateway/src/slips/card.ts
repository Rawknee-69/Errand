import type { ApprovalCard, SlipState, Tier, ToolClass } from "@errand/shared";
import type { Db } from "../db/client.ts";
import { listCatalog } from "../connectors/catalog.ts";
import { labelFor } from "../connectors/labels.ts";
import { listConnectors } from "../db/scoped-reads.ts";
import { parseSlipTools } from "../agent/slip-tools.ts";
import { effectiveSlipState } from "./state.ts";

type CardSlip = {
  id: string;
  state: SlipState;
  tier: Tier;
  goal: string;
  tools: string;
  callCap: number;
  callsUsed: number;
  spendCapCents: number;
  spendUsedCents: number;
  expiresAt: string;
};

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function cannotFor(classes: Set<ToolClass>, callCap: number, spendCapCents: number): string[] {
  const cannot = [
    "Use any tool that is not on this slip",
    "Run after the slip expires",
    `Make more than ${callCap} ${callCap === 1 ? "call" : "calls"}`,
  ];
  if (!classes.has("write")) cannot.push("Change anything");
  if (!classes.has("delete")) cannot.push("Delete anything");
  if (!classes.has("send")) cannot.push("Send messages or email");
  if (!classes.has("spend")) cannot.push("Spend any money");
  else if (spendCapCents === 0) cannot.push("Spend any money");
  else cannot.push(`Spend more than ${money(spendCapCents)}`);
  return cannot;
}

function rawToolName(agentName: string): string {
  const separator = agentName.lastIndexOf("__");
  return separator === -1 ? agentName : agentName.slice(separator + 2);
}

export function buildApprovalCard(db: Db, userId: string, slip: CardSlip, now = new Date()): ApprovalCard {
  const connectors = new Map(listConnectors(db, userId).map((row) => [row.id, row.name]));
  const catalog = new Map(listCatalog(db, userId).map((tool) => [tool.agentName, tool]));
  const tools = parseSlipTools(slip.tools);

  const services = new Map<string, { id: string; name: string; tools: string[] }>();
  for (const tool of tools) {
    const name = connectors.get(tool.connectorId) ?? tool.connectorId;
    const service = services.get(tool.connectorId) ?? { id: tool.connectorId, name, tools: [] };
    service.tools.push(tool.name);
    services.set(tool.connectorId, service);
  }

  const can = tools.map((tool) => {
    const connector = connectors.get(tool.connectorId) ?? tool.connectorId;
    const catalogTool = catalog.get(tool.name);
    return {
      tool: tool.name,
      label: labelFor(connector, catalogTool?.name ?? rawToolName(tool.name)),
      connector,
      class: tool.class,
    };
  });

  const expiresAt = Date.parse(slip.expiresAt);
  return {
    slipId: slip.id,
    state: effectiveSlipState(slip, now),
    tier: slip.tier,
    goal: slip.goal,
    services: [...services.values()],
    can,
    cannot: cannotFor(new Set(tools.map((tool) => tool.class)), slip.callCap, slip.spendCapCents),
    callCap: slip.callCap,
    callsUsed: slip.callsUsed,
    callsRemaining: Math.max(0, slip.callCap - slip.callsUsed),
    spendCapCents: slip.spendCapCents,
    spendUsedCents: slip.spendUsedCents,
    spendRemainingCents: Math.max(0, slip.spendCapCents - slip.spendUsedCents),
    expiresAt: slip.expiresAt,
    timeLeftSeconds: Math.max(0, Math.floor((expiresAt - now.getTime()) / 1000)),
  };
}
