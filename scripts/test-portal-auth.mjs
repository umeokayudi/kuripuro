#!/usr/bin/env node
/**
 * Read-only portal login smoke test (live Supabase).
 */
import { createClient } from '@supabase/supabase-js'
import { findClientUserForLogin } from '../src/lib/clientCredentials.js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://fxsakrshmldmkdmbevna.supabase.co'
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4c2FrcnNobWxkbWtkbWJldm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjYwMTEsImV4cCI6MjA5NjcwMjAxMX0.OSnexIDC2bflyDmCTd_pjvcbswB77ri5lDdccEfANMo'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function main() {
  console.log('=== Portal auth smoke (read-only) ===\n')
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

  const user = await findClientUserForLogin(supabase, 'Ibushio', 'Kuripuro2026')
  assert(user?.client_id, 'Ibushio login by store name')
  assert(user?.location_name, 'Ibushio has location_name')
  console.log('✅ Client login by store name (Ibushio)')

  const bad = await findClientUserForLogin(supabase, 'Ibushio', 'wrong-password')
  assert(!bad, 'wrong password returns null')
  console.log('✅ Wrong password rejected')

  const { count } = await supabase.from('client_users').select('id', { count: 'exact', head: true }).eq('is_active', true)
  assert((count || 0) >= 1, 'at least one active client user')
  console.log(`✅ client_users table readable (${count} active)`)

  console.log('\n✅ Portal auth smoke passed')
}

main().catch(err => {
  console.error('\n❌', err.message)
  process.exit(1)
})
