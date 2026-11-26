import {
  isBlockedToolState,
  isExposed,
  type CatalogToolView,
} from "@errand/shared";

export function toolsForConnector(
  tools: CatalogToolView[],
  connectorId: string,
): CatalogToolView[] {
  return tools.filter((tool) => tool.connectorId === connectorId);
}

export function blockedToolCount(tools: CatalogToolView[]): number {
  return tools.filter((tool) => isBlockedToolState(tool.state)).length;
}

export function exposedToolCount(tools: CatalogToolView[]): number {
  return tools.filter(isExposed).length;
}
