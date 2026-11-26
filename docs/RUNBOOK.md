# Runbook

Operating the single-box deployment: four containers behind one Caddy
hostname. The gateway and web app are never published directly; only Caddy
listens on 80 and 443.

## What runs

| Service | Image | Reachable at | State |
|---|---|---|---|
| `caddy` | `caddy:2.11.9` | public 80/443, TLS | `caddy-data`, `caddy-config` volumes |
| `gateway` | `deploy/Dockerfile.gateway` | `gateway:8787` on the compose network | `errand-data` volume (`/data/errand.db`) |
| `web` | `deploy/Dockerfile.web` | `web:3000` on the compose network | stateless |
| `litestream` | `litestream/litestream:0.5.18` | internal only | `errand-replica`, `litestream-state` volumes |

Caddy sends `/mcp*` (the agent endpoint), `/api/*` (including
`/api/oauth/callback`) to the gateway. Everything else is the
web app, whose server falls back to `index.html` so client routes survive a
refresh.

## Boot from a clean checkout

Prerequisites: a Linux host with Docker Engine and the Compose plugin, a DNS
`A`/`AAAA` record pointing at the host, and ports 80 and 443 open. Caddy
obtains the certificate itself; nothing else needs a public port.

```sh
git clone https://github.com/Rawknee-69/Errand.git
cd Errand
cp .env.example .env
chmod 600 .env
```

Fill every blank in `.env` with fresh material:

```sh
openssl rand -base64 32   # VAULT_KEY
openssl rand -base64 32   # HMAC_KEY
openssl rand -base64 32   # JWT_SECRET
```

Set `OWNER_PASSPHRASE` to a unique 12+ character passphrase and
`SITE_ADDRESS` to the bare hostname, for example `errand.example.com` (no
scheme, no trailing slash). Then:

```sh
docker compose up -d --build
docker compose ps
curl -fsS "https://$SITE_ADDRESS/api/auth/session"
```

The first boot runs the Drizzle migrations, creates the owner row and starts
Litestream. `SITE_ADDRESS=localhost` is for trying the stack on one machine:
Caddy then uses its internal CA and the browser warns.

`VAULT_KEY` is the key-encryption key (KEK) for every connector credential.
It is read from `.env` on the host — never from a volume, never from an image,
never from the replica. **Back it up separately from the database** (a password
manager or a secret store), and never include `.env` in a database backup. If
it is lost, every stored credential is unrecoverable and each connector must be
authorised again.

## First login

Open `https://<SITE_ADDRESS>` and enter `OWNER_PASSPHRASE`. The session cookie
is `HttpOnly`, `SameSite=Lax` and `Secure`; it lasts `SESSION_TTL_HOURS` (12 by
default). Login is rate-limited in-process. There is one owner account; the
demo user picker is off unless `DEMO_MODE=true`, which journals every use.

## Connecting a service

OAuth connectors: the authorization server must be given the exact callback
`https://<SITE_ADDRESS>/api/oauth/callback`. Compose derives
`OAUTH_REDIRECT_URI` from `SITE_ADDRESS`, so changing the hostname means
updating the provider registration too. A finished flow returns the browser to
`https://<SITE_ADDRESS>/connectors`.

Paste-URL connectors take an HTTPS MCP endpoint plus a bearer token, header or
basic credentials. Credentials go straight into the Vault; the connector row
holds only the URL, transport and auth type. Plain `http://` is refused unless
`ALLOW_LOCALHOST_DEV=true`, which is only for local MCP servers and must stay
off in production.

Check a connection:

```sh
curl -fsS "https://$SITE_ADDRESS/api/catalog"   # 401 without a session
docker compose logs --tail=50 gateway
```

The UI's Connectors screen probes reachability and lists the tools the server
advertises.

## Reading the journal

The Journal screen shows the append-only, hash-chained log. The API is the
source of truth:

```sh
# Requires the session cookie from the browser, or run it from the UI.
curl -fsS "https://$SITE_ADDRESS/api/journal/verify"
# {"ok":true,"checked":42}
# {"ok":false,"checked":17,"firstBrokenSeq":18}
```

`ok: true` means every `seq` is contiguous and every hash matches its
predecessor. `ok: false` names the first row that does not; treat that as a
real incident, copy `errand-data` aside, and do not keep writing. The journal
does not store credentials or agent keys: agent keys are kept as SHA-256
hashes, and Vault rows are ciphertext.

## Backups and restore

Litestream streams the SQLite WAL to `/replica/errand.db` in the
`errand-replica` volume. Every credential in that copy is ciphertext produced
by the Vault, and `VAULT_KEY` is not in it — the replica without the KEK
reveals no connector secret. The rest of the database is operational data
(journal events, connector URLs, the tool catalog), so the backup volume is
still private and must be protected like the host.

A replica on the same disk is not a backup. Point Litestream at off-box
storage in `deploy/litestream.yml` and give the container the bucket
credentials. Keep at least one copy on a different provider than the host.

```yaml
dbs:
  - path: ${LITESTREAM_DATABASE_PATH}
    meta-path: ${LITESTREAM_META_PATH}
    replica:
      url: s3://errand-backups/errand.db
      endpoint: https://s3.eu-central-003.backblazeb2.com
      region: eu-central-003
```

Restore:

Stop both writers first: a running replicator would keep appending from the
old transaction position while the restore rewrites the database.

```sh
docker compose stop gateway litestream
docker compose run --rm --no-deps --entrypoint /bin/sh litestream \
  -c 'rm -rf /var/lib/litestream/*'
docker compose run --rm --no-deps litestream \
  restore -config /etc/litestream.yml -force -o /data/errand.db /data/errand.db
docker compose start gateway litestream
```

The state volume is cleared so Litestream resyncs against the restored file
instead of resuming from a stale transaction ID.

`litestream restore` also accepts a timestamp for point-in-time recovery, for
example `-timestamp 2026-11-26T09:00:00Z`. The snapshot retention is one week.
Restore the same `VAULT_KEY` from its separate backup, or the restored
credentials stay unreadable.

## Key rotation

To rotate the KEK, put the new value in `VAULT_KEY` and the old one in
`VAULT_KEY_PREVIOUS`, restart the gateway, and re-save every connector so its
data key is re-wrapped. Only then remove `VAULT_KEY_PREVIOUS`. A blank
`VAULT_KEY_PREVIOUS` means "no previous key".

## Updating

```sh
git pull
docker compose up -d --build
```

Migrations run on gateway boot. Take a Litestream snapshot first if the release
notes mention a schema change. Roll back by checking out the previous tag and
running the same command; the database is not downgraded automatically.

## Logs and troubleshooting

```sh
docker compose ps
docker compose logs -f --tail=100 gateway
docker compose logs -f --tail=100 caddy
docker compose logs -f --tail=100 litestream
curl -fsS "https://$SITE_ADDRESS/api/auth/session"
```

| Symptom | Likely cause |
|---|---|
| Gateway restarts, log says `Invalid gateway configuration` | a blank or short secret in `.env` |
| Caddy serves the web app for `/api/...` | the `handle` blocks in `deploy/Caddyfile` were reordered |
| OAuth returns `redirect_uri_mismatch` | `SITE_ADDRESS` changed, provider registration did not |
| Litestream logs `no such file` | the gateway has not created `/data/errand.db` yet; it retries |
| 502 from Caddy | `docker compose ps` shows gateway or web unhealthy; read its log |

The stack probe used by the pipeline and on the host is `scripts/verify-stack.sh`. Run it locally from
the checkout with the deployment's environment to check routing, login, a real
connector, the journal, the Litestream health and the replica in one pass:

```sh
set -a
. ./.env
set +a
bash scripts/verify-stack.sh
```
