#!/usr/bin/env node
/**
 * Roda setup-portal-all.sql no Supabase.
 * Uso: SUPABASE_DB_URL="postgresql://..." node scripts/run-supabase-setup.mjs
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import postgres from 'postgres'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL

if (!dbUrl) {
  console.error('❌ Defina SUPABASE_DB_URL')
  process.exit(1)
}

const sqlFile = readFileSync(join(__dirname, '../setup-portal-all.sql'), 'utf8')
const statements = sqlFile
  .split(';')
  .map(s => s.replace(/--[^\n]*/g, '').trim())
  .filter(s => s.length > 5)

const sql = postgres(dbUrl, { ssl: 'require', max: 1 })

try {
  console.log(`▶ Executando ${statements.length} statements...`)
  for (const statement of statements) {
    await sql.unsafe(statement)
  }
  console.log('✅ Setup concluído: portal + storage service-photos')
} catch (err) {
  console.error('❌ Erro:', err.message)
  process.exit(1)
} finally {
  await sql.end({ timeout: 5 })
}
