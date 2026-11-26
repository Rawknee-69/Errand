import { isToolExposed } from "@errand/shared";
import type { Db } from "../db/client.ts";
import type { ToolClass } from "../db/schema.ts";
import { listCatalog, type CatalogTool } from "../connectors/catalog.ts";
import { listConnectors } from "../db/scoped-reads.ts";
import { sanitiseDescription } from "../connectors/sanitise.ts";
import { isDecoyToolName } from "../policy/decoys.ts";
import { labelFor } from "../connectors/labels.ts";

export type AgentCatalogTool = {
  name: string;
  label: string;
  description: string;
  class: ToolClass;
  connector: string;
};

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
