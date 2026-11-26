import { useCallback, useState, type FormEvent } from "react";
import type { AgentKeyCreated, AgentKeyView, FeedEvent } from "@errand/shared";
import { api, errorMessage } from "../api.ts";
import { IssuedKey } from "../components/IssuedKey.tsx";
import { formatTimestamp } from "../format.ts";
import { keyStatusView, splitAgentKeys } from "../keys.ts";
import { useLiveFeed } from "../useLiveFeed.ts";
import { useResource } from "../useResource.ts";

function KeyRow({
  agentKey,
  confirming,
  busy,
  error,
  onAskRevoke,
  onCancelRevoke,
  onRevoke,
}: {
  agentKey: AgentKeyView;
  confirming: boolean;
  busy: boolean;
  error: string | null;
  onAskRevoke: () => void;
  onCancelRevoke: () => void;
  onRevoke: () => void;
}) {
  const status = keyStatusView(agentKey);

  return (
    <li className="key-card">
      <div className="receipt-head">
        <div className="receipt-title">
          <p className="receipt-summary">{agentKey.name}</p>
          <p className="hint">
            Created {formatTimestamp(agentKey.createdAt)}
            {agentKey.revokedAt !== null && ` · revoked ${formatTimestamp(agentKey.revokedAt)}`}
          </p>
        </div>
        <span className={`badge ${status.tone}`}>{status.label}</span>
      </div>

      {agentKey.revokedAt === null && (
        <div className="actions">
          {confirming ? (
            <>
              <button type="button" className="button small danger" disabled={busy} onClick={onRevoke}>
                {busy ? "Revoking…" : "Revoke this key now"}
              </button>
              <button type="button" className="link-button" disabled={busy} onClick={onCancelRevoke}>
                Keep it
              </button>
            </>
          ) : (
            <button type="button" className="button small" onClick={onAskRevoke}>
              Revoke
            </button>
          )}
        </div>
      )}

      {confirming && (
        <p className="hint">
          A revoked key stops working on the very next request. The agent must be given a new key.
        </p>
      )}

      {error !== null && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

export function Keys() {
  const { data, loading, error, reload, setData } = useResource(api.agentKeys);
  const [name, setName] = useState("");
  const [issued, setIssued] = useState<AgentKeyCreated | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const onEvent = useCallback(
    (event: FeedEvent) => {
      if (/^agent_key\./.test(event.eventType)) void reload(true);
    },
    [reload],
  );
  useLiveFeed(onEvent);

  async function create(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const created = await api.issueAgentKey(name.trim() === "" ? "Agent key" : name.trim());
      setIssued(created);
      setName("");
      await reload(true);
    } catch (caught) {
      setCreateError(errorMessage(caught));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(agentKey: AgentKeyView) {
    setBusyId(agentKey.id);
    setRowErrors((current) => {
      const next = { ...current };
      delete next[agentKey.id];
      return next;
    });
    try {
      const result = await api.revokeAgentKey(agentKey.id);
      setData((current) =>
        current === null
          ? current
          : {
              agentKeys: current.agentKeys.map((row) =>
                row.id === result.agentKey.id ? result.agentKey : row,
              ),
            },
      );
      setConfirmId(null);
    } catch (caught) {
      setRowErrors((current) => ({ ...current, [agentKey.id]: errorMessage(caught) }));
    } finally {
      setBusyId(null);
    }
  }

  const keys = data?.agentKeys ?? [];
  const grouped = splitAgentKeys(keys);

  function row(agentKey: AgentKeyView) {
    return (
      <KeyRow
        key={agentKey.id}
        agentKey={agentKey}
        confirming={confirmId === agentKey.id}
        busy={busyId === agentKey.id}
        error={rowErrors[agentKey.id] ?? null}
        onAskRevoke={() => setConfirmId(agentKey.id)}
        onCancelRevoke={() => setConfirmId(null)}
        onRevoke={() => void revoke(agentKey)}
      />
    );
  }

  return (
    <section className="screen">
      <header className="screen-head">
        <p className="eyebrow">Agent keys</p>
        <h1>The keys your agents use</h1>
        <p className="lede">
          A key is shown once, when it is created; the database keeps only its hash. Revoking one
          takes effect on the next request, so an agent cannot keep working on a key you withdrew.
        </p>
      </header>

      <div className="panel stack">
        <h2>Create a key</h2>
        <form className="stack" onSubmit={create}>
          <label className="field">
            <span>
              Name <em>so you can tell them apart</em>
            </span>
            <input
              value={name}
              maxLength={64}
              disabled={creating}
              placeholder="Claude Code"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {createError !== null && (
            <p className="alert" role="alert">
              {createError}
            </p>
          )}
          <button type="submit" className="button primary" disabled={creating}>
            {creating ? "Creating…" : "Create agent key"}
          </button>
        </form>
      </div>

      {issued !== null && (
        <div className="panel key-panel">
          <p className="eyebrow">New key</p>
          <h2>{issued.agentKey.name}</h2>
          <IssuedKey issued={issued} />
          <p className="hint">
            Cursor: save the snippet as <span className="mono">.cursor/mcp.json</span>. Claude Code:
            run the command once.
          </p>
          <button type="button" className="link-button" onClick={() => setIssued(null)}>
            I saved it, hide the key
          </button>
        </div>
      )}

      {loading && keys.length === 0 && (
        <p className="panel hint" aria-busy="true">
          Reading keys…
        </p>
      )}

      {error !== null && (
        <div className="panel stack">
          <p className="alert" role="alert">
            {error}
          </p>
          <button type="button" className="button secondary" onClick={() => void reload()}>
            Try again
          </button>
        </div>
      )}

      {!loading && error === null && keys.length === 0 && (
        <div className="panel stack empty">
          <h2>No keys yet</h2>
          <p className="lede">
            Create one above and paste it into your agent. Until then, nothing can connect to the
            agent endpoint.
          </p>
        </div>
      )}

      {grouped.active.length > 0 && (
        <section className="stack" aria-label="Active keys">
          <h2>Active</h2>
          <ul className="key-list">{grouped.active.map(row)}</ul>
        </section>
      )}

      {grouped.revoked.length > 0 && (
        <section className="stack" aria-label="Revoked keys">
          <h2>Revoked</h2>
          <ul className="key-list">{grouped.revoked.map(row)}</ul>
        </section>
      )}
    </section>
  );
}
