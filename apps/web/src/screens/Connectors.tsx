import { useState } from "react";
import type { CatalogResponse, ConnectorView, McpTransportKind } from "@errand/shared";
import { api, errorMessage } from "../api.ts";
import { blockedToolCount, toolsForConnector } from "../catalog.ts";
import { formatTimestamp } from "../format.ts";
import { useCatalog } from "../useCatalog.ts";

type Props = {
  onOpenConnect: () => void;
};

const STATUS_LABELS: Record<ConnectorView["authStatus"], string> = {
  active: "Active",
  pending: "Signing in",
  needs_reauth: "Needs re-auth",
};

function statusClass(status: ConnectorView["authStatus"]): string {
  if (status === "active") return "badge ok";
  if (status === "needs_reauth") return "badge warn";
  return "badge";
}

function transportLabel(transport: McpTransportKind): string {
  return transport === "sse" ? "legacy SSE" : "Streamable HTTP";
}

function hostOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function isMock(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

function toolCounts(data: CatalogResponse | null, connectorId: string) {
  const rows = toolsForConnector(data?.tools ?? [], connectorId);
  return { total: rows.length, blocked: blockedToolCount(rows) };
}

export function Connectors({ onOpenConnect }: Props) {
  const { data, loading, error, reload } = useCatalog();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const connectors = data?.connectors ?? [];

  async function refresh(connector: ConnectorView) {
    setBusyId(connector.id);
    setActionError(null);
    try {
      await api.refreshConnector(connector.id);
      await reload();
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setBusyId(null);
    }
  }

  async function reauth(connector: ConnectorView) {
    setBusyId(connector.id);
    setActionError(null);
    try {
      const result = await api.reauthConnector(connector.id);
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      setActionError(errorMessage(caught));
      setBusyId(null);
    }
  }

  return (
    <section className="screen">
      <header className="screen-head">
        <p className="eyebrow">Connectors</p>
        <h1>What Errand is connected to</h1>
        <p className="lede">
          Status, the last successful read, and a way back in when the upstream stops accepting the
          stored credential.
        </p>
      </header>

      {loading && (
        <p className="panel hint" aria-busy="true">
          Checking connections…
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

      {actionError !== null && (
        <p className="alert" role="alert">
          {actionError}
        </p>
      )}

      {!loading && error === null && connectors.length === 0 && (
        <div className="panel stack empty">
          <h2>Nothing connected</h2>
          <p className="lede">
            Paste an MCP server URL and Errand discovers its tools, classifies them and holds the
            credential in the vault.
          </p>
          <button type="button" className="button primary" onClick={onOpenConnect}>
            Connect a service
          </button>
        </div>
      )}

      {connectors.map((connector) => {
        const counts = toolCounts(data, connector.id);
        const busy = busyId === connector.id;
        return (
          <article key={connector.id} className="panel connector-card">
            <div className="result-head">
              <h2>{connector.name}</h2>
              <span className="badge-row">
                {isMock(connector.url) && <span className="badge muted">Mock</span>}
                <span className={statusClass(connector.authStatus)}>
                  {STATUS_LABELS[connector.authStatus]}
                </span>
              </span>
            </div>
            <p className="hint mono">{hostOf(connector.url)}</p>

            <dl className="facts">
              <div>
                <dt>Tools</dt>
                <dd>
                  {counts.total}
                  {counts.blocked > 0 && ` · ${counts.blocked} blocked`}
                </dd>
              </div>
              <div>
                <dt>Last success</dt>
                <dd>{formatTimestamp(connector.lastSuccessAt)}</dd>
              </div>
              <div>
                <dt>Transport</dt>
                <dd>{transportLabel(connector.transport)}</dd>
              </div>
              <div>
                <dt>Auth</dt>
                <dd>{connector.authType}</dd>
              </div>
            </dl>

            {connector.authStatus === "needs_reauth" && (
              <p className="alert" role="status">
                The upstream rejected the stored credential
                {connector.lastAuthError === null ? "" : ` (${connector.lastAuthError})`}. Nothing
                runs through this connector until it is authorized again.
              </p>
            )}
            {connector.authStatus === "pending" && (
              <p className="hint" role="status">
                Sign-in has not finished. Restart it if the consent tab was closed.
              </p>
            )}

            <div className="actions">
              <button
                type="button"
                className="button small"
                disabled={busy || connector.authStatus === "pending"}
                onClick={() => void refresh(connector)}
              >
                {busy ? "Working…" : "Refresh catalog"}
              </button>
              {connector.authType === "oauth" &&
                (connector.authStatus === "needs_reauth" ||
                  connector.authStatus === "pending") && (
                  <button
                    type="button"
                    className="button small primary"
                    disabled={busy}
                    onClick={() => void reauth(connector)}
                  >
                    {connector.authStatus === "pending" ? "Restart sign-in" : "Sign in again"}
                  </button>
                )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
