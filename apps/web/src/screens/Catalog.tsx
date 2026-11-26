import { useState } from "react";
import {
  isBlockedToolState,
  isClassLoosening,
  toolClassSchema,
  type CatalogToolView,
  type ToolClass,
} from "@errand/shared";
import { api, errorMessage } from "../api.ts";
import {
  blockedToolCount,
  exposedToolCount,
  toolsForConnector,
} from "../catalog.ts";
import { useCatalog } from "../useCatalog.ts";

type Props = {
  onOpenConnect: () => void;
};

type PendingLoosening = {
  toolId: string;
  next: ToolClass;
};

const CLASS_OPTIONS = toolClassSchema.options;

function stateLabel(tool: CatalogToolView): string | null {
  if (tool.state === "changed") return "changed — blocked";
  if (tool.state === "removed") return "removed — blocked";
  if (tool.state === "new") return "new";
  return null;
}

export function Catalog({ onOpenConnect }: Props) {
  const { data, loading, error, reload, replaceTool } = useCatalog();
  const [pending, setPending] = useState<PendingLoosening | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const tools = data?.tools ?? [];
  const connectors = data?.connectors ?? [];
  const blockedCount = blockedToolCount(tools);
  const requestableCount = exposedToolCount(tools);

  async function mutate(toolId: string, action: () => Promise<CatalogToolView>) {
    setBusyId(toolId);
    setActionError(null);
    try {
      replaceTool(await action());
      setPending(null);
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  function chooseClass(tool: CatalogToolView, next: ToolClass) {
    if (next === tool.class) return;
    if (isClassLoosening(tool.class, next)) {
      setActionError(null);
      setPending({ toolId: tool.id, next });
      return;
    }
    void mutate(tool.id, async () => (await api.setToolClass(tool.id, next, false)).tool);
  }

  async function toggleRequestable(tool: CatalogToolView) {
    const next = !tool.requestable;
    setBusyId(tool.id);
    setActionError(null);
    replaceTool({ ...tool, requestable: next });
    try {
      replaceTool((await api.setToolRequestable(tool.id, next)).tool);
    } catch (caught) {
      replaceTool(tool);
      setActionError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  function approve(tool: CatalogToolView) {
    void mutate(tool.id, async () => (await api.approveTool(tool.id)).tool);
  }

  return (
    <section className="screen">
      <header className="screen-head">
        <p className="eyebrow">Catalog</p>
        <h1>Every tool, and what it may do</h1>
        <p className="lede">
          Each discovered tool has a class and a pinned definition. A risky tool stays out of your
          agent's reach until you expose it; a changed definition stays blocked until you look
          again.
        </p>
      </header>

      {loading && (
        <p className="panel hint" aria-busy="true">
          Reading the catalog…
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

      {!loading && error === null && tools.length === 0 && (
        <div className="panel stack empty">
          <h2>No tools yet</h2>
          <p className="lede">
            Connect a service and Errand lists every tool it offers here, already classified.
          </p>
          <button type="button" className="button primary" onClick={onOpenConnect}>
            Connect a service
          </button>
        </div>
      )}

      {!loading && tools.length > 0 && (
        <>
          <ul className="tally" aria-label="Catalog summary">
            <li>
              <strong>{tools.length}</strong> tools
            </li>
            <li>
              <strong>{requestableCount}</strong> requestable
            </li>
            <li className={blockedCount > 0 ? "is-blocked" : ""}>
              <strong>{blockedCount}</strong> blocked
            </li>
          </ul>

          {actionError !== null && (
            <p className="alert" role="alert">
              {actionError}
            </p>
          )}

          {connectors.map((connector) => {
            const rows = toolsForConnector(tools, connector.id);
            if (rows.length === 0) return null;
            return (
              <section key={connector.id} className="catalog-group" aria-label={connector.name}>
                <div className="group-head">
                  <h2>{connector.name}</h2>
                  <span className="hint">
                    {rows.length} {rows.length === 1 ? "tool" : "tools"}
                  </span>
                </div>

                <ul className="tool-list">
                  {rows.map((tool) => {
                    const isBlocked = isBlockedToolState(tool.state);
                    const busy = busyId === tool.id;
                    return (
                      <li
                        key={tool.id}
                        className={isBlocked ? "tool-card is-blocked" : "tool-card"}
                      >
                        <div className="tool-top">
                          <code className="mono">{tool.agentName}</code>
                          <span className={`class class-${tool.class}`}>{tool.class}</span>
                          {stateLabel(tool) !== null && (
                            <span className={isBlocked ? "state danger" : "state muted"}>
                              {stateLabel(tool)}
                            </span>
                          )}
                        </div>

                        <p className="tool-desc">
                          {tool.description === ""
                            ? "No upstream description."
                            : tool.description}
                        </p>

                        {tool.state === "changed" && (
                          <div className="block-banner">
                            <p className="eyebrow">Definition changed upstream</p>
                            <p className="hint">
                              Upstream now says: “{tool.observedDescription || "no description"}” ·
                              class <strong>{tool.observedClass}</strong>
                            </p>
                            <p className="hint">
                              The approved definition is still what runs. Nothing containing this
                              tool can start until you approve the new one.
                            </p>
                            <button
                              type="button"
                              className="button small"
                              disabled={busy}
                              onClick={() => approve(tool)}
                            >
                              {busy ? "Approving…" : "Re-approve this definition"}
                            </button>
                          </div>
                        )}

                        {tool.state === "removed" && (
                          <p className="hint">
                            The server no longer lists this tool. Existing approvals cannot use it.
                          </p>
                        )}

                        <div className="tool-controls">
                          <label className="control">
                            <span>Class</span>
                            <select
                              value={tool.class}
                              disabled={isBlocked || busy}
                              onChange={(event) =>
                                chooseClass(tool, toolClassSchema.parse(event.target.value))
                              }
                            >
                              {CLASS_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="control toggle">
                            <span>Requestable by your agent</span>
                            <input
                              type="checkbox"
                              checked={tool.requestable}
                              disabled={isBlocked || tool.class === "unknown" || busy}
                              onChange={() => void toggleRequestable(tool)}
                            />
                          </label>
                        </div>

                        {tool.class === "unknown" && (
                          <p className="hint">
                            No safe class was detected. Set one before this tool can be exposed.
                          </p>
                        )}

                        {pending !== null && pending.toolId === tool.id && (
                          <div className="block-banner confirm">
                            <p className="eyebrow">Loosening the class</p>
                            <p className="hint">
                              {tool.class} → {pending.next} widens what this tool may do. This
                              change is journaled.
                            </p>
                            <div className="actions">
                              <button
                                type="button"
                                className="button small"
                                disabled={busy}
                                onClick={() =>
                                  void mutate(
                                    tool.id,
                                    async () => (await api.setToolClass(tool.id, pending.next, true)).tool,
                                  )
                                }
                              >
                                {busy ? "Saving…" : `Confirm ${pending.next}`}
                              </button>
                              <button
                                type="button"
                                className="link-button"
                                onClick={() => setPending(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </section>
  );
}
