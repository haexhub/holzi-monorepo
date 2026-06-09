#!/usr/bin/env bash
# Generate TypeScript types from hermes-server's OpenAPI schema.
#
# Requires hermes-server running locally (default: http://localhost:8082) and
# HERMES_AUTH_TOKEN in env — the schema endpoint is Bearer-gated.
#
# Usage:
#   HERMES_AUTH_TOKEN=… pnpm run gen:api
#   HERMES_AUTH_TOKEN=… HERMES_URL=http://my-vps:8082 pnpm run gen:api

set -euo pipefail

HERMES_URL="${HERMES_URL:-http://localhost:8082}"
OUT="app/types/api-generated.ts"

if [[ -z "${HERMES_AUTH_TOKEN:-}" ]]; then
  echo "error: HERMES_AUTH_TOKEN env var is required (the schema endpoint is auth-gated)" >&2
  exit 1
fi

echo "Fetching ${HERMES_URL}/openapi.json …" >&2
schema=$(mktemp --suffix=.json)
trap 'rm -f "$schema"' EXIT

if ! curl -fsS \
  -H "Authorization: Bearer ${HERMES_AUTH_TOKEN}" \
  "${HERMES_URL}/openapi.json" -o "$schema"; then
  echo "error: failed to fetch openapi schema (is hermes-server running?)" >&2
  exit 1
fi

echo "Generating ${OUT} …" >&2
pnpm exec openapi-typescript "$schema" -o "$OUT"

echo "Done — review ${OUT} and commit if happy." >&2
