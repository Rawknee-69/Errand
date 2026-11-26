import { useState } from "react";
import type { AgentKeyCreated } from "@errand/shared";
import { claudeCodeSnippet, cursorSnippet } from "../agentSnippets.ts";
import { CopyButton } from "./CopyButton.tsx";

type Props = {
  issued: AgentKeyCreated | null;
  busy: boolean;
  error: string | null;
  onCreate: () => void;
};

type SnippetKind = "claude" | "cursor";

const SNIPPETS: Record<
  SnippetKind,
  { label: string; copyLabel: string; build: (mcpUrl: string, key: string) => string }
> = {
  claude: { label: "Claude Code", copyLabel: "Copy command", build: claudeCodeSnippet },
  cursor: { label: "Cursor", copyLabel: "Copy JSON", build: cursorSnippet },
};

export function AgentKeyPanel({ issued, busy, error, onCreate }: Props) {
  const [snippet, setSnippet] = useState<SnippetKind>("claude");

  return (
    <div className="panel key-panel">
      <p className="eyebrow">Step 3 · Agent key</p>
      <h2>One key for your agent</h2>
      {issued === null ? (
        <>
          <p className="lede">
            Create one key and paste it into Claude Code or Cursor. Errand stores only a hash, so
            this is the one time the key can be shown.
          </p>
          {error !== null && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="button primary" onClick={onCreate} disabled={busy}>
            {busy ? "Creating…" : "Create my agent key"}
          </button>
        </>
      ) : (
        <IssuedKey issued={issued} snippet={snippet} onSnippet={setSnippet} />
      )}
    </div>
  );
}

type IssuedKeyProps = {
  issued: AgentKeyCreated;
  snippet: SnippetKind;
  onSnippet: (snippet: SnippetKind) => void;
};

function IssuedKey({ issued, snippet, onSnippet }: IssuedKeyProps) {
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
            onClick={() => onSnippet(kind)}
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
        the command once. The key is bound to your account, not to this connector.
      </p>
    </>
  );
}
