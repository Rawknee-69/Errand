import { useState } from "react";
import type { AgentKeyCreated } from "@errand/shared";
import { claudeCodeSnippet, cursorSnippet } from "../agentSnippets.ts";
import { CopyButton } from "./CopyButton.tsx";

type SnippetKind = "claude" | "cursor";

const SNIPPETS: Record<
  SnippetKind,
  { label: string; copyLabel: string; build: (mcpUrl: string, key: string) => string }
> = {
  claude: { label: "Claude Code", copyLabel: "Copy command", build: claudeCodeSnippet },
  cursor: { label: "Cursor", copyLabel: "Copy JSON", build: cursorSnippet },
};

export function IssuedKey({ issued }: { issued: AgentKeyCreated }) {
  const [snippet, setSnippet] = useState<SnippetKind>("claude");
  const active = SNIPPETS[snippet];
  const text = active.build(issued.mcpUrl, issued.key);

  return (
    <>
      <p className="alert once" role="status">
        Copy this now. It is shown once and cannot be recovered.
      </p>
      <div className="key-row">
        <code className="key">{issued.key}</code>
        <CopyButton value={issued.key} label="Copy key" />
      </div>

      <div className="segmented" role="tablist" aria-label="Client snippet">
        {(Object.keys(SNIPPETS) as SnippetKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={snippet === kind}
            className={snippet === kind ? "is-selected" : ""}
            onClick={() => setSnippet(kind)}
          >
            {SNIPPETS[kind].label}
          </button>
        ))}
      </div>

      <div className="snippet">
        <pre>{text}</pre>
        <CopyButton value={text} label={active.copyLabel} />
      </div>

      <p className="hint">
        Cursor: save the snippet as <span className="mono">.cursor/mcp.json</span>. Claude Code: run
        the command once.
      </p>
    </>
  );
}
