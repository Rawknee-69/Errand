import { useEffect, useState } from "react";
import type {
  AgentKeyCreated,
  AuthUser,
  Boundary,
  HiddenToolReason,
  JournalVerify,
  SlipSummary,
} from "@errand/shared";
import { api, errorMessage } from "../api.ts";
import { ClientSnippets } from "../components/ClientSnippets.tsx";
import { CopyButton } from "../components/CopyButton.tsx";
import type { Screen } from "../navigation.ts";

type Props = {
  user: AuthUser;
  onNavigate: (screen: Screen) => void;
};

const AGENT_TOOLS = [
  { name: "errand_catalog", purpose: "List only the tools it may request." },
  { name: "request_errand", purpose: "Ask for one job's tools and caps." },
  { name: "errand_status", purpose: "Poll for approval, then take the capability." },
  { name: "errand_call", purpose: "Make one call inside the signed slip." },
];

const REASON_LABEL: Record<HiddenToolReason, string> = {
  not_requestable: "not exposed",
  definition_changed: "definition changed",
  definition_removed: "removed upstream",
  decoy: "decoy",
};

const DEMO_PROMPT = `You are working through Errand, my MCP doorway. Use only the Errand tools: errand_catalog, request_errand, errand_status, errand_call. You have no other credential or connector URL.

Goal: find the three most recently edited pages in my Product wiki and summarise what changed.

1. Call errand_catalog. Choose only the tools that goal needs.
2. Call request_errand with that goal, those tool names, and limits { "calls": 6 }.
3. Stop and tell me it is pending. I will approve the slip in Errand.
4. After I say approved, call errand_status to collect the capability, then errand_call one call at a time.
5. If a tool is not on the slip, stop. Do not retry, widen the request, or look for another route.`;

const HIDDEN_PREVIEW = 12;

function plural(n: number | undefined, singular: string): string {
  return n === 1 ? singular : `${singular}s`;
}

export function Demo({ user, onNavigate }: Props) {
  const [boundary, setBoundary] = useState<Boundary | null>(null);
  const [slips, setSlips] = useState<SlipSummary[]>([]);
  const [issued, setIssued] = useState<AgentKeyCreated | null>(null);
  const [verify, setVerify] = useState<JournalVerify | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const [nextBoundary, nextSlips] = await Promise.all([api.boundary(), api.slips()]);
      setBoundary(nextBoundary);
      setSlips(nextSlips.slips);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function issueKey() {
    setBusy(true);
    setError(null);
    try {
      setIssued(await api.issueAgentKey("Demo agent"));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function runVerify() {
    setBusy(true);
    setError(null);
    try {
      setVerify(await api.journalVerify());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const counts = boundary?.counts;
  const pending = slips.filter((slip) => slip.state === "pending").length;
  const approved = slips.filter((slip) => slip.state === "approved").length;
  const hiddenPreview = boundary?.hidden.slice(0, HIDDEN_PREVIEW) ?? [];
  const mcpUrl = issued?.mcpUrl ?? new URL("/mcp", window.location.origin).toString();

  return (
    <section className="screen">
      <header className="screen-head">
        <p className="eyebrow">Demo · live from this gateway</p>
        <h1>The door, the key, and what stays behind it</h1>
        <p className="lede">
          Every number on this page is read from the running gateway, not a slide. Connect a
          service, expose the tools one job needs, and watch the agent see only those.
        </p>
      </header>

      {error !== null && (
        <div className="panel stack">
          <p className="alert" role="alert">
            {error}
          </p>
          <button type="button" className="button secondary" onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      )}

      <ul className="tally" aria-label="Boundary totals" aria-busy={loading}>
        <li>
          <strong>{counts?.connectors ?? "–"}</strong>{" "}
          {plural(counts?.connectors, "connector")}
        </li>
        <li>
          <strong>{counts?.discovered ?? "–"}</strong> {plural(counts?.discovered, "tool")}{" "}
          discovered
        </li>
        <li>
          <strong>{counts?.visible ?? "–"}</strong> the agent can name
        </li>
        <li className={counts !== undefined && counts.hidden > 0 ? "is-blocked" : undefined}>
          <strong>{counts?.hidden ?? "–"}</strong> hidden from it
        </li>
      </ul>

      <section className="demo-layers" aria-label="Bottom layer and top layer">
        <article className="layer-card">
          <p className="eyebrow">Bottom layer</p>
          <h2>What Errand holds</h2>
          <p className="hint">
            Every connector and every tool it discovered. The credential never leaves the vault.
          </p>
          {boundary !== null && boundary.connectors.length > 0 ? (
            <ul className="layer-list">
              {boundary.connectors.map((connector) => (
                <li key={connector.id}>
                  <span>{connector.name}</span>
                  <span className="mono">
                    {connector.visible}/{connector.discovered}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">Nothing connected yet.</p>
          )}
          {boundary !== null && boundary.connectors.length > 0 && (
            <p className="hint">Right-hand number: agent-visible / discovered.</p>
          )}
          <button type="button" className="button small primary" onClick={() => onNavigate("connect")}>
            Connect Notion
          </button>
          <p className="hint">
            Notion: paste <span className="mono">https://mcp.notion.com/mcp</span>, choose Sign in
            (OAuth), and the full catalog is pinned behind the door.
          </p>
        </article>

        <article className="layer-card is-top">
          <p className="eyebrow">Top layer</p>
          <h2>What the agent sees</h2>
          <p className="hint">One URL, one key, four tools — and only the upstream tools you expose.</p>
          <ul className="agent-tools">
            {AGENT_TOOLS.map((tool) => (
              <li key={tool.name}>
                <span className="mono">{tool.name}</span>
                <span className="hint">{tool.purpose}</span>
              </li>
            ))}
          </ul>
          <p className="hint">
            It cannot enumerate the rest. Asking for a hidden tool is rejected server-side, not
            hidden by a prompt.
          </p>
        </article>
      </section>

      <section className="panel stack" aria-label="Tools hidden from the agent">
        <div className="group-head">
          <div>
            <p className="eyebrow">The difference</p>
            <h2>
              {counts === undefined
                ? "Reading the boundary…"
                : `${counts.hidden} ${plural(counts.hidden, "tool")} the agent cannot even name`}
            </h2>
          </div>
          {counts !== undefined && (
            <span className="badge warn">
              {counts.decoys} {plural(counts.decoys, "decoy")} · {counts.blocked} blocked ·{" "}
              {counts.notRequestable} not exposed
            </span>
          )}
        </div>
        {hiddenPreview.length === 0 ? (
          <p className="hint">
            Nothing is hidden yet. Connect a service and leave its risky tools unexposed.
          </p>
        ) : (
          <ul className="hidden-list">
            {hiddenPreview.map((tool) => (
              <li key={tool.name}>
                <span className="mono">{tool.name}</span>
                <span className={`class class-${tool.class}`}>{tool.class}</span>
                <span className="hidden-reason">{REASON_LABEL[tool.reason]}</span>
              </li>
            ))}
          </ul>
        )}
        {counts !== undefined && counts.hidden > hiddenPreview.length && (
          <p className="hint">
            and {counts.hidden - hiddenPreview.length} more. The Catalog screen has the full list
            and the expose switch.
          </p>
        )}
        <div className="actions">
          <button type="button" className="button small" onClick={() => onNavigate("catalog")}>
            Open the Catalog
          </button>
          <button type="button" className="button small" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      </section>

      <section className="panel stack" aria-label="Agent connection and prompt">
        <div className="group-head">
          <div>
            <p className="eyebrow">The doorway</p>
            <h2>One config, one prompt</h2>
          </div>
          <span className="badge ok">MCP · Streamable HTTP</span>
        </div>
        <p className="hint">
          URL <span className="mono">{mcpUrl}</span>. The key is shown once and stored only as a
          SHA-256 hash; revoking it kills the agent without touching a connector.
        </p>
        {issued === null ? (
          <button type="button" className="button primary" onClick={() => void issueKey()} disabled={busy}>
            {busy ? "Issuing…" : "Issue a demo agent key"}
          </button>
        ) : (
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
        )}
        <div className="snippet">
          <p className="eyebrow">Paste this prompt into the agent</p>
          <pre>{DEMO_PROMPT}</pre>
          <CopyButton value={DEMO_PROMPT} label="Copy prompt" />
        </div>
      </section>

      <section className="safety-grid" aria-label="Safety objects">
        <article className="panel safety-card">
          <p className="eyebrow">Sign-in</p>
          <h2>{user.name}</h2>
          <p className="hint">
            Single owner behind a passphrase. Demo guests are a deliberate, journaled deviation;
            each guest sees only their own connectors and slips.
          </p>
        </article>
        <article className="panel safety-card">
          <p className="eyebrow">Vault</p>
          <h2>Sealed at rest</h2>
          <p className="hint">
            {counts?.connectors ?? 0} {plural(counts?.connectors, "connector")} connected.
            Credentials use envelope encryption, AES-256-GCM, key-encryption key outside the
            database. Only{" "}
            <span className="mono">withCredential(service, fn)</span> decrypts; there is no reveal
            endpoint, and the leak test greps logs, events and receipts for the secret.
          </p>
        </article>
        <article className="panel safety-card">
          <p className="eyebrow">Slip</p>
          <h2>
            {pending} awaiting your tap · {approved} approved
          </h2>
          <p className="hint">
            A slip names the tools, caps and lifetime, and is HMAC-signed. A call outside it is
            denied before anything is forwarded.
          </p>
          <button type="button" className="button small" onClick={() => onNavigate("slips")}>
            Open Slips
          </button>
        </article>
        <article className="panel safety-card">
          <p className="eyebrow">Journal</p>
          <h2>Hash-chained, append-only</h2>
          {verify === null ? (
            <p className="hint">Every decision, call and denial lands here. Verify the chain:</p>
          ) : verify.ok ? (
            <p className="hint">
              Chain intact · <strong>{verify.checked}</strong> events checked.
            </p>
          ) : (
            <p className="hint">
              Broken chain · first bad sequence <strong>#{verify.firstBrokenSeq}</strong>.
            </p>
          )}
          <button type="button" className="button small" onClick={() => void runVerify()} disabled={busy}>
            Verify the chain
          </button>
        </article>
      </section>

      <section className="panel stack" aria-label="Demo run order">
        <p className="eyebrow">Run it in this order</p>
        <ol className="runbook">
          <li>
            <span>Sign in as the owner</span>
            <span className="hint">done — you are {user.name}</span>
          </li>
          <li>
            <span>Connect Notion once, through OAuth, in the browser</span>
            <button type="button" className="link-button" onClick={() => onNavigate("connect")}>
              Connect
            </button>
          </li>
          <li>
            <span>Leave risky tools hidden; expose only what this job needs</span>
            <button type="button" className="link-button" onClick={() => onNavigate("catalog")}>
              Catalog
            </button>
          </li>
          <li>
            <span>Paste the config and prompt into the agent above</span>
            <span className="hint">the key is bound to you</span>
          </li>
          <li>
            <span>The agent requests a slip; approve or trim it in plain language</span>
            <button type="button" className="link-button" onClick={() => onNavigate("slips")}>
              Slips
            </button>
          </li>
          <li>
            <span>Watch calls, approvals and denials arrive on the live feed</span>
            <button type="button" className="link-button" onClick={() => onNavigate("slips")}>
              Live feed
            </button>
          </li>
        </ol>
      </section>
    </section>
  );
}
