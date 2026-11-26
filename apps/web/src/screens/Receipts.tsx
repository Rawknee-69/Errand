import { useCallback, useState } from "react";
import type { FeedEvent, ReceiptView } from "@errand/shared";
import { api, errorMessage } from "../api.ts";
import { ResourceState } from "../components/ResourceState.tsx";
import { errandTypeLabel, formatTimestamp } from "../format.ts";
import { canUndo, summariseVerifications, undoView, verificationView } from "../receipts.ts";
import { replaceRow } from "../rows.ts";
import { useLiveFeed } from "../useLiveFeed.ts";
import { useResource } from "../useResource.ts";

const UNDO_STATE_CLASS: Record<ReturnType<typeof undoView>["state"], string> = {
  none: "state muted",
  available: "state ok",
  applied: "state ok",
  failed: "state danger",
};

function ReceiptCard({
  receipt,
  busy,
  error,
  onUndo,
}: {
  receipt: ReceiptView;
  busy: boolean;
  error: string | null;
  onUndo: () => void;
}) {
  const verification = verificationView(receipt.verification);
  const undo = undoView(receipt);

  return (
    <li className="receipt-card">
      <div className="card-head">
        <div className="card-title">
          <p className="eyebrow mono" title={receipt.errandType}>
            {errandTypeLabel(receipt.errandType)}
          </p>
          <p className="card-heading">{receipt.summary}</p>
        </div>
        <span className={`badge ${verification.tone}`}>{verification.label}</span>
      </div>

      <p className="hint">{verification.detail}</p>

      <div className="receipt-meta">
        <span className={`class class-${receipt.toolClass}`}>{receipt.toolClass}</span>
        <span className="mono">{formatTimestamp(receipt.createdAt)}</span>
        <span className={UNDO_STATE_CLASS[undo.state]}>{undo.label}</span>
      </div>

      <div className="receipt-undo">
        <p className="hint">{undo.detail}</p>
        {canUndo(receipt) && (
          <button
            type="button"
            className="button small"
            disabled={busy}
            onClick={onUndo}
          >
            {busy ? "Running the inverse…" : undo.state === "failed" ? "Retry undo" : "Undo this change"}
          </button>
        )}
        {error !== null && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}

export function Receipts() {
  const { data, loading, error, reload, setData } = useResource(api.receipts);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [undoErrors, setUndoErrors] = useState<Record<string, string | null>>({});

  const onEvent = useCallback(
    (event: FeedEvent) => {
      if (/^(receipt|undo)\./.test(event.eventType)) void reload(true);
    },
    [reload],
  );
  useLiveFeed(onEvent);

  async function undo(receipt: ReceiptView) {
    setBusyId(receipt.id);
    setUndoErrors((current) => ({ ...current, [receipt.id]: null }));
    try {
      const result = await api.undoReceipt(receipt.id);
      setData((current) =>
        current === null
          ? current
          : {
              receipts: replaceRow(
                current.receipts,
                (row) => row.id === result.receipt.id,
                result.receipt,
              ),
            },
      );
    } catch (caught) {
      setUndoErrors((current) => ({ ...current, [receipt.id]: errorMessage(caught) }));
    } finally {
      setBusyId(null);
    }
  }

  const receipts = data?.receipts ?? [];
  const tally = summariseVerifications(receipts);

  return (
    <section className="screen">
      <header className="screen-head">
        <p className="eyebrow">Receipts</p>
        <h1>What actually happened</h1>
        <p className="lede">
          Each receipt says what ran and what the verifier found. Undo appears only where Errand
          stored a real inverse; sends, spends and deletes say plainly that they cannot be undone.
        </p>
      </header>

      {receipts.length > 0 && (
        <ul className="tally" aria-label="Verification tally">
          <li>
            <strong>{tally.matched}</strong> verified
          </li>
          <li className={tally.mismatched > 0 ? "is-blocked" : ""}>
            <strong>{tally.mismatched}</strong> mismatched
          </li>
          <li>
            <strong>{tally.unverified}</strong> unverified
          </li>
        </ul>
      )}

      <ResourceState
        loading={loading}
        error={error}
        isEmpty={receipts.length === 0}
        loadingCopy="Reading receipts…"
        emptyTitle="No receipts yet"
        emptyCopy="When an agent writes, sends or spends through an approved slip, its receipt lands here with the verifier's verdict."
        onRetry={() => void reload()}
      />

      {receipts.length > 0 && (
        <ul className="receipt-list">
          {receipts.map((receipt) => (
            <ReceiptCard
              key={receipt.id}
              receipt={receipt}
              busy={busyId === receipt.id}
              error={undoErrors[receipt.id] ?? null}
              onUndo={() => void undo(receipt)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
