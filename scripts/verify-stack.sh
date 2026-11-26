#!/usr/bin/env bash
# Drives the running Compose stack through Caddy, then checks what only the
# containers can show: published ports, image environment, and a restored
# replica scanned for plaintext. Every assertion is on the running system.
set -euo pipefail

. "$(dirname "$0")/lib.sh"

BASE="${STACK_URL:-https://localhost}"
export BASE
if [ -z "${OWNER_PASSPHRASE:-}" ]; then
  fail "OWNER_PASSPHRASE must come from .env"
fi
export OWNER_PASSPHRASE
export VAULT_KEY="${VAULT_KEY:?VAULT_KEY must come from .env}"
export CONNECTOR_URL="http://127.0.0.1:8787/mcp"
export KEY_OUT="$(mktemp)"
trap 'rm -f "$KEY_OUT"' EXIT

bash scripts/probe-stack.sh
KEY="$(cat "$KEY_OUT")"

assert_unpublished() {
  local service="$1" port="$2" mapped
  mapped="$(docker port "$(docker compose ps -q "$service")" "$port" 2>/dev/null || true)"
  [ -z "$mapped" ] || fail "the $service port $port is published: $mapped"
}

assert_unpublished gateway 8787
assert_unpublished web 3000

health=""
for _ in $(seq 1 30); do
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
    "$(docker compose ps -q litestream)")"
  [ "$health" = "healthy" ] && break
  sleep 1
done
[ "$health" = "healthy" ] || fail "litestream is $health"

secrets=("$VAULT_KEY" "$OWNER_PASSPHRASE")
for name in HMAC_KEY JWT_SECRET; do
  value="${!name:-}"
  [ -z "$value" ] || secrets+=("$value")
done
for image in errand-gateway errand-web; do
  env_json="$(docker image inspect "$image" --format '{{json .Config.Env}}')"
  if grep -qE 'VAULT_KEY|HMAC_KEY|JWT_SECRET|OWNER_PASSPHRASE' <<<"$env_json"; then
    fail "a secret name is baked into $image"
  fi
  for secret in "${secrets[@]}"; do
    if grep -qF -- "$secret" <<<"$env_json"; then
      fail "a secret value is baked into $image"
    fi
  done
done
pass "only Caddy is published and no image carries a secret"

mount_volume() {
  docker inspect --format \
    "{{range .Mounts}}{{if eq .Destination \"$2\"}}{{.Name}}{{end}}{{end}}" \
    "$(docker compose ps -q "$1")"
}

# Restore the replica to a plain SQLite file. LTX frames are compressed, so only
# a restored copy can be scanned for plaintext.
sleep 5
docker compose run --rm --no-deps litestream restore -force -o /replica/restored.db /data/errand.db >/dev/null
data_volume="$(mount_volume gateway /data)"
replica_volume="$(mount_volume litestream /replica)"
[ -n "$data_volume" ] || fail "the gateway has no /data volume"
[ -n "$replica_volume" ] || fail "litestream has no /replica volume"

scan() {
  local volume="$1" needle="$2" expected="$3"
  if docker run --rm -e NEEDLE="$needle" -v "$volume:/scan" alpine sh -c 'grep -rqF -- "$NEEDLE" /scan'; then
    [ "$expected" = present ] || fail "$volume contains $needle but it must be absent"
  else
    [ "$expected" = absent ] || fail "$volume lacks the positive control $needle"
  fi
}

for volume in "$data_volume" "$replica_volume"; do
  scan "$volume" "connector.connected" present
  scan "$volume" "$VAULT_KEY" absent
  scan "$volume" "$KEY" absent
done
pass "the restored replica holds the credential only as ciphertext and the KEK nowhere"

echo "stack probe passed"
