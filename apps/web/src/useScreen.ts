import { useCallback, useEffect, useState } from "react";
import { pathFor, screenFromPath, type Screen } from "./navigation.ts";

export function useScreen(): [Screen, (screen: Screen) => void] {
  const [screen, setScreen] = useState<Screen>(() => screenFromPath(window.location.pathname));

  useEffect(() => {
    const onPop = () => {
      setScreen(screenFromPath(window.location.pathname));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((next: Screen) => {
    const path = pathFor(next);
    if (window.location.pathname !== path) {
      window.history.pushState(null, "", path);
    }
    setScreen(next);
    // Screen change is a new page: keep the heading in view, not the old offset.
    window.scrollTo({ top: 0 });
  }, []);

  return [screen, navigate];
}
