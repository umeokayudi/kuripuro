// AI grade of the After photo: run (with timeout), save on the job and its report, read back as issues + fixes.
import { supabase } from './supabase'
import { syncServiceReport } from './jobReport'

export const AI_TIMEOUT_MS = 45000

/** "gordura no fogão => passar desengordurante" → { issue, fix } (old rows have no fix). */
export function aiIssueRows(text) {
  return String(text || '').split(/\s*[;\n]\s*|,\s(?=[^,]*=>)/).map(s => s.trim()).filter(Boolean).map(s => {
    const [issue, fix] = s.split(/\s*=>\s*/)
    return { issue: issue.trim(), fix: (fix || '').trim() }
  })
}

/** Stored text: items joined with "; " so commas inside an item survive. */
export function aiIssuesText(problemas) {
  return Array.isArray(problemas) && problemas.length ? problemas.map(p => String(p).replace(/;/g, ',')).join('; ') : null
}

/** Calls /api/analyze-photo with a timeout; throws 'timeout' / server error text. */
export async function analyzePhoto(photoUrl, locationName, { timeoutMs = AI_TIMEOUT_MS } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch('/api/analyze-photo', {
      method: 'POST', credentials: 'include', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photoUrl, locationName }),
    })
    const ev = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(ev.error || `HTTP ${resp.status}`)
    if (ev.nota == null) throw new Error('no-grade')
    return ev
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('timeout')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Grades the job's After photo and saves it (job + service report). */
export async function gradeJobPhoto(job) {
  if (!job?.photo_end_url) throw new Error('no-photo')
  const ev = await analyzePhoto(job.photo_end_url, job.title)
  const patch = {
    photo_ai_score: Math.round(Number(ev.nota)), photo_ai_approved: ev.aprovado ?? null,
    photo_ai_issues: aiIssuesText(ev.problemas),
  }
  const { data, error } = await supabase.from('jobs').update(patch).eq('id', job.id).select('*').maybeSingle()
  if (error) throw error
  if (data?.status === 'completed') await syncServiceReport(supabase, data).catch(() => {})
  return { ...job, ...patch }
}
