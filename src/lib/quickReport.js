// v1.0.158 · One-tap reports, built from what already exists (never a blank form):
//   • quickJobReport(job): the simple report of one service — store, date, type, who did it,
//     checklist, before/after photos and video, and the cleaner's signature saved on the job.
//   • quickDayReport(employee, date): every service of that person on that day, store by store,
//     with photos/videos and the cleaner's signature at the end. The owner's signature only goes
//     in after "Aceitar e assinar" (acceptDayReport).
// Missing photo or signature never blocks: the report opens and says "sem foto" / "sem assinatura".
import { supabase } from './supabase'
import { blankReport, buildPeriodReport, loadReport, reportIdForDay, reportIdForJob, saveReport, sigLabels } from './workReport'
import { listJobMedia, mediaForJobs } from './workMedia'
import { agendaChecklistItems, checklistProgress } from './agenda'
import { checklistDisplayLabel, splitChecklist } from './jobChecklist'
import { signatureForDisplay } from './signature'
import { getCleaningType } from './cleaningType'
import { loadJobAdminSignature } from './jobAdminSignature'
import { duplaInfo, memberWork } from './duplaJob'

const LANG = 'ja' // client-facing documents are in Japanese, like the other reports

async function cleanerSignature(job) {
  if (!job?.signature_url) return null
  const url = await signatureForDisplay(job.signature_url).catch(() => job.signature_url)
  return { name: job.employee_name || '', url }
}

/** Checklist rows of the job ({label, done}); [] when the job has none. */
export function jobChecklistRows(job, lang = LANG) {
  const saved = splitChecklist(job?.checklist_template)
  const items = saved.length ? saved : agendaChecklistItems(job || {})
  const p = checklistProgress(job, items)
  if (!p.items?.length || p.countOnly) return []
  return p.items.map(it => ({ label: checklistDisplayLabel(it.label, lang), done: !!it.done }))
}

export async function loadJob(jobOrId) {
  const id = typeof jobOrId === 'string' ? jobOrId : jobOrId?.id
  if (!id) throw new Error('job?')
  if (typeof jobOrId === 'object' && jobOrId.title && 'signature_url' in jobOrId) return jobOrId
  const { data, error } = await supabase.from('jobs').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Serviço não encontrado.')
  return data
}

// v1.0.197 · service done in pair: the other person's job (null when alone or gone)
async function pairJob(job) {
  const info = duplaInfo(job)
  if (!info) return null
  const { data } = await supabase.from('jobs').select('*').eq('id', info.partnerJobId).maybeSingle()
  return data && data.status !== 'cancelled' ? data : null
}

/**
 * v1.0.197 · Pair data on the report: both people's work ("o que cada um fez"), both cleaner signatures,
 * the checklist done by either, and the partner's photos. Main person first. Returns true when it changed.
 */
async function applyPair(r, main, partner) {
  if (!partner) return false
  const people = [main, partner]
  const team = await Promise.all(people.map(async j => ({ ...memberWork(j, jobChecklistRows(j)), sig: j.signature_url ? await signatureForDisplay(j.signature_url).catch(() => j.signature_url) : null })))
  const cleaners = team.map(m => ({ name: m.name, url: m.sig }))
  // checklist: an item counts as done when either of the two did it
  const rows = jobChecklistRows(main)
  const byLabel = new Map(team.flatMap(m => m.done.map(l => [l, true])))
  const checklist = rows.map(x => ({ ...x, done: x.done || byLabel.has(x.label) }))
  const media = await listJobMedia(partner).catch(() => [])
  const have = new Set((r.photos || []).map(p => p.path))
  const extra = media.filter(m => !have.has(m.path)).map(m => ({ path: m.path, section: m.section, kind: m.kind, by: partner.employee_name || '', at: partner.completed_at || null }))
  const next = {
    team: team.map(m => ({ ...m, sig: null })), // signatures live in r.signatures
    cleaners,
    checklist,
    job_ids: [...new Set([...(r.job_ids || []), main.id, partner.id])],
    lead: people.map(j => j.employee_name).filter(Boolean).join('・'),
  }
  const before = JSON.stringify([r.team, r.signatures?.cleaners, r.checklist, r.job_ids, r.fields?.lead])
  r.team = next.team
  r.signatures = { ...(r.signatures || {}), cleaner: cleaners[0], cleaners, owner: r.signatures?.owner || null }
  r.checklist = rows.length ? checklist : r.checklist
  r.job_ids = next.job_ids
  r.fields = { ...(r.fields || {}), lead: next.lead || r.fields?.lead || '' }
  if (extra.length) r.photos = [...(r.photos || []), ...extra]
  return extra.length > 0 || before !== JSON.stringify([r.team, r.signatures?.cleaners, r.checklist, r.job_ids, r.fields?.lead])
}

/** Builds (first tap) or opens (next taps) the simple report of a service. */
export async function quickJobReport(jobOrId, { author } = {}) {
  let job = await loadJob(jobOrId)
  // v1.0.197 · a pair has ONE report, built on the main job (the helper's tap opens the same one)
  if (duplaInfo(job)?.role === 'helper') {
    const main = await pairJob(job)
    if (main) job = main
  }
  const partner = await pairJob(job)
  const existingId = await reportIdForJob(job.id)
  if (existingId) {
    const r = await loadReport(existingId)
    if (r) {
      if (partner && await applyPair(r, job, partner)) {
        if (!r.signatures?.cleaner && job.signature_url) r.signatures = { ...r.signatures, cleaner: await cleanerSignature(job) }
        return saveReport(r, { by: author?.name || '', action: 'pair' })
      }
      // An older report without the cleaner's signature gets it now (nothing else changes).
      if (!r.signatures && job.signature_url) { r.signatures = { cleaner: await cleanerSignature(job), owner: null }; return saveReport(r, { by: author?.name || '', action: 'signature-added' }) }
      // v1.0.164 · the admin signed the service in Reports after the report was made
      if (r.signatures && !r.signatures.owner) {
        const adm = await loadJobAdminSignature(job.id)
        if (adm) { r.signatures = { ...r.signatures, owner: { name: adm.name, url: adm.url, at: adm.at } }; return saveReport(r, { by: author?.name || '', action: 'admin-signature' }) }
      }
      return r
    }
  }
  let client = null
  if (job.client_id) {
    const { data } = await supabase.from('clients').select('id,company_name,manager_name,contact_name,contact_person').eq('id', job.client_id).maybeSingle()
    client = data || null
  }
  const r = blankReport({ mode: 'simple', job, client, author })
  r.quick = true
  r.lang = LANG
  if (!r.title) r.title = { deep: 'ディープクリーニング', spot: 'スポット清掃', basic: '定期清掃' }[job.job_category === 'spot' ? 'spot' : getCleaningType(job)] || '清掃作業'
  const media = await listJobMedia(job).catch(() => [])
  r.photos = media.map(m => ({ path: m.path, section: m.section, kind: m.kind, by: job.employee_name || '', at: job.completed_at || null }))
  r.checklist = jobChecklistRows(job)
  const adm = await loadJobAdminSignature(job.id)
  r.signatures = { cleaner: await cleanerSignature(job), owner: adm ? { name: adm.name, url: adm.url, at: adm.at } : null }
  if (partner) await applyPair(r, job, partner)
  return saveReport(r, { by: author?.name || '', action: 'quick' })
}

/** Jobs of one person on one date (not cancelled), in route order. */
export async function jobsOfDay(employeeId, date) {
  const { data, error } = await supabase.from('jobs').select('*').eq('employee_id', employeeId).eq('scheduled_date', date)
    .order('sequence_order', { ascending: true, nullsFirst: false }).order('scheduled_time', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []).filter(j => !['cancelled', 'canceled', 'not_done'].includes(j.status))
}

/** Builds or refreshes the day report of a person. Once accepted it is kept as signed. */
export async function quickDayReport({ employeeId, employeeName, date, author, jobs: given } = {}) {
  const existingId = await reportIdForDay(employeeId, date)
  const old = existingId ? await loadReport(existingId) : null
  if (old?.signatures?.owner) return old
  const jobs = given || await jobsOfDay(employeeId, date)
  const media = await mediaForJobs(jobs.filter(j => j.status === 'completed' || j.status === 'in_progress'))
  const name = employeeName || jobs[0]?.employee_name || ''
  const built = buildPeriodReport({ client: null, from: date, to: date, jobs, media, author, lang: LANG, statuses: ['completed', 'in_progress'] })
  const signed = [...jobs].reverse().find(j => j.signature_url)
  const r = {
    ...built,
    id: old?.id || built.id,
    history: old?.history || [],
    created_at: old?.created_at || built.created_at,
    quick: true,
    day: { employee_id: employeeId, employee_name: name, date },
    title: `${sigLabels(LANG).day}｜${name}`,
    summary: '',
    closing: '',
    signatures: { cleaner: signed ? await cleanerSignature({ ...signed, employee_name: name }) : { name, url: null }, owner: null },
    internal: old?.internal || built.internal,
  }
  // v1.0.159 · each service carries its own signature (photo, name and signature, one by one)
  const sigs = new Map(await Promise.all(jobs.filter(j => j.signature_url).map(async j => [j.id, await signatureForDisplay(j.signature_url).catch(() => j.signature_url)])))
  for (const st of r.stores) st.services = st.services.map(sv => ({ ...sv, sig: sigs.get(sv.job_id) || null }))
  // keep the office's include / exclude choices on the services already there
  if (old?.stores) {
    const prev = new Map(old.stores.flatMap(st => st.services.map(sv => [sv.job_id, sv])))
    for (const st of r.stores) st.services = st.services.map(sv => (prev.has(sv.job_id) ? { ...sv, include: prev.get(sv.job_id).include, media: sv.media.map(m => ({ ...m, include: prev.get(sv.job_id).media?.find(x => x.path === m.path)?.include ?? true })) } : sv))
    for (const st of r.stores) st.note = old.stores.find(x => x.name === st.name)?.note || ''
  }
  return saveReport(r, { by: author?.name || '', action: old ? 'day-refresh' : 'day' })
}

/** The owner accepts the day report: only now does the owner's signature go in. */
export async function acceptDayReport(report, { name, url }) {
  if (!url) throw new Error('Assinatura?')
  const r = { ...report, signatures: { ...(report.signatures || {}), owner: { name: name || '', url, at: new Date().toISOString() } } }
  return saveReport(r, { by: name || '', action: 'accepted' })
}

/** Owner signature kept on this device (same key as the day PDF in Reports). */
export const ownerSigKey = id => `kp_admin_signature_${id || 'admin'}`
export const readOwnerSig = id => { try { return localStorage.getItem(ownerSigKey(id)) } catch { return null } }
export const keepOwnerSig = (id, url) => { try { localStorage.setItem(ownerSigKey(id), url) } catch { /* private mode */ } }
