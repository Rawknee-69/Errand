#!/usr/bin/env bash
# Drives the running stack through Caddy: health, routing, first login, an agent
# key, a real connector and the journal. Callers supply the base URL and the
# connector's loopback address; the issued key is left in KEY_OUT.
set -euo pipefail

. "$(dirname "$0")/lib.sh"

BASE="${BASE:?set BASE to the public stack URL}"
if [ -z "${OWNER_PASSPHRASE:-}" ]; then
  fail "OWNER_PASSPHRASE must be set to the owner login"
fi
KEY_OUT="${KEY_OUT:?set KEY_OUT to a file for the issued agent key}"
CONNECTOR_URL="${CONNECTOR_URL:-http://127.0.0.1:8787/mcp}"
JAR="$(mktemp)"
BODY="$(mktemp)"
trap 'rm -f "$JAR" "$BODY"' EXIT

curl_q() { curl -sk --fail-with-body "$@"; }

for _ in $(seq 1 60); do
  curl -skf "$BASE/api/auth/session" >/dev/null && break
  sleep 2
done
curl -skf "$BASE/api/auth/session" >/dev/null || fail "the stack did not answer at $BASE/api/auth/session"

SESSION="$(curl_q "$BASE/api/auth/session")"
grep -q '"authenticated":false' <<<"$SESSION" || fail "session is not the gateway's: $SESSION"
pass "gateway session endpoint through Caddy"

for path in / /slips /connect; do
  curl -sk "$BASE$path" | grep -q 'id="root"' || fail "$path did not return the web shell"
done
pass "web routes and SPA fallback"

[ "$(curl -sk -o /dev/null -w '%{http_code}' "$BASE/api/catalog")" = "401" ] || fail "/api/catalog did not reach the gateway"
[ "$(curl -sk -o /dev/null -w '%{http_code}' "$BASE/mcp")" = "401" ] || fail "/mcp did not reach the gateway"
[ "$(curl -sk -o /dev/null -w '%{http_code}' "$BASE/api/oauth/callback")" = "401" ] || fail "/api/oauth/callback did not reach the gateway"
pass "agent endpoint, API and OAuth callback reach the gateway"

curl_q -c "$JAR" -H 'content-type: application/json' \
  -d "{\"passphrase\":\"$OWNER_PASSPHRASE\"}" "$BASE/api/auth/login" | grep -q '"authenticated":true' \
  || fail "login failed"
pass "first login"

KEY="$(curl_q -b "$JAR" -H 'content-type: application/json' -d '{"name":"stack-probe"}' \
  "$BASE/api/agent-keys" | sed -n 's/.*"key":"\([^"]*\)".*/\1/p')"
[ -n "$KEY" ] || fail "agent key was not issued"
printf '%s' "$KEY" > "$KEY_OUT"
pass "agent key issued"

STATUS="$(curl -sk -o "$BODY" -w '%{http_code}' -b "$JAR" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"stack-probe\",\"url\":\"$CONNECTOR_URL\",\"authType\":\"bearer\",\"token\":\"$KEY\"}" \
  "$BASE/api/connectors")"
[ "$STATUS" = "201" ] || fail "connector returned $STATUS: $(cat "$BODY")"
pass "connector connected and its credential stored"

curl_q -b "$JAR" "$BASE/api/journal/verify" | grep -q '"ok":true' || fail "journal verify failed"
pass "journal verifies"
