#!/usr/bin/env bash
# Deploy KuriPuro para Vercel pelo terminal
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Build ==="
npm run build

echo ""
echo "=== Deploy Vercel (production) ==="
if [ -z "${VERCEL_TOKEN:-}" ]; then
  echo "Sem VERCEL_TOKEN — vai pedir login interativo (vercel login)"
  npx vercel@latest --prod
else
  npx vercel@latest --prod --token "$VERCEL_TOKEN"
fi

echo ""
echo "=== Verificar ==="
sleep 5
curl -s "https://kuripuro.vercel.app/api/version" || true
echo ""
