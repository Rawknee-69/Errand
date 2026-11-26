export function formatTimestamp(iso: string | null): string {
  if (iso === null) return "never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown time";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatDollarsInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function formatMoney(cents: number): string {
  return `$${formatDollarsInput(cents)}`;
}

export function formatCalls(calls: number): string {
  return `${calls} ${calls === 1 ? "call" : "calls"}`;
}

export function timeLeftLabel(seconds: number): string {
  if (seconds <= 0) return "expired";
  if (seconds < 60) return "under a minute left";
  if (seconds < 3_600) return `${Math.ceil(seconds / 60)} min left`;
  return `${Math.ceil(seconds / 3_600)} h left`;
}

export function timeLeftFromIso(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((Date.parse(iso) - now) / 1_000));
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
