import { useEffect, useState } from "react";
import type { SessionView } from "@errand/shared";
import { api } from "./api.ts";
import { placeholderFor } from "./navigation.ts";
import { useScreen } from "./useScreen.ts";
import { Login } from "./screens/Login.tsx";
import { Shell } from "./screens/Shell.tsx";
import { Connect } from "./screens/Connect.tsx";
import { Catalog } from "./screens/Catalog.tsx";
import { Connectors } from "./screens/Connectors.tsx";
import { Placeholder } from "./screens/Placeholder.tsx";

export function App() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [screen, navigate] = useScreen();

  useEffect(() => {
    let active = true;
    api
      .session()
      .then((view) => {
        if (active) setSession(view);
      })
      .catch(() => {
        if (active) setSession({ authenticated: false, demoMode: false, user: null });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <main className="splash" aria-busy="true">
        <span className="brand-mark" aria-hidden="true" />
        <p>Opening the control panel…</p>
      </main>
    );
  }

  if (session === null || !session.authenticated || session.user === null) {
    return (
      <Login
        demoMode={session?.demoMode ?? false}
        onSession={(view) => {
          setSession(view);
          if (view.authenticated) navigate("connect");
        }}
      />
    );
  }

  async function signOut() {
    await api.logout().catch(() => undefined);
    setSession({ authenticated: false, demoMode: session?.demoMode ?? false, user: null });
  }

  const placeholder = placeholderFor(screen);
  const openConnect = () => navigate("connect");

  return (
    <Shell user={session.user} screen={screen} onNavigate={navigate} onSignOut={signOut}>
      {screen === "connect" ? (
        <Connect onOpenCatalog={() => navigate("catalog")} />
      ) : screen === "catalog" ? (
        <Catalog onOpenConnect={openConnect} />
      ) : screen === "connectors" ? (
        <Connectors onOpenConnect={openConnect} />
      ) : (
        placeholder !== undefined && <Placeholder {...placeholder} />
      )}
    </Shell>
  );
}
