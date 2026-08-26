#!/usr/bin/env bash
# One-time: configure GitHub Actions secrets for automatic deploy on push to main.
# Usage: VERCEL_TOKEN=xxx [SUPABASE_SERVICE_ROLE_KEY=...] [GEMINI_API_KEY=...] bash scripts/setup-deploy-secrets.sh
set -euo pipefail

REPO="${GITHUB_REPO:-umeokayudi/kuripuro}"

if [ -z "${VERCEL_TOKEN:-}" ]; then
  echo "ERRO: export VERCEL_TOKEN=... antes de rodar"
  echo ""
  echo "Obter token: https://vercel.com/account/tokens"
  echo "Alternativa: crie um Deploy Hook no Vercel e use:"
  echo "  gh secret set VERCEL_DEPLOY_HOOK -R $REPO --body 'https://api.vercel.com/v1/integrations/deploy/...'"
  exit 1
fi

command -v gh >/dev/null || { echo "Instale gh CLI"; exit 1; }

echo "=== GitHub secrets → $REPO ==="
gh secret set VERCEL_TOKEN -R "$REPO" --body "$VERCEL_TOKEN"
gh secret set VERCEL_ORG_ID -R "$REPO" --body "team_G3qVUPQ27CLe8cPtxEBsrkxw"
gh secret set VERCEL_PROJECT_ID -R "$REPO" --body "prj_CwcXzleb2pOrKitSu6DFh7CRsvJU"

if [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  gh secret set SUPABASE_SERVICE_ROLE_KEY -R "$REPO" --body "$SUPABASE_SERVICE_ROLE_KEY"
  echo "SUPABASE_SERVICE_ROLE_KEY ✓"
fi

if [ -n "${GEMINI_API_KEY:-}" ]; then
  gh secret set GEMINI_API_KEY -R "$REPO" --body "$GEMINI_API_KEY"
  echo "GEMINI_API_KEY ✓"
fi

echo ""
echo "✅ Secrets configurados. Próximo push em main dispara deploy automático."
echo "Testar agora: gh workflow run deploy.yml -R $REPO"
