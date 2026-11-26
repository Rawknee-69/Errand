import { useCallback, useState, type FormEvent } from "react";
import { AGENT_LIMITS, type FeedEvent, type TrustView } from "@errand/shared";
import { api, errorMessage } from "../api.ts";
import { ResourceState } from "../components/ResourceState.tsx";
import { formatMoney, formatTimestamp } from "../format.ts";
import { replaceRow } from "../rows.ts";
import {
  capsSummary,
  cleanRunView,
  parseTrustCapsEdit,
  tierView,
  trustCapInputs,
  trustTitle,
} from "../trust.ts";
import { useLiveFeed } from "../useLiveFeed.ts";
import { useResource } from "../useResource.ts";

function TrustRow({
  trust,
  onSaved,
}: {
  trust: TrustView;
  onSaved: (view: TrustView) => void;
}) {
  const tier = tierView(trust.tier);
  const runs = cleanRunView(trust.cleanRuns);
  const [edits, setEdits] = useState(() => trustCapInputs(trust.caps));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSetCaps = trust.licenseOffered || trust.tier === "license";

  async function save(event: FormEvent) {
    event.preventDefault();
    const parsed = parseTrustCapsEdit(edits);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.acceptLicense(trust.errandType, parsed.caps);
      onSaved(result.trust);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="trust-card">
      <div className="card-head">
        <div className="card-title">
          <p className="eyebrow mono" title={trust.errandType}>
            {trustTitle(trust)}
          </p>
          <p className="card-heading">{runs.label}</p>
        </div>
        <span className={`badge ${tier.tone}`}>{tier.label}</span>
      </div>

      <p className="hint">{tier.detail}</p>

      {trust.caps !== null && <p className="trust-caps">{capsSummary(trust.caps)}</p>}

      <p className="hint">
        {trust.licenseOffered
          ? "Five clean runs are done. Set the caps, then accept the license."
          : trust.tier === "license"
            ? "This type runs without a tap inside these caps. Lower them whenever you want."
            : `${runs.remaining} more clean ${runs.remaining === 1 ? "run" : "runs"} before a license can be offered.`}
      </p>

      <form className="trust-form" onSubmit={save}>
        <div className="grid-3">
          <label className="field">
            <span>Calls</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={AGENT_LIMITS.calls}
              step={1}
              value={edits.calls}
              disabled={busy || !canSetCaps}
              onChange={(event) => setEdits({ ...edits, calls: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Spend cap (USD)</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={AGENT_LIMITS.spendCents / 100}
              step="0.01"
              value={edits.spendDollars}
              disabled={busy || !canSetCaps}
              onChange={(event) => setEdits({ ...edits, spendDollars: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Minutes</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={AGENT_LIMITS.minutes}
              step={1}
              value={edits.minutes}
              disabled={busy || !canSetCaps}
              onChange={(event) => setEdits({ ...edits, minutes: event.target.value })}
            />
          </label>
        </div>
        <p className="hint">
          Server maxima: {AGENT_LIMITS.calls} calls, {formatMoney(AGENT_LIMITS.spendCents)} and{" "}
          {AGENT_LIMITS.minutes} minutes per errand.
        </p>
        {error !== null && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button primary" disabled={busy || !canSetCaps}>
          {busy
            ? "Saving…"
            : trust.tier === "license"
              ? "Update caps"
              : "Accept license with these caps"}
        </button>
        {!canSetCaps && (
          <p className="hint">
            Caps unlock when the clean runs are done; until then this type stays a learner.
          </p>
        )}
      </form>

      <p className="hint">Updated {formatTimestamp(trust.updatedAt)}</p>
    </li>
  );
}

export function Trust() {
  const { data, loading, error, reload, setData } = useResource(api.trust);

  const onEvent = useCallback(
    (event: FeedEvent) => {
      if (/^trust\./.test(event.eventType)) void reload(true);
    },
    [reload],
  );
  useLiveFeed(onEvent);

  function replace(view: TrustView) {
    setData((current) =>
      current === null
        ? current
        : {
            trust: replaceRow(
              current.trust,
              (row) => row.errandType === view.errandType,
              view,
            ),
          },
    );
  }

  const rows = data?.trust ?? [];

  return (
    <section className="screen">
      <header className="screen-head">
        <p className="eyebrow">Trust</p>
        <h1>What your agent has earned</h1>
        <p className="lede">
          Each kind of errand starts as a learner and needs your tap. Five consecutive clean runs
          offer a license; you choose the caps it may run inside. Any mismatch, scope violation,
          undo or hostile call resets it to a learner.
        </p>
      </header>

      <ResourceState
        loading={loading}
        error={error}
        isEmpty={rows.length === 0}
        loadingCopy="Reading the trust ledger…"
        emptyTitle="No errand types have run yet"
        emptyCopy="A type appears the first time an agent asks for that combination of tools. It starts as a learner with no clean runs."
        onRetry={() => void reload()}
      />

      {rows.length > 0 && (
        <ul className="trust-list">
          {rows.map((trust) => (
            <TrustRow
              key={`${trust.errandType}:${trust.updatedAt}`}
              trust={trust}
              onSaved={replace}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
