#!/usr/bin/env bash
# Deploy KuriPuro para Vercel pelo terminal
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Garantir link com projeto kuripuro (evita deploy em outro app)
export VERCEL_ORG_ID="${VERCEL_ORG_ID:-team_G3qVUPQ27CLe8cPtxEBsrkxw}"
export VERCEL_PROJECT_ID="${VERCEL_PROJECT_ID:-prj_CwcXzleb2pOrKitSu6DFh7CRsvJU}"
mkdir -p .vercel
cat > .vercel/project.json <<EOF
{"orgId":"${VERCEL_ORG_ID}","projectId":"${VERCEL_PROJECT_ID}"}
EOF

echo "=== Build ==="
npm run build

echo ""
if [ -z "${VERCEL_TOKEN:-}" ]; then
  echo "ERRO: VERCEL_TOKEN não definido."
  echo "  Cursor: Environment → Secrets → VERCEL_TOKEN"
  echo "  GitHub: Settings → Secrets → VERCEL_TOKEN"
  echo "  Mac: export VERCEL_TOKEN=... && npm run deploy"
  exit 1
fi

echo "=== Sync Vercel env (production) ==="
if [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  printf '%s' "$SUPABASE_SERVICE_ROLE_KEY" | npx vercel@latest env add SUPABASE_SERVICE_ROLE_KEY production --force --token "$VERCEL_TOKEN" 2>/dev/null || true
  echo "SUPABASE_SERVICE_ROLE_KEY → production"
fi
if [ -n "${GEMINI_API_KEY:-}" ]; then
  printf '%s' "$GEMINI_API_KEY" | npx vercel@latest env add GEMINI_API_KEY production --force --token "$VERCEL_TOKEN" 2>/dev/null || true
  echo "GEMINI_API_KEY → production"
fi

echo ""
echo "=== Deploy Vercel (production) ==="
npx vercel@latest deploy --prod --yes --token "$VERCEL_TOKEN"

echo ""
echo "=== Verificar ==="
sleep 8
curl -sf "https://kuripuro.vercel.app/api/version" && echo ""
echo "Esperado: build 2026-08-26-v14"
