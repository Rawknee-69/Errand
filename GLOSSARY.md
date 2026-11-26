# Glossary

Errand's vocabulary. These terms are load-bearing: several pairs are easy to
confuse, and using them loosely produces specs that read correctly and build
the wrong thing. The source of truth is the master build brief; this file is
the vocabulary the brief mandates for code and UI.

## Core

**Gateway** — the Errand backend. An MCP client toward upstream services and
an MCP server toward agents. Contains no LLM and no model calls; it is plain
strict code, "the only gatekeeper with no AI to trick."

**Bottom layer** — Errand's own connections out to every upstream MCP server.
Errand sees all of their tools. Never exposed to the agent directly.

**Top layer** — what the agent sees: one URL, one agent key, four tools, and
only what an approved slip allows.

**Connector** — a saved connection to one upstream MCP server (URL, transport,
auth type). Credentials live in the Vault, never on the connector row.

**Catalog** — every tool discovered across every connector, each classified
and pinned by definition hash.

**Slip** — a signed permission document for one errand: which tools, which
constraints, what caps, what tier, when it expires. HMAC-signed; what the human
approved is byte-for-byte what runs.

**Errand** — one scoped job. The slip is the permission for it; the errand is
the work. Not interchangeable.

**Tier** — `learner` (a human approves every slip) or `license` (auto-approved
within caps the human set). Spend always needs a human tap, in both tiers.

**Errand type** — deterministic hash of the sorted `service__tool` list plus
the canonical constraint *shape* (keys only, not values). Identifies a *kind*
of errand for the trust ledger. Goal text is not part of it.

**Decoy** — a plausible, inert bait tool (`export_all_contacts`,
`transfer_all_funds`, `delete_all_data`). Touching one burns the slip.

**Burned** — a slip permanently revoked, with its capability revoked. Causes:
a decoy hit, or a second scope violation.

**Verifier** — optional per-connector adapter code that re-reads the real app
after a write, send or spend, and reports whether the change actually landed.

**Receipt** — the human-readable result of an errand: what ran, what the
verifier found (`matched` / `mismatched` / `unverified`), and undo where an
inverse exists. Never claims verification it did not perform.

**Journal** — append-only, hash-chained log of every decision and event.
Tamper-evident: `GET /api/journal/verify` reports the first broken sequence.

**Vault** — the encrypted store of every upstream credential. The only module
that decrypts. Exposes `withCredential(serviceId, fn)` and nothing else. There
is no "reveal secret" feature anywhere.

**Agent key** — the single secret the human pastes into their agent, format
`errand_<base64url>`, shown once, stored only as a SHA-256 hash.

## Tool classes

**read**, **write**, **send**, **delete**, **spend**, **unknown** — in
increasing order of danger, except that `unknown` is never allowed. Conflict
between classifier sources resolves to the *more dangerous* class. A human may
tighten a class freely; loosening it needs explicit confirmation and is
journaled.

## Words to avoid

- **"MCP firewall"** — Errand is a valet key and a single doorway, not a
  per-call permission prompt.
- **"Sandbox"** — nothing is sandboxed; access is scoped.
- **"Undo"** for sends and payments — those cannot be undone, and the UI says
  so plainly.
