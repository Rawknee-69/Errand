# Report — #22 P10 · Compose, Caddy, Litestream and the runbook

## Files built

Deployment

- `compose.yaml` — gateway, web, Litestream and Caddy; named volumes for the
  database, replica, Litestream state and Caddy's certificates; only Caddy
  publishes ports; gateway and web read-only with all capabilities dropped;
  gateway, web and Litestream are health-gated (Litestream on its replication
  config).
- `deploy/Dockerfile.gateway` — Bun 1.4.4, production dependencies including
  Bun's hoisted `apps/gateway/node_modules`, migrations, non-root, image
  healthcheck.
- `deploy/Dockerfile.web` — Vite build stage and a Bun static server, non-root.
- `deploy/Caddyfile` — TLS, security headers, HSTS on HTTPS, `/api` and `/mcp`
  plus their subpaths to the gateway (SSE with `flush_interval -1`), everything
  else to the web app.
- `deploy/litestream.yml` — one database, file replica, one week of snapshots,
  metadata outside the database volume.
- `deploy/compose.ci.yaml` — loopback-only egress for the CI probe.
- `.dockerignore`, `.env.example` (`SITE_ADDRESS`).
- `.circleci/config.yml` — typecheck/test job plus a clean Ubuntu 24.04 machine
  job that runs `docker compose up --build` and `scripts/verify-stack.sh`.

Code

- `apps/web/src/serve.ts` — production static server: SPA fallback, immutable
  asset cache, path-traversal refusal, method refusal, correct HEAD metadata,
  validated `WEB_PORT`.
- `apps/web/tests/serve.test.ts` — behaviour tests for the HTTP interface.
- `apps/gateway/src/config.ts` — blank optional env values are treated as
  absent (compose `env_file` supplies `VAULT_KEY_PREVIOUS=""`).
- `apps/gateway/tests/config.test.ts` — regression for that.
- `apps/gateway/src/db/client.ts` — `openDatabase` for workers that share an
  already-migrated file.
- `apps/gateway/tests/policy/reserve-worker.ts` — opens that file without
  racing the migrator; `apps/gateway/tests/agent/call.test.ts` now surfaces a
  worker's stderr instead of failing on empty JSON.
- `scripts/lib.sh` — the shared shell output helpers.
- `scripts/probe-stack.sh` — shared probe (routing, login, agent key,
  connector, journal).
- `scripts/verify-stack.sh` — compose-only checks: unpublished ports,
  Litestream health, no secrets in images, restored replica scanned for
  plaintext.

Docs and proof

- `docs/RUNBOOK.md`, `docs/DEPLOYMENT.md`, `docs/DEVIATIONS.md` (#7),
  `docs/VERSIONS.md` (deployment images).
- `docs/proof/22-compose-caddy-litestream/` — `PROOF.md`, `drive.sh`,
  `browser.ts`, 7 screenshots, logs.

## Exact commands

```sh
bun install --frozen-lockfile
bun run typecheck
bun test
docker compose -f compose.yaml -f deploy/compose.ci.yaml config
caddy validate --config deploy/Caddyfile --adapter caddyfile
# native stack (no Docker engine on this machine)
bun run apps/gateway/src/index.ts                       # :8790
WEB_ROOT=apps/web/dist WEB_PORT=4173 bun run apps/web/src/serve.ts
litestream replicate -config deploy/litestream.yml
SITE_ADDRESS=http://localhost:8088 caddy run --config deploy/Caddyfile --adapter caddyfile
SITE_ADDRESS=https://localhost:8443 caddy run --config deploy/Caddyfile --adapter caddyfile
bash docs/proof/22-compose-caddy-litestream/drive.sh
bun docs/proof/22-compose-caddy-litestream/browser.ts
litestream restore -config deploy/litestream.yml -force -o <stack>/restored.db <stack>/data/errand.db
```

## Test output

```
$ bun test
 437 pass
 0 fail
 1562 expect() calls
Ran 437 tests across 57 files. [6.16s]

$ bun run typecheck
@errand/shared typecheck: Exited with code 0
@errand/mock-services typecheck: Exited with code 0
@errand/web typecheck: Exited with code 0
@errand/gateway typecheck: Exited with code 0
✓ 5 checks passed: comments, installed, journal-last-event, no-any, oauth-verifier
```

CircleCI pipeline 8 (clean `ubuntu-2404:current` machine): `checks` success,
`compose` success (`logs/ci-green.txt`). The compose job ran
`docker compose up -d --build` and `scripts/verify-stack.sh` passed every
assertion (`logs/circleci-compose-probe.txt`).

Full logs: `docs/proof/22-compose-caddy-litestream/logs/test-output.txt`,
`typecheck.txt`, `ci-green.txt` and `circleci-compose-probe.txt`.

## Versions

No npm dependency changed. Deployment images pinned after checking the latest
release tags on 2026-11-26: Caddy `2.11.9`, Litestream `0.5.18`, Bun
`1.4.4-slim`. Compose CLI v5.8.0 validated the manifests.

## Unverified

- Automatic ACME for a real public hostname: the CI run uses
  `SITE_ADDRESS=localhost` and Caddy's internal CA. DNS and the production
  hostname are deployment configuration, not code.
- Host hardening (SSH, firewall, unattended upgrades) is documented, not
  applied.
- Whole-database encryption is not implemented: the replica holds credentials
  as ciphertext and operational rows as plaintext, recorded as deviation #7.

## Code review

First pass found: duplicate probe scripts (extracted to `scripts/probe-stack.sh`),
repeated Caddy proxy blocks (collapsed to one named matcher), commented-out S3
YAML (moved to the runbook), hard-coded volume names (now read from container
mounts), unvalidated `WEB_PORT` (validated with tests), unguarded `VAULT_KEY`
and a broken restore command in the runbook (`-config`, database path, `-force`).
All addressed.

Second pass, after those fixes, found and closed:

- `scan_present`/`scan_absent` and the `pass`/`fail` helpers were duplicated;
  one `scan` helper and a shared `scripts/lib.sh` remain, and the mount lookup
  is one function.
- The probe still wrote a fixed `/tmp/errand-connector.json`; it now uses
  `mktemp` and cleans up with the cookie jar.
- Litestream had no healthcheck, so a dead replicator counted as up; it now has
  one and `scripts/verify-stack.sh` requires `healthy`.
- The runbook restored `/data/errand.db` while Litestream was still replicating;
  both writers now stop and the replication state is cleared first.
- Caddy's `/mcp*` also matched unrelated paths and `/api` fell to the web app;
  the matcher now names `/api` and `/mcp` and their subpaths.
- The native driver restored before Litestream's first frame; it now waits for
  the one-second sync.
- A proof citation pointed at a non-existent log, the replica scan ended before
  its credential row, and the saved compose config now states that its secret
  values are redacted.

The clean-runner compose pass then found and closed three more:

- The gateway image missed Bun's hoisted `apps/gateway/node_modules`, so the
  container died on `drizzle-orm/bun-sqlite/migrator`; the Dockerfile now copies
  the whole installed tree.
- The reserve worker raced the migrator when two processes opened the same new
  file; it now opens without migrating, and the test reports a worker's stderr.
- `docker compose port` reported an exposed port as published; the probe uses
  `docker port`, which only reports real host mappings.

No `any`, `@ts-ignore` or double assertion was found.

## Proof

- `docs/proof/22-compose-caddy-litestream/PROOF.md` — environment, steps,
  findings and pass verdict.
- `docs/proof/22-compose-caddy-litestream/logs/ci-green.txt` — CircleCI
  pipeline 8, both jobs green.
- `docs/proof/22-compose-caddy-litestream/logs/circleci-compose-probe.txt` —
  every probe assertion from the clean-machine compose run.
- `docs/proof/22-compose-caddy-litestream/screens/` — desktop 1440×900 and
  phone 390×844 walkthrough.
- `docs/proof/22-compose-caddy-litestream/logs/drive.txt` — native routing,
  login, connector and journal probe.
- `docs/proof/22-compose-caddy-litestream/logs/replica-scan.txt` — restored
  replica scanned for the plaintext credential and the KEK.

## Status

All acceptance criteria are met. Criterion 1 is proven by CircleCI pipeline 8
on a clean Ubuntu 24.04 machine; the native run covers the browser walkthrough,
TLS headers and the replica scan. Close with
`bun run scripts/complete-ticket.ts 22 docs/proof/22-compose-caddy-litestream/REPORT.md`.
No further ticket is runnable after #22; #20 P9 · Demo fixtures and the
“Settle It” run is closed.
