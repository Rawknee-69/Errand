import { useEffect, useState, type ReactNode } from "react";
import type { SessionView } from "@errand/shared";
import { api } from "./api.ts";
import type { Screen } from "./navigation.ts";
import { useScreen } from "./useScreen.ts";
import { Login } from "./screens/Login.tsx";
import { Shell } from "./screens/Shell.tsx";
import { Demo } from "./screens/Demo.tsx";
import { Connect } from "./screens/Connect.tsx";
import { Catalog } from "./screens/Catalog.tsx";
import { Trace } from "./screens/Trace.tsx";
import { Connectors } from "./screens/Connectors.tsx";
import { Slips } from "./screens/Slips.tsx";
import { Receipts } from "./screens/Receipts.tsx";
import { Trust } from "./screens/Trust.tsx";
import { Journal } from "./screens/Journal.tsx";
import { Keys } from "./screens/Keys.tsx";

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
          if (view.authenticated) navigate("demo");
        }}
      />
    );
  }

  async function signOut() {
    await api.logout().catch(() => undefined);
    setSession({ authenticated: false, demoMode: session?.demoMode ?? false, user: null });
  }

  const openConnect = () => navigate("connect");
  const screens: Record<Screen, ReactNode> = {
    demo: <Demo user={session.user} onNavigate={navigate} />,
    connect: <Connect onOpenCatalog={() => navigate("catalog")} />,
    catalog: <Catalog onOpenConnect={openConnect} />,
    connectors: <Connectors onOpenConnect={openConnect} />,
    slips: <Slips />,
    trace: <Trace />,
    receipts: <Receipts />,
    trust: <Trust />,
    journal: <Journal />,
    keys: <Keys />,
  };

  return (
    <Shell user={session.user} screen={screen} onNavigate={navigate} onSignOut={signOut}>
      {screens[screen]}
    </Shell>
  );
}
