import { useCallback, useState } from "react";
import type { FeedEvent, ReceiptView } from "@errand/shared";
import { api, errorMessage } from "../api.ts";
import { formatTimestamp } from "../format.ts";
import {
  canUndo,
  errandTypeLabel,
  summariseVerifications,
  undoView,
  verificationView,
} from "../receipts.ts";
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
      <div className="receipt-head">
        <div className="receipt-title">
          <p className="eyebrow mono" title={receipt.errandType}>
            {errandTypeLabel(receipt.errandType)}
          </p>
          <p className="receipt-summary">{receipt.summary}</p>
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
  const [undoErrors, setUndoErrors] = useState<Record<string, string>>({});

  const onEvent = useCallback(
    (event: FeedEvent) => {
      if (/^(receipt|undo)\./.test(event.eventType)) void reload(true);
    },
    [reload],
  );
  useLiveFeed(onEvent);

  async function undo(receipt: ReceiptView) {
    setBusyId(receipt.id);
    setUndoErrors((current) => {
      const next = { ...current };
      delete next[receipt.id];
      return next;
    });
    try {
      const result = await api.undoReceipt(receipt.id);
      setData((current) =>
        current === null
          ? current
          : {
              receipts: current.receipts.map((row) =>
                row.id === result.receipt.id ? result.receipt : row,
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

      {loading && receipts.length === 0 && (
        <p className="panel hint" aria-busy="true">
          Reading receipts…
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

      {!loading && error === null && receipts.length === 0 && (
        <div className="panel stack empty">
          <h2>No receipts yet</h2>
          <p className="lede">
            When an agent writes, sends or spends through an approved slip, its receipt lands here
            with the verifier's verdict.
          </p>
        </div>
      )}

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
