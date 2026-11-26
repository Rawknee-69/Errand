import type { AgentKeyCreated } from "@errand/shared";
import { IssuedKey } from "./IssuedKey.tsx";

type Props = {
  issued: AgentKeyCreated | null;
  busy: boolean;
  error: string | null;
  onCreate: () => void;
};

export function AgentKeyPanel({ issued, busy, error, onCreate }: Props) {
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
        <>
          <IssuedKey issued={issued} />
          <p className="hint">
            Cursor: save the snippet as <span className="mono">.cursor/mcp.json</span>. Claude Code:
            run the command once. The key is bound to your account, not to this connector.
          </p>
        </>
      )}
    </div>
  );
}
