import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CapTrim,
  FeedEvent,
  SlipApprovalInput,
  SlipApproved,
  SlipDetail,
  SlipState,
  SlipSummary,
} from "@errand/shared";
import { api, errorMessage } from "../api.ts";
import { OutboxPanel } from "../components/OutboxPanel.tsx";
import { ResourceState } from "../components/ResourceState.tsx";
import { describeFeedEvent, type FeedItem } from "../feed.ts";
import {
  formatCalls,
  formatClock,
  formatDollarsInput,
  formatMoney,
  timeLeftFromIso,
  timeLeftLabel,
} from "../format.ts";
import { describeTrim, describeTrims, parseCapEdits, slipStateView } from "../slips.ts";
import { useLiveFeed, type FeedStatus } from "../useLiveFeed.ts";
import { useOutbox } from "../useOutbox.ts";
import { useSlips } from "../useSlips.ts";

type Decision =
  | { kind: "approved"; result: SlipApproved }
  | { kind: "denied"; slip: SlipDetail };

const STATUS_LABEL: Record<FeedStatus, string> = {
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
};

function StateBadge({ state }: { state: SlipState }) {
  const view = slipStateView(state);
  return <span className={`badge ${view.tone}`}>{view.label}</span>;
}

function TrimList({ trims }: { trims: CapTrim[] }) {
  return (
    <div className="trim-box">
      <p className="eyebrow">Trimmed from the request</p>
      <ul className="trim-list">
        {trims.map((trim) => (
          <li key={trim.field}>{describeTrim(trim)}</li>
        ))}
      </ul>
    </div>
  );
}

type CardProps = {
  detail: SlipDetail;
  onApprove: (input: SlipApprovalInput) => Promise<void>;
  onDeny: () => Promise<void>;
};

function SlipCard({ detail, onApprove, onDeny }: CardProps) {
  const { card } = detail;
  const [callCap, setCallCap] = useState(String(card.callCap));
  const [spendDollars, setSpendDollars] = useState(formatDollarsInput(card.spendCapCents));
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approve" | "deny") {
    setError(null);
    if (decision === "approve") {
      const parsed = parseCapEdits(
        { callCap, spendDollars },
        { callCap: card.callCap, spendCapCents: card.spendCapCents },
      );
      if (!parsed.ok) {
        setError(parsed.message);
        return;
      }
      setBusy("approve");
      try {
        await onApprove(parsed.input);
      } catch (caught) {
        setError(errorMessage(caught));
        setBusy(null);
      }
      return;
    }
    setBusy("deny");
    try {
      await onDeny();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(null);
    }
  }

  return (
    <article className="panel slip-card">
      <header className="slip-head">
        <div className="slip-title">
          <p className="eyebrow">
            {card.tier === "learner" ? "Learner · needs your tap" : "License · within your caps"}
          </p>
          <h2>{card.goal}</h2>
        </div>
        <StateBadge state={card.state} />
      </header>

      <p className="hint">
        {card.services.map((service) => service.name).join(", ")} ·{" "}
        {timeLeftLabel(card.timeLeftSeconds)}
      </p>

      <dl className="slip-caps">
        <div>
          <dt>Calls</dt>
          <dd>{formatCalls(card.callCap)}</dd>
        </div>
        <div>
          <dt>Spend cap</dt>
          <dd>{formatMoney(card.spendCapCents)}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>{timeLeftLabel(card.timeLeftSeconds)}</dd>
        </div>
      </dl>

      <div className="slip-columns">
        <section>
          <h3>It can</h3>
          <ul className="can-list">
            {card.can.map((entry) => (
              <li key={entry.tool}>
                <span>{entry.label}</span>
                <span className={`class class-${entry.class}`}>{entry.class}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>It cannot</h3>
          <ul className="cannot-list">
            {card.cannot.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      </div>

      {card.trims.length > 0 && <TrimList trims={card.trims} />}

      <div className="cap-edit">
        <p className="eyebrow">Tighten before you tap</p>
        <div className="grid-2">
          <label className="field">
            <span>
              Calls <em>asked for {card.callCap}</em>
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={card.callCap}
              step={1}
              value={callCap}
              disabled={busy !== null}
              onChange={(event) => setCallCap(event.target.value)}
            />
          </label>
          <label className="field">
            <span>
              Spend cap (USD) <em>asked for {formatMoney(card.spendCapCents)}</em>
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={card.spendCapCents / 100}
              step="0.01"
              value={spendDollars}
              disabled={busy !== null}
              onChange={(event) => setSpendDollars(event.target.value)}
            />
          </label>
        </div>
        <p className="hint">
          Lowering a cap is signed into the slip and recorded. A cap can never rise above the
          request.
        </p>
      </div>

      {error !== null && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <div className="actions">
        <button
          type="button"
          className="button primary"
          disabled={busy !== null}
          onClick={() => void decide("approve")}
        >
          {busy === "approve" ? "Signing…" : "Approve with these caps"}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy !== null}
          onClick={() => void decide("deny")}
        >
          {busy === "deny" ? "Denying…" : "Deny"}
        </button>
      </div>
    </article>
  );
}

function DecisionPanel({ decision, onDismiss }: { decision: Decision; onDismiss: () => void }) {
  const approved = decision.kind === "approved";
  const goal = approved ? decision.result.slip.goal : decision.slip.slip.goal;
  return (
    <div className={approved ? "panel decision-panel is-approved" : "panel decision-panel"}>
      <p className="eyebrow">{approved ? "Approved" : "Denied"}</p>
      <h2>{goal}</h2>
      {approved ? (
        <>
          <p className="hint">
            Signed as {formatCalls(decision.result.slip.callCap)} and{" "}
            {formatMoney(decision.result.slip.spendCapCents)} ·{" "}
            {timeLeftLabel(decision.result.card.timeLeftSeconds)}
          </p>
          {decision.result.trims.length === 0 ? (
            <p className="hint">No caps were trimmed; the slip runs exactly as requested.</p>
          ) : (
            <TrimList trims={decision.result.trims} />
          )}
        </>
      ) : (
        <p className="hint">
          The agent sees the denial on its next status check and stops rather than retrying.
        </p>
      )}
      <button type="button" className="link-button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

function Recent({ slips }: { slips: SlipSummary[] }) {
  if (slips.length === 0) return null;
  return (
    <section className="recent" aria-label="Decided slips">
      <h2>Decided</h2>
      <ul className="recent-list">
        {slips.map((slip) => (
          <li key={slip.slipId} className="recent-row">
            <div className="recent-copy">
              <p className="recent-goal">{slip.goal}</p>
              <p className="hint">
                {slip.callsUsed} of {formatCalls(slip.callCap)} used ·{" "}
                {formatMoney(slip.spendUsedCents)} of {formatMoney(slip.spendCapCents)} spent ·{" "}
                {timeLeftLabel(timeLeftFromIso(slip.expiresAt))}
              </p>
              {slip.trims.length > 0 && <p className="trim-note">{describeTrims(slip.trims)}</p>}
              {slip.burnedReason !== null && slip.burnedReason !== "" && (
                <p className="trim-note">Burned: {slip.burnedReason}</p>
              )}
            </div>
            <StateBadge state={slip.state} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Feed({ items, status }: { items: FeedItem[]; status: FeedStatus }) {
  return (
    <aside className="panel feed" aria-label="Live feed">
      <header className="feed-head">
        <div>
          <p className="eyebrow">Live feed</p>
          <h2>What just happened</h2>
        </div>
        <span className={`live-state is-${status}`}>
          <span className="live-dot" aria-hidden="true" />
          {STATUS_LABEL[status]}
        </span>
      </header>
      <p className="hint">
        Approvals, calls, denials, burns, verify results and receipts arrive here without a refresh.
      </p>
      {items.length === 0 ? (
        <p className="feed-empty">
          Waiting for the first event. Requests land here the moment an agent asks.
        </p>
      ) : (
        <ol className="feed-list" aria-live="polite">
          {items.map((item) => (
            <li key={item.seq} className={`feed-item tone-${item.tone}`}>
              <span className="feed-time mono">{formatClock(item.at)}</span>
              <div>
                <p className="feed-title">{item.title}</p>
                {item.detail !== "" && <p className="feed-detail">{item.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

export function Slips() {
  const { data, loading, error, reload, removePending } = useSlips();
  const outboxState = useOutbox();
  const [decision, setDecision] = useState<Decision | null>(null);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onEvent = useCallback(
    (event: FeedEvent) => {
      if (/^outbox\./.test(event.eventType)) void outboxState.reload();
      if (!/^(slip|call|receipt)\./.test(event.eventType)) return;
      if (reloadTimer.current !== null) clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => {
        reloadTimer.current = null;
        void reload(true);
      }, 200);
    },
    [reload, outboxState.reload],
  );

  useEffect(
    () => () => {
      if (reloadTimer.current !== null) clearTimeout(reloadTimer.current);
    },
    [],
  );

  const { events, status } = useLiveFeed(onEvent);
  const feedItems = events.map(describeFeedEvent);
  const pending = data?.pending ?? [];
  const recent = data?.recent ?? [];

  async function approve(slipId: string, input: SlipApprovalInput) {
    const result = await api.approveSlip(slipId, input);
    removePending(slipId);
    setDecision({ kind: "approved", result });
    await reload(true);
  }

  async function deny(slipId: string) {
    const slip = await api.denySlip(slipId);
    removePending(slipId);
    setDecision({ kind: "denied", slip });
    await reload(true);
  }

  return (
    <section className="screen">
      <header className="screen-head">
        <p className="eyebrow">Slips</p>
        <h1>What your agents are asking for</h1>
        <p className="lede">
          Each card is one signed permission. Read what it can and cannot do, tighten the caps if you
          want, then approve or deny. The feed shows the work as it happens.
        </p>
      </header>

      {decision !== null && (
        <DecisionPanel decision={decision} onDismiss={() => setDecision(null)} />
      )}

      <OutboxPanel
        data={outboxState.data}
        error={outboxState.error}
        busy={outboxState.busy}
        onCancel={(id) => void outboxState.decide(id, "cancel")}
        onConfirm={(id) => void outboxState.decide(id, "confirm")}
      />

      <div className="slips-layout">
        <div className="stack">
          <ResourceState
            loading={loading}
            error={error}
            isEmpty={pending.length === 0}
            loadingCopy="Reading slips…"
            emptyTitle="Nothing is waiting for you"
            emptyCopy="When an agent requests an errand, its slip appears here with plain-language caps for your tap. Approved and denied slips move to the list below."
            onRetry={() => void reload()}
          />

          {pending.map((detail) => (
            <SlipCard
              key={detail.slip.slipId}
              detail={detail}
              onApprove={(input) => approve(detail.slip.slipId, input)}
              onDeny={() => deny(detail.slip.slipId)}
            />
          ))}

          <Recent slips={recent} />
        </div>

        <div className="feed-rail">
          <Feed items={feedItems} status={status} />
        </div>
      </div>
    </section>
  );
}
