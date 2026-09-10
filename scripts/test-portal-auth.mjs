#!/usr/bin/env node
/**
 * Read-only portal login smoke test (live Supabase).
 * Credentials from env — never hardcode production passwords in source.
 */
import { createClient } from '@supabase/supabase-js'
import { findClientUserForLogin } from '../src/lib/clientCredentials.js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://fxsakrshmldmkdmbevna.supabase.co'
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
const TEST_USER = process.env.TEST_PORTAL_USER
const TEST_PASSWORD = process.env.TEST_PORTAL_PASSWORD

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function main() {
  console.log('=== Portal auth smoke (read-only) ===\n')

  if (!SUPABASE_ANON_KEY) {
    console.log('⏭️  Skipped: VITE_SUPABASE_ANON_KEY not set')
    return
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

  if (TEST_USER && TEST_PASSWORD) {
    const user = await findClientUserForLogin(supabase, TEST_USER, TEST_PASSWORD)
    assert(user?.client_id, `${TEST_USER} login`)
    console.log(`✅ Client login (${TEST_USER})`)
  } else {
    console.log('⏭️  Skipped login test: set TEST_PORTAL_USER and TEST_PORTAL_PASSWORD in CI secrets')
  }

  const bad = await findClientUserForLogin(supabase, '___invalid_user___', 'wrong-password')
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
