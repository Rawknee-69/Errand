import type { AgentKeyCreated } from "@errand/shared";
import { ClientSnippets } from "./ClientSnippets.tsx";
import { CopyButton } from "./CopyButton.tsx";

export function IssuedKey({ issued }: { issued: AgentKeyCreated }) {
  return (
    <>
      <p className="alert once" role="status">
        Copy this now. It is shown once and cannot be recovered.
      </p>
      <div className="key-row">
        <code className="key">{issued.key}</code>
        <CopyButton value={issued.key} label="Copy key" />
      </div>
      <ClientSnippets mcpUrl={issued.mcpUrl} agentKey={issued.key} />
    </>
  );
}
