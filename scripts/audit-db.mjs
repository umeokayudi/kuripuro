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
const tips = []

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
  ['service_contracts', () => supabase.from('service_contracts').select('location_name,price_per_visit,client_id,is_active').eq('is_active', true).limit(40)],
  ['client_users', () => supabase.from('client_users').select('id,location_name,client_id,is_active,email').eq('is_active', true).limit(40)],
  ['client_requests', () => supabase.from('client_requests').select('id').limit(1)],
  ['client_ratings', () => supabase.from('client_ratings').select('id,stars').limit(1)],
  ['client_messages', () => supabase.from('client_messages').select('id').limit(1)],
  ['client_complaints', () => supabase.from('client_complaints').select('id').limit(1)],
  ['client_compliments', () => supabase.from('client_compliments').select('id').limit(1)],
  ['faturas', () => supabase.from('faturas').select('id,status,total').limit(5)],
  ['fatura_items', () => supabase.from('fatura_items').select('id').limit(1)],
  ['salary_payments', () => supabase.from('salary_payments').select('id').limit(1)],
  ['salary_statements', () => supabase.from('salary_statements').select('id').limit(1)],
  ['salary_periods', () => supabase.from('salary_periods').select('id').limit(1)],
  ['salary_complaints', () => supabase.from('salary_complaints').select('id').limit(1)],
  ['equipment_requests', () => supabase.from('equipment_requests').select('id').limit(1)],
  ['evaluations', () => supabase.from('evaluations').select('id').limit(1)],
  ['service_reports', () => supabase.from('service_reports').select('id').limit(1)],
]

for (const [name, fn] of tables) {
  const res = await probe(name, fn)
  if (res) notes.push(`OK  ${name}`)
}

const gps = await probe('jobs.gps_start_lat', () => supabase.from('jobs').select('id,gps_start_lat').limit(1))
if (!gps) tips.push('Rode setup-portal-all.sql uma vez no SQL Editor (bloco GPS). Sem isso o geofence 100m não grava início/fim.')

const locRes = await supabase.from('locations').select('name,gps_lat,gps_lng,is_active')
const locs = locRes.data || []
const withGps = locs.filter(l => l.gps_lat != null && l.gps_lng != null)
notes.push(`locations ${locs.length} rows, ${withGps.length} with GPS`)
const locNoGps = locs.filter(l => l.gps_lat == null || l.gps_lng == null).map(l => l.name)
if (locNoGps.length) tips.push(`Lojas sem GPS em locations: ${locNoGps.join(', ')} — geofence usa o endereço/GPS da loja.`)

const catalogNames = [...OTP_BASIC_LOCATIONS.map(l => l.name), ATOMIC_LOCATION.name]
const locNames = new Set(locs.map(l => (l.name || '').trim()))
const missingLocs = catalogNames.filter(n => !locNames.has(n))
if (missingLocs.length) {
  notes.push(`catalog stores missing from locations: ${missingLocs.join(', ')}`)
  tips.push(`Faltam linhas em locations para: ${missingLocs.join(', ')}. Contas de portal existem, mas o mapa/geofence dessas lojas fica cego.`)
}

const cu = await supabase.from('client_users').select('location_name,client_id,is_active,email').eq('is_active', true)
const users = cu.data || []
notes.push(`active client_users ${users.length}`)
const otpUsers = users.filter(u => u.client_id === SCHEDULE_CLIENTS.ontheplanet.id)
notes.push(`OTP store logins ${otpUsers.length}: ${otpUsers.map(u => u.location_name || 'HQ').join(', ') || '(none)'}`)

const catalogSet = new Set(catalogNames)
const extraUsers = users.filter(u => u.location_name && !catalogSet.has(u.location_name) && u.client_id === SCHEDULE_CLIENTS.ontheplanet.id)
if (extraUsers.length) notes.push(`OTP logins outside catalog: ${extraUsers.map(u => u.location_name).join(', ')}`)

const missingUserStores = catalogNames.filter(n => !users.some(u => (u.location_name || '').trim() === n))
if (missingUserStores.length) tips.push(`Catálogo sem login de loja: ${missingUserStores.join(', ')}. Use Clientes → Portal → provisionar.`)

const contracts = await supabase.from('service_contracts').select('location_name,price_per_visit,client_id,is_active').eq('is_active', true)
const cons = contracts.data || []
notes.push(`active service_contracts ${cons.length}`)
const missingContracts = catalogNames.filter(n => !cons.some(c => (c.location_name || '').trim() === n))
if (missingContracts.length) tips.push(`Catálogo sem contrato ativo: ${missingContracts.join(', ')}.`)

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
  const pending = (inv.data || []).filter(f => f.status === 'pending' || f.status === 'draft')
  if (pending.length) tips.push(`${pending.length} fatura(s) draft/pending — o cliente só vê sent/paid. Use Mark Sent no admin.`)
}

const emp = await supabase.from('employees').select('id,full_name,is_active,last_lat,last_lng,is_online').eq('is_active', true)
if (!emp.error) {
  const rows = emp.data || []
  const withPing = rows.filter(e => e.last_lat != null)
  notes.push(`active employees ${rows.length}, GPS ping ${withPing.length}`)
}

console.log(notes.map(n => '  ' + n).join('\n'))
if (missing.length) {
  console.log('\nGaps:')
  missing.forEach(m => console.log('  - ' + m))
} else {
  console.log('\nNo missing tables/columns in this probe.')
}
if (tips.length) {
  console.log('\nTips:')
  tips.forEach(t => console.log('  · ' + t))
}
console.log('\nDone')
