# Versions

Every dependency is taken from npm's `latest` dist-tag and checked against it,
never from memory. `package.json` pins the exact version it was checked at, and
`bun.lock` records the full resolved tree.

Checked on **2026-11-26** with:

```
npm view <package> dist-tags --json
```

Runtime on the same machine: `bun 1.4.4`, `node v26.13.1`.

## Installed

| Package | Workspace | Version | Dist-tag | Evidence |
|---|---|---|---|---|
| `typescript` | root (dev) | 7.0.2 | `latest` | `latest => 7.0.2` |
| `@types/bun` | root (dev) | 1.4.5 | `latest` | `latest => 1.4.5` |
| `hono` | gateway | 4.13.22 | `latest` | `latest => 4.13.22` |
| `zod` | gateway, mock-services | 4.6.7 | `latest` | `latest => 4.6.7` |
| `@modelcontextprotocol/client` | gateway | 2.4.0 | `latest` | `latest => 2.4.0` |
| `@modelcontextprotocol/server` | gateway, mock-services | 2.4.0 | `latest` | `latest => 2.4.0` |
| `react` | web | 19.3.1 | `latest` | `latest => 19.3.1` |
| `react-dom` | web | 19.3.1 | `latest` | `latest => 19.3.1` |
| `vite` | web (dev) | 8.3.8 | `latest` | `latest => 8.3.8` |
| `@vitejs/plugin-react` | web (dev) | 6.3.0 | `latest` | `latest => 6.3.0` |
| `@types/react` | web (dev) | 19.3.3 | `latest` | `latest => 19.3.3` |
| `@types/react-dom` | web (dev) | 19.3.0 | `latest` | `latest => 19.3.0` |
| `@errand/shared` | gateway | 0.1.0 | n/a | Local workspace (`workspace:*`), no registry version |
| `@errand/mock-services` | gateway (dev) | 0.1.0 | n/a | Local workspace (`workspace:*`), test-only upstream servers |
| `drizzle-orm` | gateway | 0.45.4 | `latest` | `latest => 0.45.4` |
| `drizzle-kit` | gateway (dev) | 0.31.11 | `latest` | `latest => 0.31.11` |

Captured output of the checks above, one line per package:

```
typescript => latest 7.0.2
@types/bun => latest 1.4.5
hono => latest 4.13.22
zod => latest 4.6.7
@modelcontextprotocol/client => latest 2.4.0
@modelcontextprotocol/server => latest 2.4.0
react => latest 19.3.1
react-dom => latest 19.3.1
vite => latest 8.3.8
@vitejs/plugin-react => latest 6.3.0
@types/react => latest 19.3.3
@types/react-dom => latest 19.3.0
drizzle-orm => latest 0.45.4
drizzle-kit => latest 0.31.11
```

## Verified but not installed yet

The brief's remaining stack, checked at the same time. These are installed by
the ticket that first uses them, and this table is re-checked then — a stale
entry here is a bug.

| Package | Dist-tag `latest` | Evidence |
|---|---|---|
| `@modelcontextprotocol/hono` | 2.0.2 | `latest => 2.0.2` |
| `jose` | 6.2.18 | `latest => 6.2.18` |
| `ajv` | 8.20.0 | `latest => 8.20.0` |

`drizzle-orm` is still pre-1.0: its `latest` is 0.45.4 and the 1.0 line is RC
only, so 0.45.4 is the stable choice. See `docs/DEVIATIONS.md`. The database is
SQLite via `bun:sqlite` (Postgres deployment is out of scope; P10 pairs SQLite
with Litestream).

## How a bump is made

1. `npm view <package> dist-tags --json` and read `latest`.
2. `bun add <package>@latest` (or edit `package.json` and `bun install`).
3. `bun run typecheck && bun test`.
4. Update this table with the new version and date.
