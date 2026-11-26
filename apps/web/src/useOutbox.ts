import { useCallback, useEffect, useRef, useState } from "react";
import type { OutboxItem } from "@errand/shared";
import { api, errorMessage } from "./api.ts";

export type OutboxView = {
  pending: OutboxItem[];
  recent: OutboxItem[];
};

function isPending(item: OutboxItem): boolean {
  return item.state === "held" || item.state === "needs_human";
}

export function useOutbox() {
  const [data, setData] = useState<OutboxView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const request = ++latest.current;
    try {
      const { items } = await api.outbox();
      if (request !== latest.current) return;
      setData({
        pending: items.filter(isPending),
        recent: items.filter((item) => !isPending(item)).slice(0, 8),
      });
      setError(null);
    } catch (caught) {
      if (request === latest.current) setError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const decide = useCallback(
    async (id: string, action: "cancel" | "confirm") => {
      setBusy(id);
      try {
        if (action === "cancel") await api.cancelOutbox(id);
        else await api.confirmOutbox(id);
        await reload();
      } catch (caught) {
        setError(errorMessage(caught));
        await reload();
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );

  return { data, error, busy, reload, decide };
}
