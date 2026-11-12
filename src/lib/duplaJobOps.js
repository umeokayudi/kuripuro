// v1.0.197 · "Serviço em dupla" — database + storage writes. Pure rules live in duplaJob.js.
// Audit (who joined, when, the pay before / after the split) is kept in storage
// service-photos/jobs/<main job id>/dupla.json, so the split can be undone exactly.
import { supabase as defaultClient } from './supabase'
import { tokyoToday } from './dates'
import { storagePublicUrl } from './workReport'
import { buildDuplaPlan, canJoinDupla, duplaInfo, undoDuplaPlan } from './duplaJob'

const BUCKET = 'service-photos'
export const DUPLA_AUDIT_FILE = 'dupla.json'
const MAIN_COLS = 'id,title,client_id,client_name,employee_id,employee_name,scheduled_date,scheduled_time,address,gps_lat,gps_lng,description,checklist_template,photo_required,status,started_at,job_category,spot_value,spot_status,counts_as_work_day,materials,reference_photos,instructions,area,employee_pay'

const newUuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16) }))

async function putAudit(client, mainId, obj) {
  const body = new Blob([JSON.stringify(obj)], { type: 'application/json' })
  const { error } = await client.storage.from(BUCKET).upload(`jobs/${mainId}/${DUPLA_AUDIT_FILE}`, body, { upsert: true, contentType: 'application/json', cacheControl: '0' })
  if (error) throw new Error(error.message)
}

export async function loadDuplaAudit(mainId) {
  if (!mainId) return null
  try {
    const r = await fetch(`${storagePublicUrl(`jobs/${mainId}/${DUPLA_AUDIT_FILE}`)}?t=${Date.now()}`, { cache: 'no-store' })
    return r.ok ? await r.json() : null
  } catch { return null }
}

/** The partner's job of a pair (null when the job is not in a pair or the row is gone). */
export async function loadDuplaPartner(job, { client = defaultClient, cols = '*' } = {}) {
  const info = duplaInfo(job)
  if (!info) return null
  const { data } = await client.from('jobs').select(cols).eq('id', info.partnerJobId).maybeSingle()
  return data && data.status !== 'cancelled' ? data : null
}

async function nextSequenceOrder(client, employeeId, date) {
  const { data } = await client.from('jobs').select('sequence_order').eq('employee_id', employeeId).eq('scheduled_date', date)
    .order('sequence_order', { ascending: false }).limit(1)
  return ((data?.[0]?.sequence_order || 0) + 1)
}

/**
 * helper joins the job `mainJobId` of another person: a job of their own for the same service is
 * created (running at once when the other person already started) and the worker pay is split 50/50.
 * Returns { ok, job, main, split } or { ok: false, error }.
 */
export async function joinDupla({ mainJobId, helper, client = defaultClient }) {
  if (!helper?.id || !mainJobId) return { ok: false, error: 'invalid_input' }
  const today = tokyoToday()
  const { data: main, error } = await client.from('jobs').select(MAIN_COLS).eq('id', mainJobId).maybeSingle()
  if (error) return { ok: false, error: 'fetch_failed', detail: error.message }
  const can = canJoinDupla(main, helper.id, today)
  if (!can.ok) return can

  // the helper must not have another service running (one running service per person)
  const { data: mine } = await client.from('jobs').select('id,title').eq('employee_id', helper.id).eq('status', 'in_progress').limit(1)
  const running = main.status === 'in_progress' || !!main.started_at
  if (running && mine?.length) return { ok: false, error: 'helper_busy', detail: mine[0].title }

  const helperJobId = newUuid()
  const plan = buildDuplaPlan(main, helper, { helperJobId, sequenceOrder: await nextSequenceOrder(client, helper.id, main.scheduled_date) })
  const audit = {
    v: 1, main_job_id: main.id, helper_job_id: helperJobId,
    main: { id: main.employee_id, name: main.employee_name }, helper: { id: helper.id, name: helper.name },
    split: plan.split, joined_at: plan.split.at, title: main.title, date: main.scheduled_date,
  }
  // audit first: if storage refuses, nothing changes
  await putAudit(client, main.id, audit)

  const { data: updMain, error: mErr } = await client.from('jobs')
    .update({ ...plan.mainPatch, ...(plan.mainPatch.employee_pay !== undefined ? { employee_pay_updated_by: `${helper.name} (dupla 50/50)`, employee_pay_updated_at: plan.split.at } : {}) })
    .eq('id', main.id).in('status', ['assigned', 'in_progress'])
    .select('id').maybeSingle()
  if (mErr) {
    // employee_pay_updated_* may not exist on an old database: try without them
    const retry = await client.from('jobs').update(plan.mainPatch).eq('id', main.id).in('status', ['assigned', 'in_progress']).select('id').maybeSingle()
    if (retry.error) return { ok: false, error: 'update_failed', detail: retry.error.message }
    if (!retry.data) return { ok: false, error: 'race' }
  } else if (!updMain) {
    return { ok: false, error: 'race' }
  }

  const { data: created, error: insErr } = await client.from('jobs').insert(plan.helperRow).select().single()
  if (insErr) {
    // put the main job back as it was
    await client.from('jobs').update({ description: main.description, ...(plan.split.originalPay !== null ? { employee_pay: plan.split.originalPay } : {}), ...(plan.split.originalSpot !== null ? { spot_value: plan.split.originalSpot } : {}) }).eq('id', main.id)
    return { ok: false, error: 'create_failed', detail: insErr.message }
  }

  await client.from('messages').insert({
    employee_id: main.employee_id,
    employee_name: main.employee_name || '',
    sender: 'admin',
    content: `👥 ${helper.name} entrou em dupla com você em ${String(main.title || '').split(' — ')[0]} (${main.scheduled_date}). O valor do serviço é dividido meio a meio e o relatório sai com a assinatura dos dois.`,
    read: false,
  }).then(() => {}, () => {})

  return { ok: true, job: created, main, split: plan.split }
}

/** Undo a pair (helper left / joined by mistake): whole pay back to the main job, helper job cancelled. */
export async function leaveDupla({ job, by = '', client = defaultClient }) {
  const info = duplaInfo(job)
  if (!info) return { ok: false, error: 'not_dupla' }
  const mainId = info.role === 'main' ? job.id : info.partnerJobId
  const helperId = info.role === 'helper' ? job.id : info.partnerJobId
  const [{ data: main }, { data: helperJob }] = await Promise.all([
    client.from('jobs').select('id,description,status,employee_id,employee_name,title').eq('id', mainId).maybeSingle(),
    client.from('jobs').select('id,description,status,employee_id,employee_name,started_at,completed_at').eq('id', helperId).maybeSingle(),
  ])
  if (helperJob?.status === 'completed') return { ok: false, error: 'helper_done' }
  const audit = await loadDuplaAudit(mainId)
  const { mainPatch, helperPatch } = undoDuplaPlan(main, helperJob, audit, { by })
  if (main) {
    const { error } = await client.from('jobs').update(mainPatch).eq('id', mainId)
    if (error) return { ok: false, error: 'update_failed', detail: error.message }
  }
  if (helperPatch) await client.from('jobs').update(helperPatch).eq('id', helperId)
  if (audit) await putAudit(client, mainId, { ...audit, undone_at: new Date().toISOString(), undone_by: by }).catch(() => {})
  return { ok: true }
}
