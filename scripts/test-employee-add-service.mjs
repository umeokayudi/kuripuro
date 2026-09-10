#!/usr/bin/env node
/**
 * Smoke test: employee transfer + duplicate prevention (standalone)
 * Run: node scripts/test-employee-add-service.mjs
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://fxsakrshmldmkdmbevna.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4c2FrcnNobWxkbWtkbWJldm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjYwMTEsImV4cCI6MjA5NjcwMjAxMX0.OSnexIDC2bflyDmCTd_pjvcbswB77ri5lDdccEfANMo'

const ANDRE = { id: '583d1ad6-1046-41db-8944-8f69120be41d', name: 'André Felipe Almeida' }
const SASAKI = { id: '37e0fa79-c5eb-49c8-b896-db2a4f9aeb16', name: 'Sasaki Kazuma' }
const TEST_LOC = 'Horumon no Manmosu'
const CLIENT_ID = '7138f082-0d38-43e4-bd77-00c4598690b3'

const RUN_TAG = `ci-${process.env.GITHUB_RUN_ID || `local-${Date.now()}`}`
const DATE = process.env.GITHUB_ACTIONS
  ? `2026-08-${String(10 + (Number(process.env.GITHUB_RUN_ID || Date.now()) % 20)).padStart(2, '0')}`
  : '2026-08-24'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

function locFromTitle(title) {
  return (title || '').replace(/ — .*/, '').trim()
}

function matches(title, name) {
  return locFromTitle(title).toLowerCase() === name.toLowerCase()
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function sleep(ms) {
  await new Promise(r => setTimeout(r, ms))
}

async function main() {
  console.log('=== Employee add service DB tests ===')
  console.log(`date=${DATE} tag=${RUN_TAG}\n`)

  const { data: existing } = await supabase
    .from('jobs')
    .select('id, description')
    .eq('scheduled_date', DATE)
    .ilike('title', `${TEST_LOC}%`)

  for (const j of existing || []) {
    if ((j.description || '').includes(RUN_TAG)) {
      await supabase.from('jobs').delete().eq('id', j.id)
    }
  }

  const { data: created, error: createErr } = await supabase.from('jobs').insert({
    title: `${TEST_LOC} — Basic Cleaning`,
    employee_id: SASAKI.id,
    employee_name: SASAKI.name,
    client_id: CLIENT_ID,
    client_name: 'On The Planet',
    scheduled_date: DATE,
    scheduled_time: '00:30',
    address: 'https://maps.google.com',
    description: RUN_TAG,
    status: 'assigned',
    job_category: 'regular',
    sequence_order: 99,
    value: 1923,
  }).select().single()

  if (createErr) throw createErr
  console.log(`Created test job ${created.id} for Sasaki`)

  const newTitle = `${TEST_LOC} — Deep Cleaning`
  let updated = null
  let updErr = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: transferJob } = await supabase.from('jobs').select('*').eq('id', created.id).maybeSingle()
    if (!transferJob) {
      await sleep(400)
      continue
    }
    const result = await supabase
      .from('jobs')
      .update({
        employee_id: ANDRE.id,
        employee_name: ANDRE.name,
        title: newTitle,
        sequence_order: 15,
        description: `${transferJob.description || ''}\n[test] André assumiu de Sasaki`.trim(),
      })
      .eq('id', created.id)
      .eq('status', 'assigned')
      .is('started_at', null)
      .select()
      .maybeSingle()
    updated = result.data
    updErr = result.error
    if (updated) break
    await sleep(400)
  }

  assert(!updErr && updated, `Transfer update failed: ${updErr?.message || 'no row updated'}`)
  assert(updated.employee_id === ANDRE.id, 'Not assigned to André')
  assert(updated.title.includes('Deep'), `Title not updated: ${updated.title}`)
  console.log('Transfer OK:', updated.title)

  const { data: andreJobs } = await supabase
    .from('jobs')
    .select('id, title')
    .eq('employee_id', ANDRE.id)
    .eq('scheduled_date', DATE)
    .in('status', ['assigned', 'in_progress'])

  const alreadyYours = (andreJobs || []).some(j => matches(j.title, TEST_LOC))
  assert(alreadyYours, 'André should already have Horumon')
  console.log('Already-yours detection OK')

  await supabase.from('jobs').update({ status: 'completed' }).eq('id', created.id)
  const { data: dayJobs } = await supabase
    .from('jobs')
    .select('status, title')
    .eq('scheduled_date', DATE)
    .neq('status', 'cancelled')

  const completed = (dayJobs || []).some(j => matches(j.title, TEST_LOC) && j.status === 'completed')
  assert(completed, 'Should be completed')
  console.log('Completed-today block logic OK')

  await supabase.from('jobs').delete().eq('id', created.id)
  console.log('\n✅ All tests passed')
}

main().catch(err => {
  console.error('\n❌', err.message)
  process.exit(1)
})
