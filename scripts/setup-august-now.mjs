#!/usr/bin/env node
/**
 * Setup agosto — standalone, sem .env.local
 * Uso: node scripts/setup-august-now.mjs
 */
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const ROOT = dirname(fileURLToPath(import.meta.url))
const URL = 'https://fxsakrshmldmkdmbevna.supabase.co'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4c2FrcnNobWxkbWtkbWJldm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjYwMTEsImV4cCI6MjA5NjcwMjAxMX0.OSnexIDC2bflyDmCTd_pjvcbswB77ri5lDdccEfANMo'

const env = {
  ...process.env,
  VITE_SUPABASE_URL: URL,
  VITE_SUPABASE_ANON_KEY: ANON,
  SUPABASE_URL: URL,
  SUPABASE_ANON_KEY: ANON,
  SUPABASE_SERVICE_ROLE_KEY: '',
}

function run(script) {
  const r = spawnSync('node', [join(ROOT, script)], { env, stdio: 'inherit', cwd: join(ROOT, '..') })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

console.log('▶ Sincronizando contratos...')
run('sync-service-contracts.mjs')
console.log('▶ Gerando jobs de agosto...')
run('seed-august-2026.mjs')
console.log('✅ Pronto.')
