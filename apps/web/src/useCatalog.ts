import { useCallback } from "react";
import type { CatalogToolView } from "@errand/shared";
import { api } from "./api.ts";
import { replaceRow } from "./rows.ts";
import { useResource } from "./useResource.ts";

export function useCatalog() {
  const { data, loading, error, reload, setData } = useResource(api.catalog);

  const replaceTool = useCallback(
    (tool: CatalogToolView) => {
      setData((current) =>
        current === null
          ? current
          : { ...current, tools: replaceRow(current.tools, (row) => row.id === tool.id, tool) },
      );
    },
    [setData],
  );

  return { data, loading, error, reload, replaceTool };
}
