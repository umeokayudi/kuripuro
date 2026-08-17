#!/usr/bin/env bash
set -euo pipefail

echo "==> KuriPuro deploy"
echo "==> Branch: $(git branch --show-current)"

git fetch origin main
git checkout main
git pull origin main

echo "==> Limpando dist local (gerado no build)"
rm -rf dist

echo "==> Instalando dependências"
npm install

echo "==> Build"
npm run build

echo "==> Deploy Vercel (produção)"
npx vercel --prod --force --yes

echo ""
echo "==> Teste se atualizou:"
echo "    curl -s https://kuripuro.vercel.app/api/admin-ai | head"
echo ""
echo "Deve mostrar: {\"ok\":true,\"api\":\"admin-ai\",\"build\":\"2026-08-17-v4\"...}"
echo "Se ainda der erro gemini-1.5-flash, o deploy NÃO atualizou a API."
