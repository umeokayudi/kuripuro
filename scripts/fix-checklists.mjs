#!/usr/bin/env node
/** Preenche checklist_template em jobs existentes (OTP/Atomic) */
import { getSupabaseEnv, assertSupabaseKey, supabaseHeaders } from './_supabaseEnv.mjs'
import { checklistTemplateForJob } from '../src/lib/jobChecklist.js'

const { url: SUPABASE_URL, key: KEY } = getSupabaseEnv()
await assertSupabaseKey(SUPABASE_URL, KEY)
const headers = supabaseHeaders(KEY)

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

const jobs = await sb('GET', 'jobs?select=id,title,checklist_template,status&limit=5000')
let updated = 0
let skipped = 0

for (const job of jobs || []) {
  const template = checklistTemplateForJob(job)
  if (!template) { skipped++; continue }
  if (job.checklist_template === template) { skipped++; continue }
  await sb('PATCH', `jobs?id=eq.${job.id}`, { checklist_template: template })
  updated++
}

console.log(JSON.stringify({ updated, skipped, total: jobs?.length || 0 }, null, 2))
