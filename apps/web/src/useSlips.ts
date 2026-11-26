import { useCallback } from "react";
import type { SlipDetail, SlipSummary } from "@errand/shared";
import { api } from "./api.ts";
import { useResource } from "./useResource.ts";

type SlipsView = {
  pending: SlipDetail[];
  recent: SlipSummary[];
};

async function loadSlips(): Promise<SlipsView> {
  const { slips } = await api.slips();
  const pending = slips.filter((slip) => slip.state === "pending");
  const details = await Promise.all(pending.map((slip) => api.slip(slip.slipId)));
  return {
    // A slip can expire between the list read and its detail read; filter again.
    pending: details.filter((detail) => detail.slip.state === "pending"),
    recent: slips.filter((slip) => slip.state !== "pending").slice(0, 12),
  };
}

export function useSlips() {
  const { data, loading, error, reload, setData } = useResource(loadSlips);

  const removePending = useCallback(
    (slipId: string) => {
      setData((current) =>
        current === null
          ? current
          : {
              ...current,
              pending: current.pending.filter((detail) => detail.slip.slipId !== slipId),
            },
      );
    },
    [setData],
  );

  return { data, loading, error, reload, removePending };
}
