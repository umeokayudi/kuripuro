#!/usr/bin/env bash
# KuriPuro — setup completo pelo terminal
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== KuriPuro terminal setup ==="
echo ""

# 1) Variáveis obrigatórias
: "${SUPABASE_DB_URL:?Defina SUPABASE_DB_URL (postgresql://...)}"
export SUPABASE_DB_URL

if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "⚠️  SUPABASE_SERVICE_ROLE_KEY não definida (upload de fotos pode falhar)"
fi

# 2) SQL no Supabase (portal + bucket de fotos)
echo "▶ Rodando SQL no Supabase..."
node scripts/run-supabase-setup.mjs
echo ""

# 3) Teste rápido do storage (opcional, via API local ou produção)
API_BASE="${KURIPURO_API_BASE:-https://kuripuro.vercel.app}"
echo "▶ Testando API em $API_BASE ..."
VERSION=$(curl -s "$API_BASE/api/version" || true)
echo "   version: $VERSION"

if [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "▶ Testando upload de foto..."
  B64=$(printf '\xff\xd8\xff\xd9' | base64 -w0 2>/dev/null || printf '\xff\xd8\xff\xd9' | base64)
  UPLOAD=$(curl -s -X POST "$API_BASE/api/upload-photo" \
    -H "Content-Type: application/json" \
    -d "{\"path\":\"jobs/_healthcheck/$(date +%s).jpg\",\"data\":\"$B64\",\"contentType\":\"image/jpeg\"}" || true)
  echo "   upload: $UPLOAD"
fi

echo ""
echo "✅ Setup local concluído."
echo ""
echo "Deploy (escolha um):"
echo "  git push origin main          # se Vercel está ligado ao GitHub"
echo "  npx vercel --prod             # deploy direto (precisa vercel login)"
echo ""
echo "Verificar produção:"
echo "  curl -s https://kuripuro.vercel.app/api/version"
