#!/usr/bin/env bash
# Deploy KuriPuro para Vercel pelo terminal
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Build ==="
npm run build

echo ""
echo "=== Deploy Vercel (production) ==="
DEPLOY_ARGS=(--prod --yes)
if [ -n "${VERCEL_TOKEN:-}" ]; then
  DEPLOY_ARGS+=(--token "$VERCEL_TOKEN")
else
  echo "Sem VERCEL_TOKEN — vai pedir login interativo (vercel login)"
fi
npx vercel@latest "${DEPLOY_ARGS[@]}"

echo ""
echo "=== Verificar ==="
sleep 5
curl -s "https://kuripuro.vercel.app/api/version" || true
echo ""
