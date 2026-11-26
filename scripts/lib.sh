#!/usr/bin/env bash
# Output helpers shared by the stack probes.

pass() { echo "ok: $*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }
