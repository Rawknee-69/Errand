import { AGENT_LIMITS, exposureOf, isExposed, type AgentCatalogTool, type Boundary } from "@errand/shared";
import type { Db } from "../db/client.ts";
import { listCatalog } from "../connectors/catalog.ts";
import { listConnectors } from "../db/scoped-reads.ts";
import { sanitiseDescription } from "../connectors/sanitise.ts";
import { labelFor } from "../connectors/labels.ts";

export type { AgentCatalogTool };

export function agentCatalog(db: Db, userId: string): AgentCatalogTool[] {
  const connectorNames = new Map(listConnectors(db, userId).map((row) => [row.id, row.name]));
  return listCatalog(db, userId)
    .filter(isExposed)
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

// One read of both layers: every discovered tool bottom, only the agent-visible
// ones top, and the reason for each gap. The control panel shows exactly this,
// so a "hidden tools" claim cannot drift from what the agent endpoint serves.
export function boundaryView(db: Db, userId: string): Boundary {
  const connectorRows = listConnectors(db, userId);
  const all = listCatalog(db, userId);
  const visible = agentCatalog(db, userId);
  const visibleNames = new Set(visible.map((tool) => tool.name));
  const hidden = all.flatMap((tool) => {
    const exposure = exposureOf(tool);
    if (exposure.exposed) return [];
    const connector = connectorRows.find((row) => row.id === tool.connectorId)?.name ?? "";
    return [
      {
        name: tool.agentName,
        label: labelFor(connector, tool.name),
        connector,
        class: tool.class,
        reason: exposure.reason,
      },
    ];
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
