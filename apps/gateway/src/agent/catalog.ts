import type { Db } from "../db/client.ts";
import type { ToolClass } from "../db/schema.ts";
import { listCatalog } from "../connectors/catalog.ts";
import { listConnectors } from "../db/scoped-reads.ts";
import { sanitiseDescription } from "../connectors/sanitise.ts";
import { isDecoyToolName } from "../policy/decoys.ts";

export type AgentCatalogTool = {
  name: string;
  label: string;
  description: string;
  class: ToolClass;
  connector: string;
};

function labelFor(connectorName: string, toolName: string): string {
  const connector = sanitiseDescription(connectorName, 40).replace(/[.,;:]+$/, "");
  const action = toolName.replace(/[_-]+/g, " ").toLowerCase();
  return sanitiseDescription(`${connector}: ${action}`, 80);
}

export function agentCatalog(db: Db, userId: string): AgentCatalogTool[] {
  const connectorNames = new Map(listConnectors(db, userId).map((row) => [row.id, row.name]));
  return listCatalog(db, userId)
    .filter((tool) => tool.requestable)
    .filter((tool) => !isDecoyToolName(tool.name) && !isDecoyToolName(tool.agentName))
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
