#!/usr/bin/env bash
# Used by GitHub Actions and can be run locally with VERCEL_TOKEN set.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# KuriPuro — NUNCA usar VERCEL_PROJECT_ID do ambiente (pode apontar para bebidas-control)
KURIPURO_ORG_ID="team_G3qVUPQ27CLe8cPtxEBsrkxw"
KURIPURO_PROJECT_ID="prj_CwcXzleb2pOrKitSu6DFh7CRsvJU"

export VERCEL_ORG_ID="$KURIPURO_ORG_ID"
export VERCEL_PROJECT_ID="$KURIPURO_PROJECT_ID"

mkdir -p .vercel
cat > .vercel/project.json <<EOF
{"orgId":"${VERCEL_ORG_ID}","projectId":"${VERCEL_PROJECT_ID}"}
EOF

if [ -n "${VERCEL_TOKEN:-}" ]; then
  echo "=== Sync Vercel env (production) ==="
  if [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
    printf '%s' "$SUPABASE_SERVICE_ROLE_KEY" | npx vercel@latest env add SUPABASE_SERVICE_ROLE_KEY production --force --token "$VERCEL_TOKEN" 2>/dev/null || true
    echo "SUPABASE_SERVICE_ROLE_KEY → production"
  fi
  if [ -n "${GEMINI_API_KEY:-}" ]; then
    printf '%s' "$GEMINI_API_KEY" | npx vercel@latest env add GEMINI_API_KEY production --force --token "$VERCEL_TOKEN" 2>/dev/null || true
    echo "GEMINI_API_KEY → production"
  fi

  echo "=== Deploy Vercel CLI (production) ==="
  npx vercel@latest deploy --prod --yes --token "$VERCEL_TOKEN"
  exit 0
fi

if [ -n "${VERCEL_DEPLOY_HOOK:-}" ]; then
  echo "=== Deploy via Vercel Deploy Hook ==="
  curl -sf -X POST "$VERCEL_DEPLOY_HOOK"
  echo ""
  echo "Deploy hook triggered"
  exit 0
fi

echo "::error::Configure VERCEL_TOKEN or VERCEL_DEPLOY_HOOK in GitHub Secrets (or export locally)"
echo "  One-time setup: VERCEL_TOKEN=... bash scripts/setup-deploy-secrets.sh"
exit 1
