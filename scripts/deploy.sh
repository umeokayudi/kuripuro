#!/usr/bin/env bash
# Deploy KuriPuro para Vercel pelo terminal
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Garantir link com projeto kuripuro (evita deploy em outro app)
# KuriPuro — lock project (ignore VERCEL_PROJECT_ID from env — pode ser bebidas-control)
KURIPURO_ORG_ID="team_G3qVUPQ27CLe8cPtxEBsrkxw"
KURIPURO_PROJECT_ID="prj_CwcXzleb2pOrKitSu6DFh7CRsvJU"
export VERCEL_ORG_ID="$KURIPURO_ORG_ID"
export VERCEL_PROJECT_ID="$KURIPURO_PROJECT_ID"
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

echo ""
echo "=== Deploy Vercel (production) ==="
bash "$ROOT/scripts/ci-deploy.sh"

echo ""
echo "=== Verificar ==="
sleep 8
curl -sf "https://kuripuro.vercel.app/api/version" && echo ""
echo "Esperado: build 2026-08-26-v14"
