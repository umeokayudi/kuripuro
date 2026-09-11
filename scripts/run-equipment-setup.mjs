#!/usr/bin/env node
import postgres from 'postgres'
import { EQUIPMENT_SETUP_SQL } from '../src/lib/equipmentSetupSql.js'

const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL
if (!dbUrl) {
  console.error('❌ Defina SUPABASE_DB_URL')
  process.exit(1)
}

const sql = postgres(dbUrl, { ssl: 'require', max: 1 })
try {
  await sql.unsafe(EQUIPMENT_SETUP_SQL)
  console.log('✅ equipment_requests table ready')
} catch (err) {
  console.error('❌', err.message)
  process.exit(1)
} finally {
  await sql.end({ timeout: 5 })
}
