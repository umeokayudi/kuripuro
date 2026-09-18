#!/usr/bin/env node
/**
 * Read-only probe of production tables/columns the app expects.
 * No inserts, no updates, no deletes.
 */
import { createClient } from '@supabase/supabase-js'
import { OTP_BASIC_LOCATIONS, ATOMIC_LOCATION, SCHEDULE_CLIENTS } from '../src/lib/serviceCatalog.js'

const url = process.env.VITE_SUPABASE_URL || 'https://fxsakrshmldmkdmbevna.supabase.co'
const key = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4c2FrcnNobWxkbWtkbWJldm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjYwMTEsImV4cCI6MjA5NjcwMjAxMX0.OSnexIDC2bflyDmCTd_pjvcbswB77ri5lDdccEfANMo'
const supabase = createClient(url, key)

const missing = []
const notes = []

async function probe(label, fn) {
  try {
    const res = await fn()
    if (res?.error) {
      missing.push(`${label}: ${res.error.code || ''} ${res.error.message}`)
      return null
    }
    return res
  } catch (err) {
    missing.push(`${label}: ${err.message}`)
    return null
  }
}

console.log('=== KuriPuro DB audit (read-only) ===\n')

const tables = [
  ['jobs', () => supabase.from('jobs').select('id,title,status,scheduled_date,client_id,employee_id,gps_start_lat,gps_end_lat,photo_start_url,photo_end_url,value').limit(1)],
  ['locations', () => supabase.from('locations').select('id,name,gps_lat,gps_lng,is_active').limit(3)],
  ['clients', () => supabase.from('clients').select('id,company_name,is_active').limit(8)],
  ['employees', () => supabase.from('employees').select('id,full_name,is_active,last_lat,last_lng,is_online').limit(5)],
  ['service_contracts', () => supabase.from('service_contracts').select('location_name,price_per_visit,client_id,is_active').eq('is_active', true).limit(20)],
  ['client_users', () => supabase.from('client_users').select('id,location_name,client_id,is_active').eq('is_active', true).limit(20)],
  ['client_requests', () => supabase.from('client_requests').select('id').limit(1)],
  ['client_ratings', () => supabase.from('client_ratings').select('id,stars').limit(1)],
  ['faturas', () => supabase.from('faturas').select('id,status,total').limit(5)],
  ['fatura_items', () => supabase.from('fatura_items').select('id').limit(1)],
  ['salary_payments', () => supabase.from('salary_payments').select('id').limit(1)],
  ['salary_statements', () => supabase.from('salary_statements').select('id').limit(1)],
  ['equipment_requests', () => supabase.from('equipment_requests').select('id').limit(1)],
  ['service_reports', () => supabase.from('service_reports').select('id').limit(1)],
]

for (const [name, fn] of tables) {
  const res = await probe(name, fn)
  if (res) notes.push(`OK  ${name}`)
}

const gps = await probe('jobs.gps_start_lat', () => supabase.from('jobs').select('id,gps_start_lat').limit(1))
if (!gps) notes.push('MISSING jobs GPS columns — run setup-portal-all.sql (GPS block) once')

const locRes = await supabase.from('locations').select('name,gps_lat,gps_lng,is_active')
const locs = locRes.data || []
const withGps = locs.filter(l => l.gps_lat != null && l.gps_lng != null)
notes.push(`locations ${locs.length} rows, ${withGps.length} with GPS`)

const catalogNames = [...OTP_BASIC_LOCATIONS.map(l => l.name), ATOMIC_LOCATION.name]
const locNames = new Set(locs.map(l => (l.name || '').trim()))
const missingLocs = catalogNames.filter(n => !locNames.has(n))
if (missingLocs.length) notes.push(`catalog stores missing from locations: ${missingLocs.join(', ')}`)

const cu = await supabase.from('client_users').select('location_name,client_id,is_active').eq('is_active', true)
const users = cu.data || []
notes.push(`active client_users ${users.length}`)
const otpUsers = users.filter(u => u.client_id === SCHEDULE_CLIENTS.ontheplanet.id)
notes.push(`OTP store logins ${otpUsers.length}: ${otpUsers.map(u => u.location_name || 'HQ').join(', ') || '(none)'}`)

const jobsMonth = await supabase.from('jobs').select('id,status,scheduled_date,title,client_id')
  .eq('client_id', SCHEDULE_CLIENTS.ontheplanet.id)
  .gte('scheduled_date', '2026-09-01')
  .lte('scheduled_date', '2026-09-30')
  .limit(400)
const jm = jobsMonth.data || []
const byStatus = jm.reduce((acc, j) => { acc[j.status] = (acc[j.status] || 0) + 1; return acc }, {})
notes.push(`OTP Sept jobs ${jm.length} ${JSON.stringify(byStatus)}`)

const inv = await supabase.from('faturas').select('id,status,total,client_id').limit(20)
if (!inv.error) {
  const by = (inv.data || []).reduce((acc, f) => { acc[f.status] = (acc[f.status] || 0) + 1; return acc }, {})
  notes.push(`faturas ${inv.data?.length || 0} ${JSON.stringify(by)}`)
}

console.log(notes.map(n => '  ' + n).join('\n'))
if (missing.length) {
  console.log('\nGaps:')
  missing.forEach(m => console.log('  - ' + m))
} else {
  console.log('\nNo missing tables/columns in this probe.')
}
console.log('\nDone')
