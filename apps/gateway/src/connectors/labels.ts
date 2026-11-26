import { sanitiseDescription } from "./sanitise.ts";

export function labelFor(connectorName: string, toolName: string): string {
  const connector = sanitiseDescription(connectorName, 40).replace(/[.,;:]+$/, "");
  const action = toolName.replace(/[_-]+/g, " ").toLowerCase();
  return sanitiseDescription(`${connector}: ${action}`, 80);
}
