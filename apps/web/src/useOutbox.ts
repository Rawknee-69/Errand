import { useCallback, useState } from "react";
import { isPendingOutboxState, type OutboxItem } from "@errand/shared";
import { api, errorMessage } from "./api.ts";
import { useResource } from "./useResource.ts";

export type OutboxView = {
  pending: OutboxItem[];
  recent: OutboxItem[];
};

async function loadOutbox(): Promise<OutboxView> {
  const { items } = await api.outbox();
  return {
    pending: items.filter((item) => isPendingOutboxState(item.state)),
    recent: items.filter((item) => !isPendingOutboxState(item.state)).slice(0, 8),
  };
}

export function useOutbox() {
  const { data, error, reload } = useResource(loadOutbox);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const decide = useCallback(
    async (id: string, action: "cancel" | "confirm") => {
      setBusy(id);
      setActionError(null);
      try {
        if (action === "cancel") await api.cancelOutbox(id);
        else await api.confirmOutbox(id);
        await reload();
      } catch (caught) {
        setActionError(errorMessage(caught));
        await reload();
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );

  return { data, error: error ?? actionError, busy, reload, decide };
}
