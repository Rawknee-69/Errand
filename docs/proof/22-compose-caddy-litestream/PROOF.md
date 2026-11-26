# Proof — P10 · Compose, Caddy, Litestream and the runbook

## Environment

| Item | Value |
|---|---|
| Host | Windows 11, no Docker engine installed |
| Runtime | `bun 1.4.4` |
| Caddy | `2.11.9` (Windows binary) |
| Litestream | `0.5.18` (Windows binary) |
| Compose CLI | `docker compose` v5.8.0 (standalone, `config` only) |
| Browser | `playwright-core` 1.65.1 with cached Chromium |
| CI | CircleCI machine executor `ubuntu-2404:current`, pipeline 8 |

The machine has no Docker engine, so the four services were started natively
from the same sources: gateway on 8790 with a file database, the production web
build on 4173, Litestream replicating that file to a replica directory, and
Caddy in front on `localhost:8088` (HTTP, for the browser walkthrough) and
`https://localhost:8443` (internal CA, for TLS and headers). The compose file
and Caddyfile are the shipped files; only the upstream addresses and paths were
passed through the environment knobs the deployment already has
(`SITE_ADDRESS`, `GATEWAY_UPSTREAM`, `WEB_UPSTREAM`, `LITESTREAM_*`). The stack
was re-run from an empty database and replica after the review fixes below.

## Steps driven

1. **Manifests validate.** `docker compose -f compose.yaml -f deploy/compose.ci.yaml config`
   with a filled `.env` → valid YAML and interpolation
   (`logs/compose-config.txt`; secret values redacted when saved).
   `caddy validate --config deploy/Caddyfile --adapter caddyfile` → valid
   (`logs/caddy-validate.txt`).
2. **Gateway through Caddy.** `GET /api/auth/session` → `{"authenticated":false}`
   (`logs/drive.txt`, `logs/tls-session.txt`).
3. **Routing.** `/`, `/slips`, `/connect` return the web shell; `/api/catalog`
   and `/api/oauth/callback` return 401 JSON from the gateway; `/mcp` returns
   401 from the agent endpoint (`logs/drive.txt`).
4. **TLS and headers.** `https://localhost:8443` sends HSTS, `nosniff`,
   `X-Frame-Options: DENY`, the CSP, `Referrer-Policy`, `Permissions-Policy`
   and no `Server` header (`logs/tls-session.txt`, `logs/tls-index-headers.txt`).
5. **First login and connecting a service.** A cookie login with the owner
   passphrase, an agent key issued, then `POST /api/connectors` against the
   gateway's own MCP endpoint over loopback with that key as the bearer token →
   201, 4 tools discovered, credential sealed in the Vault (`logs/drive.txt`).
6. **Journal.** The UI's "Run the journal check" reports a clean chain
   (`screens/04-desktop-journal.png`); `GET /api/journal/verify` returns
   `{"ok":true,...}` (`logs/drive.txt`).
7. **Replica.** Litestream wrote a snapshot and L0/L1/L2 frames
   (`logs/litestream.err.txt`, `logs/replica-scan.txt`). The replica was restored
   with `litestream restore`; the restored SQLite file contains the journal
   event type `connector.connected` (positive control, exit 0) and neither the
   agent key used as the connector credential nor `VAULT_KEY` (exit 1 each).
   The live database volume gives the same result (`logs/replica-scan.txt`).
8. **UI through Caddy.** Desktop 1440×900: login, Connect, Connectors (shows
   `stack-probe` with 4 tools), Journal, Slips; a nav click to Keys. Phone
   390×844: login and Slips. No console errors or warnings; the only failed
   request is the SSE feed aborted by navigation (`logs/browser-console.txt`,
   `logs/browser-network.txt`, `screens/01`–`07`).
9. **Suite.** `bun test` → 437 pass, 0 fail (`logs/test-output.txt`).
   `bun run typecheck` → 0, with all 5 checks (`logs/typecheck.txt`).
10. **Clean-machine compose.** CircleCI pipeline 8 built all four images with
    `docker compose up -d --build` on a clean Ubuntu 24.04 machine, then
    `scripts/verify-stack.sh` passed every assertion: routing, first login,
    agent key, a real connector, journal, unpublished ports, no secrets in the
    images, and the restored replica scanned for plaintext. Both jobs are green
    (`logs/ci-green.txt`, `logs/circleci-compose-probe.txt`). This is the
    criterion-1 proof and it caught two real defects: the gateway image was
    missing Bun's hoisted `apps/gateway/node_modules` tree, and the compose
    probe's port check misinterpreted an `expose`d port as a published one.

## Findings

| # | Severity | What happened | Artifact | Status |
|---|---|---|---|---|
| 1 | high | A blank optional value from `env_file` (`VAULT_KEY_PREVIOUS=`) reached the keyring as an empty previous key, and blank `WEB_ORIGIN`/`OAUTH_REDIRECT_URI` failed config parsing. A clean `.env` copy could not boot the stack. | `apps/gateway/tests/config.test.ts` ("treats blank optional values as absent") | fixed |
| 2 | low | `HEAD` responses from the web container dropped `Content-Type` and `Content-Length` (Caddy returned 0 length for the shell). | `apps/web/tests/serve.test.ts`; `logs/tls-index-headers.txt` after fix | fixed |
| 3 | low | `GET /api/events` shows `net::ERR_ABORTED` when the browser leaves a screen; that is the SSE stream being torn down, not a server error. | `logs/browser-network.txt` | accepted |
| 4 | blocker | `docker compose up` could not run: this machine has no Docker engine and GitHub Actions refused every job on the account billing lock. The pipeline moved to CircleCI, which then ran the stack on a clean machine. | `.circleci/config.yml`; `logs/ci-green.txt` | fixed |
| 5 | high | Litestream had no healthcheck, so a dead replicator still counted as up. | `compose.yaml` healthcheck; `logs/compose-config.txt`, `scripts/verify-stack.sh` | fixed |
| 6 | high | The runbook restore rewrote `/data/errand.db` while Litestream was still replicating, so its stale position could resume over the restored file. | `docs/RUNBOOK.md` restore steps | fixed |
| 7 | medium | Caddy's `/mcp*` matcher also captured unrelated paths, and `/api` without a trailing slash fell through to the web app. | `deploy/Caddyfile` `@gateway`; `logs/drive.txt` | fixed |
| 8 | low | The native driver restored the replica before Litestream had written the first frame after login, so the positive control failed on the first re-run. | `docs/proof/.../drive.sh` wait; `logs/replica-scan.txt` | fixed |
| 9 | high | The gateway image copied only the root `node_modules`; Bun had hoisted `drizzle-orm` into `apps/gateway/node_modules`, so the container was unhealthy on `Cannot find module 'drizzle-orm/bun-sqlite/migrator'`. | `deploy/Dockerfile.gateway`; first CircleCI compose run | fixed |
| 10 | medium | The reserve worker ran migrations concurrently with the other worker, so one process occasionally crashed before printing JSON. It now opens the already-migrated file. | `apps/gateway/tests/policy/reserve-worker.ts`; `logs/ci-green.txt` | fixed |
| 11 | low | `docker compose port` reported an `expose`d port as published on the CI Compose version; `docker port` is the accurate check. | `scripts/verify-stack.sh`; `logs/circleci-compose-probe.txt` | fixed |

## Not proven

- Automatic ACME for a real public hostname: the CI run uses
  `SITE_ADDRESS=localhost` and Caddy's internal CA. The production hostname and
  DNS record are configuration, not code.
- SSH, firewall, unattended upgrades and host-level hardening are documented
  in `docs/DEPLOYMENT.md`; they were not applied to a host from this session.
- Whole-database encryption is not implemented: the replica holds credential
  rows as ciphertext and operational rows as plaintext. Recorded in
  `docs/DEVIATIONS.md` #7.

Verdict: pass — a clean CircleCI machine built and started all four containers
with `docker compose up -d --build`, and the probe passed every behaviour this
ticket specifies.
