import type { ReactNode } from "react";
import type { AuthUser } from "@errand/shared";
import { nav, type Screen } from "../navigation.ts";

type Props = {
  user: AuthUser;
  screen: Screen;
  onNavigate: (screen: Screen) => void;
  onSignOut: () => void;
  children: ReactNode;
};

type NavListProps = {
  screen: Screen;
  variant: "sidebar" | "tabbar";
  onNavigate: (screen: Screen) => void;
};

function NavList({ screen, variant, onNavigate }: NavListProps) {
  const base = variant === "sidebar" ? "nav-item" : "tab";
  return (
    <>
      {nav.map((item) => (
        <button
          key={item.screen}
          type="button"
          className={item.screen === screen ? `${base} is-current` : base}
          aria-current={item.screen === screen ? "page" : undefined}
          onClick={() => onNavigate(item.screen)}
        >
          {item.label}
        </button>
      ))}
    </>
  );
}

export function Shell({ user, screen, onNavigate, onSignOut, children }: Props) {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>Errand</span>
        </div>
        <div className="who">
          <span className="who-name">{user.name}</span>
          <button type="button" className="link-button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <nav className="sidebar" aria-label="Control panel">
        <p className="sidebar-label">Control panel</p>
        <NavList screen={screen} variant="sidebar" onNavigate={onNavigate} />
      </nav>

      <main className="content" aria-label="Control panel content">
        {children}
      </main>

      <nav className="tabbar" aria-label="Control panel">
        <NavList screen={screen} variant="tabbar" onNavigate={onNavigate} />
      </nav>
    </div>
  );
}
