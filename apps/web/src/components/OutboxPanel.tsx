import { useEffect, useState } from "react";
import { isPendingOutboxState, type OutboxItem } from "@errand/shared";
import { formatMoney, timeLeftFromIso } from "../format.ts";
import type { OutboxView } from "../useOutbox.ts";

function secondsLeft(item: OutboxItem, now: number): number {
  return timeLeftFromIso(item.releaseAt ?? item.expiresAt, now);
}

function outcomeNote(item: OutboxItem): string {
  if (item.state === "held") return "Sends when its window closes unless you stop it";
  if (item.state === "needs_human") return "No money moves without your tap";
  if (item.state === "releasing") return "Running now";
  if (item.state === "failed") return item.reason ?? "The upstream call failed, so nothing moved";
  if (item.state === "confirmed") return "The money moved after your tap";
  if (item.state === "released") return item.reason ?? "The cancel window closed and it was sent";
  if (item.state === "cancelled") {
    return item.reason === "human_cancelled" || item.reason === null
      ? "You stopped it; nothing was sent"
      : item.reason;
  }
  if (item.reason === null || item.reason === "expired") return "Its window closed before it could run";
  return `It was not sent: ${item.reason}`;
}

function StateBadge({ item }: { item: OutboxItem }) {
  if (item.state === "held") return <span className="badge accent">Held</span>;
  if (item.state === "needs_human") return <span className="badge accent">Needs your tap</span>;
  if (item.state === "releasing") return <span className="badge muted">Releasing…</span>;
  if (item.state === "confirmed") return <span className="badge ok">Confirmed</span>;
  if (item.state === "failed") return <span className="badge danger">Failed</span>;
  if (item.state === "released") return <span className="badge ok">Released</span>;
  if (item.state === "cancelled") return <span className="badge muted">Stopped</span>;
  return <span className="badge danger">Expired</span>;
}

function ItemRow({
  item,
  now,
  busy,
  onCancel,
  onConfirm,
}: {
  item: OutboxItem;
  now: number;
  busy: string | null;
  onCancel: (id: string) => void;
  onConfirm: (id: string) => void;
}) {
  const pending = isPendingOutboxState(item.state);
  const left = secondsLeft(item, now);
  return (
    <li className="outbox-row">
      <div className="outbox-copy">
        <p className="outbox-tool">
          {item.tool}
          {item.toolClass === "spend" && item.amountCents > 0 && (
            <strong className="outbox-amount">{formatMoney(item.amountCents)}</strong>
          )}
        </p>
        <p className="hint">
          {item.goal === "" ? item.connectorName : `${item.goal} · ${item.connectorName}`}
        </p>
        <p className="hint">
          {item.state === "held"
            ? `Sends in ${left}s unless you stop it`
            : item.state === "needs_human"
              ? `Waiting for your tap · expires in ${left}s`
              : outcomeNote(item)}
        </p>
      </div>
      <div className="outbox-actions">
        <StateBadge item={item} />
        {pending && (
          <>
            <button
              type="button"
              className="button secondary"
              disabled={busy !== null}
              onClick={() => onCancel(item.id)}
            >
              {busy === item.id ? "Stopping…" : item.toolClass === "send" ? "Stop it" : "Deny"}
            </button>
            {item.toolClass === "spend" && (
              <button
                type="button"
                className="button primary"
                disabled={busy !== null}
                onClick={() => onConfirm(item.id)}
              >
                {busy === item.id ? "Confirming…" : "Confirm spend"}
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

export function OutboxPanel({
  data,
  error,
  busy,
  onCancel,
  onConfirm,
}: {
  data: OutboxView | null;
  error: string | null;
  busy: string | null;
  onCancel: (id: string) => void;
  onConfirm: (id: string) => void;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const pending = data?.pending ?? [];
  const recent = data?.recent ?? [];
  if (error === null && pending.length === 0 && recent.length === 0) return null;

  return (
    <section className="panel outbox" aria-label="Outbox and spend tap">
      <header className="outbox-head">
        <div>
          <p className="eyebrow">Outbox and spend tap</p>
          <h2>Sends wait 30 seconds. Spends wait for you.</h2>
        </div>
      </header>
      <p className="hint">
        A send is cancellable until its window closes. A spend never moves without a separate tap
        here, on either tier.
      </p>
      {error !== null && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {pending.length > 0 && (
        <ul className="outbox-list">
          {pending.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              now={now}
              busy={busy}
              onCancel={onCancel}
              onConfirm={onConfirm}
            />
          ))}
        </ul>
      )}
      {pending.length === 0 && (
        <p className="feed-empty">Nothing is waiting on you right now.</p>
      )}
      {recent.length > 0 && (
        <>
          <p className="eyebrow outbox-recent-title">Just decided</p>
          <ul className="outbox-list outbox-recent">
            {recent.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                now={now}
                busy={busy}
                onCancel={onCancel}
                onConfirm={onConfirm}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
