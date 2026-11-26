import { useState } from "react";
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

type Props = {
  mcpUrl: string;
  agentKey: string;
};

export function ClientSnippets({ mcpUrl, agentKey }: Props) {
  const [snippet, setSnippet] = useState<SnippetKind>("claude");
  const active = SNIPPETS[snippet];
  const text = active.build(mcpUrl, agentKey);

  return (
    <>
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
