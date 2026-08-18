#!/usr/bin/env node
import { loadEnvLocal } from './_loadEnv.mjs'
loadEnvLocal()
import {
  buildMonthSchedule,
  jobsToRows,
  contractsForActiveEmployees,
  locationsFromContracts,
  DEFAULT_LOCATIONS,
} from '../src/lib/scheduleGenerator.js'

const MONTH = process.env.SEED_MONTH || '2026-08'
const COMPLETE_UNTIL = process.env.COMPLETE_UNTIL || '2026-08-17'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://fxsakrshmldmkdmbevna.supabase.co'
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4c2FrcnNobWxkbWtkbWJldm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjYwMTEsImV4cCI6MjA5NjcwMjAxMX0.OSnexIDC2bflyDmCTd_pjvcbswB77ri5lDdccEfANMo'

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

async function sb(method, path, body) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await resp.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  if (!resp.ok) throw new Error(`${method} ${path}: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  return data
}

async function main() {
  const employees = await sb('GET', 'employees?select=id,full_name,is_active&is_active=eq.true')
  const serviceContracts = await sb('GET', 'service_contracts?select=*&is_active=eq.true')

  const contracts = contractsForActiveEmployees(employees)
  const locations = locationsFromContracts(serviceContracts)?.length
    ? locationsFromContracts(serviceContracts)
    : DEFAULT_LOCATIONS

  const jobs = buildMonthSchedule(MONTH, { contracts, locations, includeDuskin: true })

  const completedIso = new Date(`${COMPLETE_UNTIL}T23:59:59+09:00`).toISOString()
  jobs.forEach(j => {
    if (j.date <= COMPLETE_UNTIL && /Basic Cleaning/i.test(j.title)) {
      j.status = 'completed'
      j.completed_at = completedIso
    }
  })

  console.log(`Preparing ${MONTH} jobs (unlink transport claims, remove old jobs)...`)
  const augustJobs = await sb('GET', `jobs?select=id&scheduled_date=gte.${MONTH}-01&scheduled_date=lte.${MONTH}-31`)
  const ids = (augustJobs || []).map(j => j.id).filter(Boolean)
  if (ids.length) {
    const idList = ids.join(',')
    await sb('PATCH', `transport_claims?job_id=in.(${idList})`, { job_id: null }).catch(() => {})
    await sb('DELETE', `jobs?id=in.(${idList})`)
  }

  const rows = jobsToRows(jobs, contracts).map(r => ({
    title: r.title,
    employee_id: r.employee_id,
    employee_name: r.employee_name,
    client_id: r.client_id,
    client_name: r.client_name,
    scheduled_date: r.scheduled_date,
    scheduled_time: r.scheduled_time,
    status: r.status,
    job_category: r.job_category === 'duskin' ? 'regular' : (r.job_category || 'regular'),
    sequence_order: r.sequence_order,
    address: r.address || null,
    description: r.description || null,
    completed_at: r.completed_at || null,
  }))
  console.log(`Inserting ${rows.length} jobs...`)

  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50)
    await sb('POST', 'jobs', chunk)
    console.log(`  ${Math.min(i + 50, rows.length)} / ${rows.length}`)
  }

  const completed = rows.filter(r => r.status === 'completed').length
  const assigned = rows.filter(r => r.status === 'assigned').length
  console.log(JSON.stringify({ month: MONTH, total: rows.length, completed, assigned, completeUntil: COMPLETE_UNTIL }, null, 2))
}

main().catch(e => { console.error(e); process.exit(1) })
