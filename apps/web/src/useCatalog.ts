import { useCallback, useEffect, useState } from "react";
import type { CatalogResponse, CatalogToolView } from "@errand/shared";
import { api, errorMessage } from "./api.ts";

export function useCatalog() {
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.catalog());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const replaceTool = useCallback((tool: CatalogToolView) => {
    setData((current) =>
      current === null
        ? current
        : { ...current, tools: current.tools.map((row) => (row.id === tool.id ? tool : row)) },
    );
  }, []);

  return { data, loading, error, reload, replaceTool };
}
