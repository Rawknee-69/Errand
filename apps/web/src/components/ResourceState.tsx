import type { ReactNode } from "react";

type Props = {
  loading: boolean;
  error: string | null;
  isEmpty: boolean;
  loadingCopy: string;
  emptyTitle: string;
  emptyCopy: string;
  emptyAction?: ReactNode;
  onRetry: () => void;
};

export function ResourceState({
  loading,
  error,
  isEmpty,
  loadingCopy,
  emptyTitle,
  emptyCopy,
  emptyAction,
  onRetry,
}: Props) {
  if (loading) {
    return isEmpty ? (
      <p className="panel hint" aria-busy="true">
        {loadingCopy}
      </p>
    ) : null;
  }

  if (error !== null) {
    return (
      <div className="panel stack">
        <p className="alert" role="alert">
          {error}
        </p>
        <button type="button" className="button secondary" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  if (!isEmpty) return null;

  return (
    <div className="panel stack empty">
      <h2>{emptyTitle}</h2>
      <p className="lede">{emptyCopy}</p>
      {emptyAction}
    </div>
  );
}
