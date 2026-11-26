import { useState, type FormEvent } from "react";
import type {
  AgentKeyCreated,
  ConnectorAuthInput,
  ConnectorAuthType,
  ConnectorDetail,
  McpTransportKind,
  ProbeResult,
} from "@errand/shared";
import { api, errorMessage } from "../api.ts";
import { AgentKeyPanel } from "../components/AgentKeyPanel.tsx";

type Props = {
  onOpenCatalog: () => void;
};

type Step = "url" | "auth" | "connected";

type SelectableAuth = Exclude<ConnectorAuthType, "oauth">;

const AUTH_LABELS: Array<{ type: SelectableAuth; label: string }> = [
  { type: "none", label: "No auth" },
  { type: "bearer", label: "Bearer token" },
  { type: "header", label: "Custom header" },
  { type: "basic", label: "Basic" },
];

function AuthChip(props: {
  type: ConnectorAuthType;
  label: string;
  checked: boolean;
  onSelect: (type: ConnectorAuthType) => void;
}) {
  return (
    <label className={props.checked ? "chip is-selected" : "chip"}>
      <input
        type="radio"
        name="authType"
        value={props.type}
        checked={props.checked}
        onChange={() => props.onSelect(props.type)}
      />
      {props.label}
    </label>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function transportLabel(transport: McpTransportKind | null): string {
  if (transport === "sse") return "legacy SSE";
  if (transport === "streamable-http") return "Streamable HTTP";
  return "unknown transport";
}

export function Connect({ onOpenCatalog }: Props) {
  const [step, setStep] = useState<Step>("url");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [authType, setAuthType] = useState<ConnectorAuthType>("none");
  const [token, setToken] = useState("");
  const [headerName, setHeaderName] = useState("");
  const [headerValue, setHeaderValue] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConnectorDetail | null>(null);
  const [issued, setIssued] = useState<AgentKeyCreated | null>(null);

  function serverName(): string {
    return name.trim() === "" ? hostOf(url) : name.trim();
  }

  async function checkServer(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const probed = await api.probe(url.trim());
      setProbe(probed);
      if (!probed.reachable) {
        setError("That server did not answer. Check the URL and that the server is running.");
        return;
      }
      setAuthType(probed.requiresAuth ? (probed.authHint ?? "bearer") : "none");
      setStep("auth");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function credentialAuthInput(auth: SelectableAuth): ConnectorAuthInput {
    const base = { name: serverName(), url: url.trim() };
    switch (auth) {
      case "bearer":
        return { ...base, authType: auth, token };
      case "header":
        return { ...base, authType: auth, headerName, headerValue };
      case "basic":
        return { ...base, authType: auth, username, password };
      case "none":
        return { ...base, authType: auth };
    }
  }

  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (authType === "oauth") {
        const started = await api.startOAuth(serverName(), url.trim());
        window.location.assign(started.authorizationUrl);
        return;
      }
      setResult(await api.connect(credentialAuthInput(authType)));
      setStep("connected");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function createKey() {
    if (result === null) return;
    setBusy(true);
    setError(null);
    try {
      setIssued(await api.issueAgentKey(`${result.connector.name} agent`.slice(0, 64)));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function addAnother() {
    setStep("url");
    setUrl("");
    setName("");
    setProbe(null);
    setResult(null);
    setIssued(null);
    setError(null);
    setToken("");
    setHeaderName("");
    setHeaderValue("");
    setUsername("");
    setPassword("");
  }

  return (
    <section className="screen">
      <header className="screen-head">
        <p className="eyebrow">Connect</p>
        <h1>Paste one URL</h1>
        <p className="lede">
          Errand holds the credential. Your agent never sees it — only the key you collect at the
          end.
        </p>
      </header>

      <ol className="steps" aria-label="Connection progress">
        <li className={step === "url" ? "is-current" : "is-done"}>1 · URL</li>
        <li className={step === "auth" ? "is-current" : step === "connected" ? "is-done" : ""}>
          2 · Auth
        </li>
        <li className={step === "connected" ? "is-current" : ""}>3 · Key</li>
      </ol>

      {step === "url" && (
        <form className="panel stack" onSubmit={checkServer}>
          <label className="field">
            <span>MCP server URL</span>
            <input
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="https://mcp.example.com/mcp"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>
              Name <em>optional</em>
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={hostOf(url) || "Calendar"}
              maxLength={120}
            />
          </label>
          {error !== null && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="button primary" disabled={busy || url.trim() === ""}>
            {busy ? "Checking…" : "Check server"}
          </button>
          <p className="hint">
            Errand refuses internal, loopback and metadata addresses, and never runs stdio servers.
          </p>
        </form>
      )}

      {step === "auth" && probe !== null && (
        <form className="panel stack" onSubmit={connect}>
          <div className="probe">
            <p className="probe-name">{serverName()}</p>
            <p className="hint">
              {probe.requiresAuth
                ? `Protected — it asks for ${probe.authHint ?? "a credential"}.`
                : "Open — no credential required."}{" "}
              {probe.transport !== null && `${transportLabel(probe.transport)} · `}
              {probe.toolCount} {probe.toolCount === 1 ? "tool" : "tools"}
            </p>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setStep("url");
                setError(null);
              }}
            >
              Change URL
            </button>
          </div>

          <fieldset className="field-group">
            <legend>How should Errand authenticate?</legend>
            <div className="chips">
              {probe.authHint === "oauth" && (
                <AuthChip
                  type="oauth"
                  label="Sign in (OAuth)"
                  checked={authType === "oauth"}
                  onSelect={setAuthType}
                />
              )}
              {AUTH_LABELS.map((option) => (
                <AuthChip
                  key={option.type}
                  type={option.type}
                  label={option.label}
                  checked={authType === option.type}
                  onSelect={setAuthType}
                />
              ))}
            </div>
            {probe.authHint !== null && (
              <p className="hint">The server's challenge suggests {probe.authHint}.</p>
            )}
            {authType === "oauth" && (
              <p className="hint">
                You will be sent to the service to sign in. Errand stores the token; your agent
                never sees it.
              </p>
            )}
          </fieldset>

          {authType === "bearer" && (
            <label className="field">
              <span>Token</span>
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                required
              />
            </label>
          )}

          {authType === "header" && (
            <div className="grid-2">
              <label className="field">
                <span>Header name</span>
                <input
                  value={headerName}
                  onChange={(event) => setHeaderName(event.target.value)}
                  placeholder="X-API-Key"
                  required
                />
              </label>
              <label className="field">
                <span>Header value</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={headerValue}
                  onChange={(event) => setHeaderValue(event.target.value)}
                  required
                />
              </label>
            </div>
          )}

          {authType === "basic" && (
            <div className="grid-2">
              <label className="field">
                <span>Username</span>
                <input
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>
            </div>
          )}

          {error !== null && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? "Connecting…" : authType === "oauth" ? "Sign in and connect" : "Connect"}
          </button>
          <p className="hint">
            The credential is encrypted in the vault. It is never returned, logged or shown again.
          </p>
        </form>
      )}

      {step === "connected" && result !== null && (
        <>
          <div className="panel">
            <div className="result-head">
              <span className="badge ok">Connected</span>
              <button type="button" className="link-button" onClick={addAnother}>
                Add another
              </button>
            </div>
            <h2>{result.connector.name}</h2>
            <p className="hint">
              {result.connector.url} · {transportLabel(result.transport)} ·{" "}
              {result.summary.total} {result.summary.total === 1 ? "tool" : "tools"} discovered
              {result.summary.changed > 0 && `, ${result.summary.changed} changed`}
              {result.summary.removed > 0 && `, ${result.summary.removed} removed`}
            </p>
            <ul className="tool-summary">
              {result.tools.slice(0, 6).map((tool) => (
                <li key={tool.id}>
                  <span className="mono">{tool.agentName}</span>
                  <span className={`class class-${tool.class}`}>{tool.class}</span>
                  <span className={tool.requestable ? "state ok" : "state muted"}>
                    {tool.requestable ? "requestable" : "human only"}
                  </span>
                </li>
              ))}
            </ul>
            <button type="button" className="button secondary" onClick={onOpenCatalog}>
              Review in Catalog
            </button>
          </div>

          <AgentKeyPanel issued={issued} busy={busy} error={error} onCreate={createKey} />
        </>
      )}
    </section>
  );
}
