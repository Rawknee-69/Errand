import { useCallback, useEffect, useRef, useState } from "react";
import type { SlipDetail, SlipSummary } from "@errand/shared";
import { api, errorMessage } from "./api.ts";

type SlipsView = {
  pending: SlipDetail[];
  recent: SlipSummary[];
};

export function useSlips() {
  const [data, setData] = useState<SlipsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const reload = useCallback(async (quiet = false) => {
    const request = ++latest.current;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const { slips } = await api.slips();
      const pending = slips.filter((slip) => slip.state === "pending");
      const details = await Promise.all(pending.map((slip) => api.slip(slip.slipId)));
      if (request !== latest.current) return;
      setData({
        // A slip can expire between the list read and its detail read; filter again.
        pending: details.filter((detail) => detail.slip.state === "pending"),
        recent: slips.filter((slip) => slip.state !== "pending").slice(0, 12),
      });
    } catch (caught) {
      if (request === latest.current) setError(errorMessage(caught));
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const removePending = useCallback((slipId: string) => {
    setData((current) =>
      current === null
        ? current
        : {
            ...current,
            pending: current.pending.filter((detail) => detail.slip.slipId !== slipId),
          },
    );
  }, []);

  return { data, loading, error, reload, removePending };
}
