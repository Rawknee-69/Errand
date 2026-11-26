import { useState } from "react";
import type { JournalVerifyResponse } from "@errand/shared";
import { api, errorMessage } from "../api.ts";
import { formatClock } from "../format.ts";
import { journalVerdict } from "../journal.ts";

export function Journal() {
  const [result, setResult] = useState<JournalVerifyResponse | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.verifyJournal());
      setCheckedAt(new Date().toISOString());
    } catch (caught) {
      setResult(null);
      setCheckedAt(null);
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const verdict = result === null ? null : journalVerdict(result);
  const ok = verdict?.tone === "ok";

  return (
    <section className="screen">
      <header className="screen-head">
        <p className="eyebrow">Journal</p>
        <h1>Is the record intact?</h1>
        <p className="lede">
          Errand keeps an append-only, hash-chained journal of every decision and event. This check
          recomputes the chain from the first entry and names the first sequence that does not
          match.
        </p>
      </header>

      <div className="panel stack">
        <div className="actions">
          <button type="button" className="button primary" disabled={busy} onClick={() => void run()}>
            {busy ? "Recomputing the chain…" : result === null ? "Run the journal check" : "Run again"}
          </button>
          {checkedAt !== null && (
            <span className="hint">Checked at {formatClock(checkedAt)}</span>
          )}
        </div>

        {error !== null && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        {verdict === null ? (
          <p className="hint">
            Nothing is checked until you run it. A clean result means every hash and sequence
            agrees.
          </p>
        ) : (
          <div
            className={ok ? "journal-verdict is-ok" : "journal-verdict is-broken"}
            role="status"
          >
            <div className="card-head">
              <div className="card-title">
                <p className="eyebrow">{ok ? "Clean result" : "Broken record"}</p>
                <h2>{verdict.title}</h2>
              </div>
              <span className={`badge ${verdict.tone}`}>{ok ? "Verified" : "Failed"}</span>
            </div>
            <p className="hint">{verdict.detail}</p>
            {verdict.brokenSeq !== null && (
              <p className="journal-seq">
                First broken sequence: <span className="mono">{verdict.brokenSeq}</span>
              </p>
            )}
            {ok && (
              <p className="journal-seq">
                Entries checked: <span className="mono">{verdict.checked}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
