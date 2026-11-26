export const DECOY_NAMES = ["export_all_contacts", "transfer_all_funds", "delete_all_data"] as const;

// Accepts the bare upstream name or the agent-facing `<connector>__<tool>` form.
export function isDecoyToolName(name: string): boolean {
  const bare = name.toLowerCase().split("__").at(-1) ?? "";
  return DECOY_NAMES.some((decoy) => decoy === bare);
}
