// v1.0.141 · Reports screen filters: period presets, place/type/problem predicates, sort and
// URL <-> state. Pure functions (no React, no Supabase) so the rules are easy to test.

const DAY = 86400000

/** 'YYYY-MM-DD' in Tokyo for a Date */
export function tokyoDate(d = new Date()) {
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 10)
}

export function addDays(ymd, n) {
  const d = new Date(ymd + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const PERIODS = ['today', 'yesterday', '7', '30', 'month', 'lastmonth', '90', 'custom']

/** → { from, to } (inclusive, Tokyo dates) for a preset */
export function periodRange(period, today, custom = {}) {
  switch (period) {
    case 'today': return { from: today, to: today }
    case 'yesterday': { const y = addDays(today, -1); return { from: y, to: y } }
    case '7': return { from: addDays(today, -6), to: today }
    case '90': return { from: addDays(today, -89), to: today }
    case 'month': return { from: today.slice(0, 8) + '01', to: today }
    case 'lastmonth': {
      const first = today.slice(0, 8) + '01'
      const lastPrev = addDays(first, -1)
      return { from: lastPrev.slice(0, 8) + '01', to: lastPrev }
    }
    case 'custom': {
      let from = custom.from || today, to = custom.to || custom.from || today
      if (from > to) [from, to] = [to, from]
      return { from, to }
    }
    case '30':
    default: return { from: addDays(today, -29), to: today }
  }
}

export function rangeDays({ from, to }) {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY) + 1
}

/** ISO instants covering the Tokyo dates from..to (for completed_at queries) */
export function rangeIso({ from, to }) {
  return {
    fromIso: new Date(from + 'T00:00:00+09:00').toISOString(),
    toIso: new Date(addDays(to, 1) + 'T00:00:00+09:00').toISOString(),
  }
}

// ── type ────────────────────────────────────────────────────────────────────────────
// done = every completed job (default) · live / retro / manual = how it was done
// open = only not finished yet · everything = completed + not finished
export const TYPES = ['done', 'live', 'retro', 'manual', 'open', 'everything']
export const typeNeedsOpenJobs = type => type === 'open' || type === 'everything'

export function isOpenRow(r) {
  return !!(r.job_status && r.job_status !== 'completed')
}

/** 'live' | 'retro' | 'manual' | 'open' for one report row (mode = executionMode of its job) */
export function rowKind(r, mode) {
  if (isOpenRow(r)) return 'open'
  if (mode === 'manual') return 'manual'
  if (r.report_type === 'retroativo' || mode === 'retro') return 'retro'
  return 'live'
}

export function matchesType(type, kind) {
  if (!type || type === 'everything') return true
  if (type === 'done') return kind !== 'open'
  return type === kind
}

// ── problems ────────────────────────────────────────────────────────────────────────
// Shown as chips with counts. Several selected = report has ANY of them.
export const PROBLEMS = ['long', 'lowai', 'nophoto', 'nosig', 'novideo', 'checklist', 'notes', 'open']
export const LOW_AI = 6

/**
 * ctx: { exception: null | {kind}, videoStatus: undefined (not read yet) | null | {status}, notes: number }
 * → Set of problem keys this row has. 'novideo' is only decided once the video status was read.
 */
export function rowProblems(r, ctx = {}) {
  const out = new Set()
  const open = isOpenRow(r)
  if (ctx.exception?.kind === 'long') out.add('long')
  if (open) out.add('open')
  const score = r.photo_ai_score
  if (score != null && score !== '' && Number(score) < LOW_AI) out.add('lowai')
  if (!open) {
    if (!r.photo_after_url && !r.photo_before_url) out.add('nophoto')
    if (!r.signature_url) out.add('nosig')
    if (r.checklist_total && Number(r.checklist_done || 0) < Number(r.checklist_total)) out.add('checklist')
    if (ctx.videoStatus === null || ctx.videoStatus?.status === 'failed') out.add('novideo')
  }
  if ((ctx.notes || 0) > 0) out.add('notes')
  return out
}

export function matchesProblems(selected, has) {
  if (!selected?.length) return true
  return selected.some(p => has.has(p))
}

// ── place / search ──────────────────────────────────────────────────────────────────
/** the store / place name shown in the list (job title without the " — task" tail) */
export function placeOf(r) {
  return String(r.location_name || r.client_name || r.job_title || '').replace(/ — .*/, '').trim()
}

const norm = s => String(s || '').normalize('NFKC').toLowerCase()

export function matchesSearch(q, r) {
  const needle = norm(q).trim()
  if (!needle) return true
  const hay = norm([r.employee_name, r.client_name, r.job_title, r.location_name, r.notes_out, r.report_date].join(' '))
  return needle.split(/\s+/).every(w => hay.includes(w))
}

// ── sort ────────────────────────────────────────────────────────────────────────────
export const SORTS = ['recent', 'oldest', 'longest', 'worstai', 'employee']

const whenOf = r => String(r.completed_at || r.started_at || r.created_at || r.report_date || '')

export function sortRows(rows, sort, { singleDay = false } = {}) {
  const list = [...rows]
  const byWhenDesc = (a, b) => whenOf(b).localeCompare(whenOf(a))
  switch (sort) {
    case 'oldest': return list.sort((a, b) => whenOf(a).localeCompare(whenOf(b)))
    case 'longest': return list.sort((a, b) => (b.duration_min ?? -1) - (a.duration_min ?? -1) || byWhenDesc(a, b))
    case 'worstai': {
      const s = r => (r.photo_ai_score == null || r.photo_ai_score === '' ? 99 : Number(r.photo_ai_score))
      return list.sort((a, b) => s(a) - s(b) || byWhenDesc(a, b))
    }
    case 'employee': return list.sort((a, b) => String(a.employee_name || '').localeCompare(String(b.employee_name || '')) || byWhenDesc(a, b))
    case 'recent':
    default:
      if (singleDay) return list.sort((a, b) => String(a.started_at || a.time_in || '').localeCompare(String(b.started_at || b.time_in || '')))
      return list.sort(byWhenDesc)
  }
}

// ── URL ─────────────────────────────────────────────────────────────────────────────
// v1.0.150 · Reports opens on TODAY (same counter as the Painel do Dia)
export const DEFAULT_FILTERS = { period: 'today', from: '', to: '', emp: '', client: '', place: '', type: 'done', problems: [], q: '', sort: 'recent' }

export function filtersFromParams(params) {
  const get = k => params.get(k) || ''
  const period = PERIODS.includes(get('p')) ? get('p') : DEFAULT_FILTERS.period
  const type = TYPES.includes(get('type')) ? get('type') : DEFAULT_FILTERS.type
  const sort = SORTS.includes(get('sort')) ? get('sort') : DEFAULT_FILTERS.sort
  const problems = get('pb').split(',').filter(p => PROBLEMS.includes(p))
  const ymd = s => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '')
  return { period, from: ymd(get('from')), to: ymd(get('to')), emp: get('emp'), client: get('client'), place: get('place'), type, problems, q: get('q'), sort }
}

export function filtersToParams(f) {
  const out = {}
  if (f.period !== DEFAULT_FILTERS.period) out.p = f.period
  if (f.period === 'custom') { if (f.from) out.from = f.from; if (f.to) out.to = f.to }
  if (f.emp) out.emp = f.emp
  if (f.client) out.client = f.client
  if (f.place) out.place = f.place
  if (f.type !== DEFAULT_FILTERS.type) out.type = f.type
  if (f.problems?.length) out.pb = f.problems.join(',')
  if (f.q) out.q = f.q
  if (f.sort !== DEFAULT_FILTERS.sort) out.sort = f.sort
  return out
}

/** how many filters differ from the default (for the "Clear (n)" button) */
export function activeFilterCount(f) {
  return ['emp', 'client', 'place', 'q'].filter(k => f[k]).length
    + (f.period !== DEFAULT_FILTERS.period ? 1 : 0)
    + (f.type !== DEFAULT_FILTERS.type ? 1 : 0)
    + (f.problems?.length || 0)
}
