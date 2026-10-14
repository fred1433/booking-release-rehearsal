#!/usr/bin/env bash
# Usage: smoke.sh <base-url> <expected-sha>
# Waits until the deployed worker reports the expected commit, then checks the page and the API.
set -euo pipefail
BASE="$1"; SHA="$2"
for i in $(seq 1 30); do
  GOT=$(curl -fsS "$BASE/api/health" | sed -n 's/.*"sha": *"\([0-9a-f]*\)".*/\1/p' || true)
  [ "$GOT" = "$SHA" ] && break
  sleep 5
done
[ "$GOT" = "$SHA" ] || { echo "health reports '$GOT', expected $SHA"; exit 1; }
curl -fsS "$BASE/" | grep -q "<title>" || { echo "page missing"; exit 1; }
curl -fsS "$BASE/api/config" | grep -q '"durations"' || { echo "config missing"; exit 1; }
echo "smoke ok: $BASE runs $SHA"
