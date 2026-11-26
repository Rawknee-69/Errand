import { useState, type FormEvent } from "react";
import type { SessionView } from "@errand/shared";
import { api, errorMessage } from "../api.ts";

type Props = {
  demoMode: boolean;
  onSession: (session: SessionView) => void;
};

export function Login({ demoMode, onSession }: Props) {
  const [mode, setMode] = useState<"owner" | "demo">("owner");
  const [passphrase, setPassphrase] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSession(mode === "demo" ? await api.demoLogin(name.trim()) : await api.login(passphrase));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>Errand</span>
        </div>
        <h1>Your agents get one key. Nothing else.</h1>
        <p className="lede">
          Errand is the single doorway to your accounts. Connect a service once, then hand an agent
          one scoped job at a time.
        </p>

        {demoMode && (
          <div className="segmented" role="tablist" aria-label="Sign-in mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "owner"}
              className={mode === "owner" ? "is-selected" : ""}
              onClick={() => {
                setMode("owner");
                setError(null);
              }}
            >
              Owner
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "demo"}
              className={mode === "demo" ? "is-selected" : ""}
              onClick={() => {
                setMode("demo");
                setError(null);
              }}
            >
              Demo guest
            </button>
          </div>
        )}

        <form onSubmit={submit} className="stack">
          <input type="text" name="username" autoComplete="username" value="owner" readOnly hidden />
          {mode === "demo" ? (
            <label className="field">
              <span>Your name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                placeholder="Maya Chen"
                required
              />
            </label>
          ) : (
            <label className="field">
              <span>Owner passphrase</span>
              <input
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
          )}

          {mode === "demo" && (
            <p className="hint">
              Demo mode is on. Each demo sign-in is written to the journal, and each guest sees only
              their own connectors and slips.
            </p>
          )}

          {error !== null && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="button primary" disabled={busy}>
            {busy ? "Signing in…" : mode === "demo" ? "Enter as guest" : "Open control panel"}
          </button>
        </form>
      </section>
      <p className="login-foot">One owner. One vault. No credential ever reaches your agent.</p>
    </main>
  );
}
