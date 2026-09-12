#!/usr/bin/env node
/**
 * Production smoke: employee tables, stale shifts, salary config.
 */
import { createClient } from '@supabase/supabase-js'
import { enrichJobValues, isStaleActiveJob } from '../src/lib/employeePay.js'
import { calcEmployeeMonthlySalary } from '../src/lib/salaryCalc.js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://fxsakrshmldmkdmbevna.supabase.co'
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4c2FrcnNobWxkbWtkbWJldm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjYwMTEsImV4cCI6MjA5NjcwMjAxMX0.OSnexIDC2bflyDmCTd_pjvcbswB77ri5lDdccEfANMo'

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const today = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).split(' ')[0]

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function main() {
  console.log('=== Employee production smoke ===\n')
  console.log('Tokyo today:', today)

  const { error: eqErr } = await sb.from('equipment_requests').select('id', { count: 'exact', head: true })
  if (eqErr) throw new Error(`equipment_requests: ${eqErr.message}`)
  console.log('✅ equipment_requests table readable')

  for (const t of ['messages', 'transport_claims', 'salary_statements', 'badges', 'service_contracts']) {
    const { error } = await sb.from(t).select('id', { count: 'exact', head: true })
    if (error) throw new Error(`${t}: ${error.message}`)
    console.log(`✅ ${t} readable`)
  }

  const { data: stuck } = await sb.from('jobs')
    .select('id, title, employee_name, scheduled_date, started_at, status')
    .eq('status', 'in_progress')

  console.log(`✅ in_progress jobs: ${stuck?.length || 0}`)
  const stale = (stuck || []).filter(j => isStaleActiveJob(j, today, 999999))
  if (stale.length) {
    console.log('⚠️  Stale shifts still open (employee must finish or reset in app):')
    for (const j of stale) {
      console.log(`   - ${j.employee_name}: ${j.title.split(' —')[0]} (${j.scheduled_date})`)
    }
  } else {
    console.log('✅ No stale in_progress shifts')
  }

  const { data: alex } = await sb.from('employees')
    .select('id, full_name, salary_type, fixed_salary, hourly_rate, job_bonus_rate, monthly_work_days')
    .ilike('full_name', '%Alexandre%')
    .maybeSingle()

  assert(alex, 'Alexandre employee not found')
  console.log(`✅ Alexandre found: ${alex.full_name}`)

  const hasPayConfig = alex.salary_type === 'hourly'
    ? Number(alex.hourly_rate) > 0
    : alex.salary_type === 'per_job'
      ? true
      : Number(alex.fixed_salary) > 0

  if (!hasPayConfig) {
    console.log(`⚠️  Alexandre salary not configured: type=${alex.salary_type || 'null'} fixed=${alex.fixed_salary || 0} hourly=${alex.hourly_rate || 0}`)
  } else {
    console.log(`✅ Alexandre salary config: ${alex.salary_type} (fixed=${alex.fixed_salary || 0}, hourly=${alex.hourly_rate || 0})`)
  }

  const month = today.slice(0, 7)
  const { data: ajobs } = await sb.from('jobs')
    .select('*')
    .eq('employee_id', alex.id)
    .eq('status', 'completed')
    .gte('scheduled_date', `${month}-01`)
    .lte('scheduled_date', today)

  const { data: contracts } = await sb.from('service_contracts')
    .select('location_name, price_per_visit')
    .eq('is_active', true)

  const enriched = enrichJobValues(ajobs || [], contracts || [])
  const sal = calcEmployeeMonthlySalary(alex, enriched, [])
  console.log(`✅ Alexandre month (${month}): ${sal.jobs} jobs, ¥${sal.total} earned, ${sal.hours}h`)

  if (sal.jobs > 0 && sal.total === 0) {
    console.log('⚠️  Jobs completed but ¥0 — admin must set salary_type/rates')
  }

  const bundle = await fetch('https://kuripuro.vercel.app/')
  const html = await bundle.text()
  const idx = html.match(/assets\/index-[^"]+\.js/)?.[0]
  assert(idx, 'production index bundle missing')
  const js = await (await fetch(`https://kuripuro.vercel.app/${idx}`)).text()
  assert(js.includes('staleShiftTitle') || js.includes('Unfinished shift'), 'v27 stale shift UI not in bundle')
  assert(js.includes('staleShiftReset') || js.includes('Reset timer'), 'stale reset label in bundle')
  assert(js.includes('salaryConfigHint') || js.includes('earnings show'), 'salary hint in bundle')
  console.log('✅ Production bundle includes v27 employee fixes')

  console.log('\n✅ Employee production smoke passed')
}

main().catch(err => {
  console.error('\n❌', err.message)
  process.exit(1)
})
