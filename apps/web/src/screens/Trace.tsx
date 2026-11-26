import { useState } from "react";
import type { JournalVerifyResponse, TraceEvent } from "@errand/shared";
import { api, errorMessage } from "../api.ts";
import { describeTraceEvent, familyOf, prettyJson, TRACE_FAMILIES, type TraceFamily } from "../trace.ts";
import { useLiveFeed } from "../useLiveFeed.ts";
import { useResource } from "../useResource.ts";

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function EventRow({ event }: { event: TraceEvent }) {
  const line = describeTraceEvent(event);
  const isVault = event.eventType.startsWith("vault.");
  return (
    <article className={`trace-row family-${familyOf(event.eventType)}`}>
      <header className="trace-head">
        <span className="trace-seq">#{event.seq}</span>
        <span className="trace-title">{line.title}</span>
        <time className="trace-time" dateTime={event.createdAt}>
          {clock(event.createdAt)}
        </time>
      </header>
      {line.detail !== "" && <p className="trace-detail">{line.detail}</p>}
      <details className="trace-details">
        <summary>Message, output and journal row</summary>
        {isVault && (
          <p className="hint">
            The credential value is never written here. The journal records that the vault was
            used, which connector, and why.
          </p>
        )}
        {event.call !== null && (
          <>
            <h3>Message sent to {event.call.tool}</h3>
            <pre>{prettyJson(event.call.arguments)}</pre>
            <h3>{event.call.error === null ? "Output" : "Error"}</h3>
            <pre>{event.call.error === null ? prettyJson(event.call.result ?? "") : event.call.error}</pre>
          </>
        )}
        <h3>Journal payload</h3>
        <pre>{JSON.stringify(event.payload, null, 2)}</pre>
      </details>
    </article>
  );
}

export function Trace() {
  const { data: trace, loading, error: readError, reload } = useResource(api.trace);
  const [family, setFamily] = useState<TraceFamily>("all");
  const [verify, setVerify] = useState<JournalVerifyResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { status } = useLiveFeed(() => {
    void reload(true);
  });

  async function runVerify() {
    setBusy(true);
    try {
      setVerify(await api.verifyJournal());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const shownError = readError ?? error;

  const events = trace?.events ?? [];
  const shown = family === "all" ? events : events.filter((event) => familyOf(event.eventType) === family);
  const calls = events.filter((event) => event.call !== null).length;
  const vaultUses = events.filter((event) => event.eventType === "vault.credential_used").length;

  return (
    <section className="screen">
      <header className="screen-head">
        <p className="eyebrow">Transparency</p>
        <h1>Every decision, message and output</h1>
        <p className="lede">
          Each row is an append-only journal entry. Calls carry the exact message sent and the
          output returned; vault rows say which credential was used, never its value.
        </p>
      </header>

      <ul className="tally" aria-label="Trace totals" aria-busy={loading}>
        <li>
          <strong>{events.length}</strong> events
        </li>
        <li>
          <strong>{calls}</strong> calls with message + output
        </li>
        <li>
          <strong>{vaultUses}</strong> vault uses
        </li>
        <li className={status === "live" ? "is-live" : undefined}>
          <strong>{status}</strong>
        </li>
      </ul>

      {shownError !== null && (
        <div className="panel stack">
          <p className="alert" role="alert">
            {shownError}
          </p>
          <button type="button" className="button secondary" onClick={() => void reload()}>
            Try again
          </button>
        </div>
      )}

      <div className="panel stack">
        <div className="group-head">
          <div>
            <p className="eyebrow">Journal chain</p>
            <h2>Tamper-evident by construction</h2>
          </div>
          {verify !== null &&
            (verify.ok ? (
              <span className="badge ok">Chain intact Â· {verify.checked}</span>
            ) : (
              <span className="badge warn">Broken at #{verify.firstBrokenSeq}</span>
            ))}
        </div>
        <div className="actions">
          <button type="button" className="button small" onClick={() => void runVerify()} disabled={busy}>
            Verify the chain
          </button>
          <button type="button" className="button small" onClick={() => void reload()}>
            Refresh
          </button>
        </div>
      </div>

      <div className="chips" role="group" aria-label="Filter the trace">
        {TRACE_FAMILIES.map((option) => (
          <button
            key={option.id}
            type="button"
            className={family === option.id ? "chip is-selected" : "chip"}
            onClick={() => setFamily(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {!loading && shown.length === 0 ? (
        <div className="panel stack empty">
          <h2>Nothing recorded in this filter yet</h2>
          <p className="hint">
            Connect a service, expose a tool, or let an agent request a slip. Every step lands
            here as it happens.
          </p>
        </div>
      ) : (
        <div className="trace-list">
          {shown.map((event) => (
            <EventRow key={event.seq} event={event} />
          ))}
        </div>
      )}
    </section>
  );
}
