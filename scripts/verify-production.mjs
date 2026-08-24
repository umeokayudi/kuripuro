#!/usr/bin/env node
/**
 * Full production smoke check for kuripuro.vercel.app
 * Run: node scripts/verify-production.mjs
 */
import { createClient } from '@supabase/supabase-js'

const BASE = 'https://kuripuro.vercel.app'
const SUPABASE_URL = 'https://fxsakrshmldmkdmbevna.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4c2FrcnNobWxkbWtkbWJldm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjYwMTEsImV4cCI6MjA5NjcwMjAxMX0.OSnexIDC2bflyDmCTd_pjvcbswB77ri5lDdccEfANMo'

const results = []
function pass(name, detail = '') { results.push({ name, ok: true, detail }) }
function fail(name, detail = '') { results.push({ name, ok: false, detail }) }

async function fetchText(url) {
  const r = await fetch(url)
  return { status: r.status, text: await r.text() }
}

async function main() {
  console.log('=== KuriPuro production verification ===\n')

  // API version
  const ver = await fetchText(`${BASE}/api/version`)
  if (ver.status === 200 && ver.text.includes('2026-08-24-v12')) {
    pass('API version v12', ver.text.trim())
  } else {
    fail('API version v12', `status=${ver.status} body=${ver.text.slice(0, 120)}`)
  }

  // Homepage
  const home = await fetchText(BASE)
  if (home.status === 200 && home.text.includes('<!DOCTYPE html')) {
    pass('Homepage loads', `HTTP ${home.status}`)
  } else {
    fail('Homepage loads', `HTTP ${home.status}`)
  }

  // Bundle features
  const bundleMatch = home.text.match(/assets\/index-[^"]+\.js/)
  if (bundleMatch) {
    const bundle = await fetchText(`${BASE}/${bundleMatch[0]}`)
    const features = [
      'Add service manually',
      'Checklist incompleto',
      'Retirar TODO o lixo',
      'Open in Google Maps',
      'progressSummary',
      '1 hour on this job',
    ]
    for (const f of features) {
      if (bundle.text.includes(f)) pass(`Bundle: ${f}`)
      else fail(`Bundle: ${f}`, 'not found')
    }
  } else {
    fail('Bundle detection', 'no index bundle in HTML')
  }

  // Admin AI endpoint
  const ai = await fetch(`${BASE}/api/admin-ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'ping' }] }),
  })
  if (ai.status === 200 || ai.status === 500) {
    pass('Admin AI endpoint', `HTTP ${ai.status}`)
  } else {
    fail('Admin AI endpoint', `HTTP ${ai.status}`)
  }

  // Photo API — use real storage path format (jobs/...)
  const photo = await fetch(`${BASE}/api/photo?path=jobs/e1849feb-6b74-4024-83c4-77c94d4fc4fe/start_0.jpg`)
  if (photo.status === 200 && photo.headers.get('content-type')?.includes('image')) {
    pass('Photo API (service role)', `HTTP 200 ${photo.headers.get('content-type')}`)
  } else if (photo.status === 502) {
    fail('Photo API (service role)', '502 — SUPABASE_SERVICE_ROLE_KEY may be missing/wrong')
  } else {
    const body = await photo.text().catch(() => '')
    fail('Photo API', `HTTP ${photo.status} ${body.slice(0, 80)}`)
  }

  // Supabase DB
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const today = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).split(' ')[0]

  const { data: jobs, error: jobsErr } = await supabase
    .from('jobs')
    .select('id, title, status, employee_name, address')
    .eq('scheduled_date', today)
    .limit(20)

  if (jobsErr) fail('Supabase jobs', jobsErr.message)
  else pass('Supabase jobs', `${jobs?.length || 0} jobs today (${today})`)

  const mapsOk = (jobs || []).filter(j => j.address?.includes('google.com/maps')).length
  const mapsTotal = (jobs || []).filter(j => j.address).length
  if (mapsTotal === 0 || mapsOk === mapsTotal) {
    pass('Maps URLs in DB', `${mapsOk}/${mapsTotal} full google maps URLs`)
  } else {
    fail('Maps URLs in DB', `${mapsOk}/${mapsTotal} have full URLs`)
  }

  const { data: employees } = await supabase
    .from('employees')
    .select('id, full_name, is_active')
    .eq('is_active', true)
  pass('Active employees', `${employees?.length || 0}`)

  const { data: atomic } = await supabase
    .from('jobs')
    .select('checklist_template')
    .eq('scheduled_date', today)
    .ilike('title', 'Atomic Bar%')
    .limit(1)
    .maybeSingle()

  if (atomic?.checklist_template) {
    const items = String(atomic.checklist_template).split('\n').filter(Boolean)
    if (items.length >= 13) pass('Atomic Bar checklist', `${items.length} items`)
    else fail('Atomic Bar checklist', `${items.length} items (expected 13)`)
  } else {
    fail('Atomic Bar checklist', 'no Atomic Bar job today')
  }

  const { count: clientUsers } = await supabase
    .from('client_users')
    .select('id', { count: 'exact', head: true })
  pass('Client portal accounts', `${clientUsers || 0}`)

  // Summary
  console.log('')
  const ok = results.filter(r => r.ok)
  const bad = results.filter(r => !r.ok)
  for (const r of results) {
    console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
  }
  console.log(`\n${ok.length}/${results.length} passed`)
  if (bad.length) process.exit(1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
