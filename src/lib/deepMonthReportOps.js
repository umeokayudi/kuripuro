// v1.0.230 · Loading + PDF for the monthly Deep Cleaning report (On The Planet). READ ONLY:
// only SELECTs jobs and reads public storage files; nothing is written anywhere.
import { supabase } from './supabase'
import { mediaForJobs } from './workMedia'
import { loadReport, reportIdForJob, storagePublicUrl } from './workReport'
import { aiFacts, buildDeepMonthReport, isClientJob, isDeepJob, monthRange, OTP_CLIENT } from './deepMonthReport'
import { isTestClient, isTestJob } from './testData'
import { ONTHEPLANET_CLIENT_ID } from './cleaningType'

// No value / pay columns are read at all (hard rule: never show money). No completed_at either:
// the end of a visit is never needed. v1.0.247: + the checklist and the worker's note (AI facts).
const JOB_COLS = 'id,title,client_id,client_name,employee_name,scheduled_date,scheduled_time,status,started_at,photo_start_url,photo_end_url,job_category,checklist_template,checklist_total,checklist_done,checklist_missed_items,notes_employee'

/**
 * v1.0.247 · Clients for the selector: every non-test client (id + name only), with how many deep
 * cleanings of the month each one has. OTP first, then the ones with deeps, then the rest.
 */
export async function loadReportClients(month) {
  const [from, to] = monthRange(month)
  const [{ data: cl, error }, { data: jobs }] = await Promise.all([
    supabase.from('clients').select('id,company_name,is_active').order('company_name').limit(2000),
    supabase.from('jobs').select('id,title,client_id,client_name,status,employee_name').gte('scheduled_date', from).lte('scheduled_date', to).limit(5000),
  ])
  if (error) throw new Error(error.message)
  const deep = (jobs || []).filter(j => isDeepJob(j) && !isTestJob(j) && j.status !== 'cancelled')
  const list = (cl || []).filter(c => !isTestClient(c)).map(c => {
    const client = { id: c.id, name: c.company_name || '—' }
    const mine = deep.filter(j => isClientJob(j, client))
    return { ...client, active: c.is_active !== false, deep: mine.length, done: mine.filter(j => j.status === 'completed').length }
  }).filter(c => c.active || c.deep)
  if (!list.some(c => c.id === ONTHEPLANET_CLIENT_ID)) list.push({ ...OTP_CLIENT, active: true, deep: 0, done: 0 })
  const rank = c => (c.id === ONTHEPLANET_CLIENT_ID ? 0 : c.deep ? 1 : 2)
  return list.sort((a, b) => rank(a) - rank(b) || b.done - a.done || a.name.localeCompare(b.name))
}

async function pool(items, size, fn) {
  let i = 0
  const out = new Map()
  const worker = async () => {
    while (i < items.length) {
      const it = items[i++]
      out.set(it.id ?? it, await fn(it).catch(() => null))
    }
  }
  await Promise.all(Array.from({ length: size }, worker))
  return out
}

/** Client-facing notes of the service report linked to a job (ご報告事項 only). */
async function reportNotes(jobId) {
  const id = await reportIdForJob(jobId)
  if (!id) return ''
  const r = await loadReport(id)
  return r ? String(r.notices || '') : ''
}

/** Loads everything for one month of one client and returns buildDeepMonthReport(). */
export async function loadDeepMonthReport(month, { onProgress, client = OTP_CLIENT } = {}) {
  const [from, to] = monthRange(month)
  const { data, error } = await supabase.from('jobs').select(JOB_COLS)
    .gte('scheduled_date', from).lte('scheduled_date', to).limit(5000)
  if (error) throw new Error(error.message)
  const jobs = (data || []).filter(j => isClientJob(j, client) && isDeepJob(j))
  const done = jobs.filter(j => j.status === 'completed')
  onProgress?.({ step: 'photos', done: 0, total: done.length })
  const media = await mediaForJobs(done, { onProgress: (d, t) => onProgress?.({ step: 'photos', done: d, total: t }) })
  onProgress?.({ step: 'notes', done: 0, total: done.length })
  const notes = await pool(done, 6, j => reportNotes(j.id))
  return buildDeepMonthReport({ month, jobs, media, notes, client })
}

/**
 * v1.0.247 · Asks the AI (server, admin login) for the opening, each visit's "what was done and
 * why" and the closing. Sends only aiFacts() — no time of day, duration, value or names.
 */
export async function aiMonthTexts(report, { lang, clientName, today }) {
  const resp = await fetch('/api/evaluate-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ kind: 'month-report', lang, facts: aiFacts(report, { lang, clientName, today }) }),
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok || data.error) throw new Error(data.error || `HTTP ${resp.status}`)
  return { intro: data.intro || '', closing: data.closing || '', visits: data.visits || {}, missing: data.missing || [], models: data.models || [] }
}

/** Photo → small JPEG data URL (max side `max` px), so the PDF stays light. null when it can't be read. */
export async function shrinkPhoto(path, max = 1100) {
  const url = storagePublicUrl(path)
  try {
    const r = await fetch(url, { cache: 'force-cache' })
    if (!r.ok) return null
    const blob = await r.blob()
    const bmp = await createImageBitmap(blob)
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    bmp.close?.()
    return c.toDataURL('image/jpeg', 0.82)
  } catch {
    return null
  }
}

/** Shrinks all the photos of the visits. Visits whose photo can't be opened move to `excluded`. */
export async function preparePhotos(report, { onProgress } = {}) {
  const paths = [...new Set(report.visits.flatMap(v => [v.before, v.after]))]
  let n = 0
  const images = new Map()
  await pool(paths, 6, async p => { const d = await shrinkPhoto(p); if (d) images.set(p, d); onProgress?.(++n, paths.length) })
  const visits = []
  const excluded = [...report.excluded]
  for (const v of report.visits) {
    const reasons = []
    if (!images.has(v.before)) reasons.push('before_unreadable')
    if (!images.has(v.after)) reasons.push('after_unreadable')
    if (reasons.length) excluded.push({ job: { id: v.id, scheduled_date: v.date, title: v.store }, store: v.store, reasons })
    else visits.push(v)
  }
  excluded.sort((a, b) => a.job.scheduled_date.localeCompare(b.job.scheduled_date))
  return { report: { ...report, visits, excluded }, images }
}

/** A4 PDF: each <section class="pg"> of the HTML becomes exactly one page. */
export async function deepMonthPdfBlob(html, { onProgress } = {}) {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')])
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:820px;height:1200px;border:0'
  document.body.appendChild(iframe)
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('PDF: tempo esgotado')), 30000)
      iframe.onload = () => { clearTimeout(t); resolve() }
      iframe.srcdoc = html
    })
    const doc = iframe.contentDocument
    try { await doc.fonts?.ready } catch { /* optional */ }
    await Promise.all([...doc.images].map(img => (img.complete ? null : new Promise(r => { img.onload = img.onerror = r }))))
    const pages = [...doc.querySelectorAll('section.pg')]
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, width: 794, height: 1123, windowWidth: 820 })
      if (i) pdf.addPage()
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.86), 'JPEG', 0, 0, 210, 297)
      onProgress?.(i + 1, pages.length)
    }
    return pdf.output('blob')
  } finally {
    iframe.remove()
  }
}
