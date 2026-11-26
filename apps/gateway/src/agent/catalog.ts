import {
  isToolExposed,
  type AgentCatalogTool,
  type Boundary,
  type HiddenToolReason,
} from "@errand/shared";
import type { Db } from "../db/client.ts";
import { listCatalog, type CatalogTool } from "../connectors/catalog.ts";
import { listConnectors } from "../db/scoped-reads.ts";
import { sanitiseDescription } from "../connectors/sanitise.ts";
import { isDecoyToolName } from "../policy/decoys.ts";
import { labelFor } from "../connectors/labels.ts";
import { AGENT_LIMITS } from "./limits.ts";

export type { AgentCatalogTool };

export function isRequestableTool(tool: CatalogTool): boolean {
  return isToolExposed(tool) && !isDecoyToolName(tool.name) && !isDecoyToolName(tool.agentName);
}

export function agentCatalog(db: Db, userId: string): AgentCatalogTool[] {
  const connectorNames = new Map(listConnectors(db, userId).map((row) => [row.id, row.name]));
  return listCatalog(db, userId)
    .filter(isRequestableTool)
    .map((tool) => {
      const connector = connectorNames.get(tool.connectorId) ?? "";
      return {
        name: tool.agentName,
        label: labelFor(connector, tool.name),
        description: sanitiseDescription(tool.description),
        class: tool.class,
        connector: sanitiseDescription(connector, 64),
      };
    });
}

function hiddenReason(tool: CatalogTool): HiddenToolReason {
  if (isDecoyToolName(tool.name) || isDecoyToolName(tool.agentName)) return "decoy";
  if (tool.state === "changed") return "definition_changed";
  if (tool.state === "removed") return "definition_removed";
  return "not_requestable";
}

// One read of both layers: every discovered tool bottom, only the agent-visible
// ones top, and the reason for each gap. The control panel shows exactly this,
// so a "hidden tools" claim cannot drift from what the agent endpoint serves.
export function boundaryView(db: Db, userId: string): Boundary {
  const connectorRows = listConnectors(db, userId);
  const all = listCatalog(db, userId);
  const visible = agentCatalog(db, userId);
  const visibleNames = new Set(visible.map((tool) => tool.name));
  const hidden = all.filter((tool) => !isRequestableTool(tool)).map((tool) => {
    const connector = connectorRows.find((row) => row.id === tool.connectorId)?.name ?? "";
    return {
      name: tool.agentName,
      label: labelFor(connector, tool.name),
      connector,
      class: tool.class,
      reason: hiddenReason(tool),
    };
  });

  return {
    connectors: connectorRows.map((row) => ({
      id: row.id,
      name: row.name,
      url: row.url,
      authStatus: row.authStatus,
      discovered: all.filter((tool) => tool.connectorId === row.id).length,
      visible: all.filter(
        (tool) => tool.connectorId === row.id && visibleNames.has(tool.agentName),
      ).length,
    })),
    visible,
    hidden,
    counts: {
      connectors: connectorRows.length,
      discovered: all.length,
      visible: visible.length,
      hidden: hidden.length,
      decoys: hidden.filter((tool) => tool.reason === "decoy").length,
      blocked: hidden.filter(
        (tool) =>
          tool.reason === "definition_changed" || tool.reason === "definition_removed",
      ).length,
      notRequestable: hidden.filter((tool) => tool.reason === "not_requestable").length,
    },
    limits: AGENT_LIMITS,
  };
}
