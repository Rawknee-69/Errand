# Deviations

Where this build knowingly differs from the master brief, and why. A deviation
is recorded here before it ships; silently working around the brief is not
allowed.

| # | Brief says | We do | Why | Status |
|---|---|---|---|---|
| 1 | TypeScript 6 | TypeScript 7.0.2 | `latest` is 7.0.2 (checked 2026-11-26). TypeScript 7 no longer auto-includes `@types`, so every `tsconfig` lists `types` explicitly, e.g. `["bun"]` and `["bun", "vite/client"]`. | Accepted |
| 2 | MCP TypeScript SDK | `@modelcontextprotocol/server` 2.4.0, `@modelcontextprotocol/client` 2.4.0, `@modelcontextprotocol/hono` 2.0.2 — the stable v2 packages | The 1.x `@modelcontextprotocol/sdk` is superseded; v2 is `latest`. Installed by the ticket that first speaks MCP, not by P0. | Accepted |
| 3 | Real Google Calendar connector | Google Calendar stays a mock in `apps/mock-services` | Google publishes no official remote MCP endpoint for Calendar. Receipts and the demo must label it as mocked. | Accepted |
| 4 | Single-owner login behind a passphrase | Production login stays single-owner; a demo-only user picker can be enabled so seeded friends approve their own slips from separate browser profiles | Needed to demo three friends approving in one run. Off unless explicitly enabled, journaled whenever used. | Accepted |
| 5 | Drizzle ORM | `drizzle-orm` 0.45.4 | `latest` is 0.45.4; the 1.0 line is RC only, so it is not a stable dependency. Revisit when 1.0 ships as `latest`. | Accepted |
| 6 | Upstream results over 256 KB are truncated and flagged | Truncated up to the 10 MB egress response ceiling; a response over that ceiling is refused, not truncated | The egress guard must bound memory before the result reaches the forwarder; the ceiling is configurable with `EGRESS_MAX_RESPONSE_BYTES`. | Accepted |

## P0 notes

- The gateway refuses to boot unless `VAULT_KEY`, `HMAC_KEY` and `JWT_SECRET`
  are each at least 32 bytes. Length is measured in UTF-8 bytes, not characters.
- `apps/web` is a buildable Vite + React placeholder: the control panel proper
  starts at P7.
