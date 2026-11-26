import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./api.ts";

// One read-and-reload shape for a screen; a quiet reload keeps the last data visible.
export function useResource<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const loader = useRef(load);

  useEffect(() => {
    loader.current = load;
  }, [load]);

  const reload = useCallback(async (quiet = false) => {
    const request = ++latest.current;
    if (!quiet) setLoading(true);
    try {
      const next = await loader.current();
      if (request !== latest.current) return;
      setData(next);
      setError(null);
    } catch (caught) {
      if (request === latest.current) setError(errorMessage(caught));
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error, reload, setData };
}
