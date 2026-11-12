// v1.0.178 · "Conferir o dia" — was each service of the day done, and done RIGHT?
// Pure helpers on top of the Painel do Dia (lib/dayPanel.js stays the single source of the numbers):
// one verdict per service + one summary per person and per store, for the expandable rows.
//
// Verdict of a service:
//   'todo' → not finished yet (not started / in progress / late / no cover)
//   'warn' → finished, but something to look at (photo missing, checklist incomplete, GPS far, too fast)
//   'ok'   → finished and nothing to look at
import { jobDurationMin, gpsCheck, ON_SITE_METERS } from './workKpis.js'

/** Below this share of the planned time a finished service is "rápido demais" (e.g. 27 s for a 2 h deep). */
export const TOO_FAST_SHARE = 0.3
export const TOO_FAST_MIN = 10

const fmtDist = m => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`)
export const durText = min => (min == null ? '' : min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`)

/**
 * Checks of one service (an item of panel.services / store.services).
 * → { verdict, done, checks: [{ key, state: 'ok'|'bad'|'info', label }], issues: [labels], durMin }
 */
export function serviceCheck(s, L = (en, ja, pt) => pt) {
  const j = s?.job || {}
  const done = s?.status === 'done'
  const checks = []
  // covered by someone else: the other person's job holds the proof
  if (s?.coveredBy) {
    checks.push({ key: 'covered', state: 'info', label: L(`done by ${s.coveredBy}`, `${s.coveredBy}が実施`, `feito por ${s.coveredBy}`) })
    return { verdict: 'ok', done: true, checks, issues: [], durMin: null }
  }
  if (!done) return { verdict: 'todo', done: false, checks, issues: [], durMin: null }

  const retro = !!s.retro
  const photoNeeded = j.photo_required !== false
  // photos — retroactive ("Já fiz") keeps only the after photo
  if (!retro) {
    const before = !!j.photo_start_url
    checks.push({ key: 'before', state: before ? 'ok' : photoNeeded ? 'bad' : 'info', label: before ? L('Before photo', '作業前の写真', 'Foto antes') : L('No before photo', '作業前の写真なし', 'Sem foto antes') })
  }
  const after = !!j.photo_end_url
  checks.push({ key: 'after', state: after ? 'ok' : photoNeeded ? 'bad' : 'info', label: after ? L('After photo', '作業後の写真', 'Foto depois') : L('No after photo', '作業後の写真なし', 'Sem foto depois') })
  // checklist
  const tot = Number(j.checklist_total) || 0
  if (tot > 0) {
    const dn = Math.min(tot, Number(j.checklist_done) || 0)
    checks.push({ key: 'checklist', state: dn >= tot ? 'ok' : 'bad', label: L(`Checklist ${dn}/${tot}`, `チェック ${dn}/${tot}`, `Checklist ${dn}/${tot}`) })
  }
  // GPS at the start
  const g = gpsCheck(j)
  if (g === 'away') checks.push({ key: 'gps', state: 'bad', label: L(`GPS ${fmtDist(j.gps_start_distance)} away`, `GPS 現場から${fmtDist(j.gps_start_distance)}`, `GPS a ${fmtDist(j.gps_start_distance)} do local`) })
  else if (g === 'on_site') checks.push({ key: 'gps', state: 'ok', label: L('GPS on site', 'GPS 現場', 'GPS no local') })
  // time spent vs planned
  const durMin = retro ? (Number(j.retro_time_min) || null) : jobDurationMin(j)
  const planned = Number(s.minutes) || 0
  if (!retro && j.started_at && j.completed_at) {
    const secs = Math.max(0, Math.round((new Date(j.completed_at) - new Date(j.started_at)) / 1000))
    const tooFast = planned > 0 && secs < 60 * Math.max(TOO_FAST_MIN, planned * TOO_FAST_SHARE)
    const shown = secs < 60 ? `${secs} s` : durText(Math.round(secs / 60))
    checks.push({ key: 'time', state: tooFast ? 'bad' : 'ok', label: tooFast ? L(`Too fast: ${shown}`, `短すぎ: ${shown}`, `Rápido demais: ${shown}`) : shown })
  }
  if (retro) checks.push({ key: 'retro', state: 'info', label: L('Registered afterwards', '事後登録', 'Registrado depois') })
  if (j.admin_reviewed) checks.push({ key: 'reviewed', state: 'ok', label: L('Checked by admin', '管理者確認済み', 'Conferido') })

  const issues = checks.filter(c => c.state === 'bad').map(c => c.label)
  return { verdict: issues.length && !j.admin_reviewed ? 'warn' : 'ok', done: true, checks, issues, durMin }
}

// v1.0.227 · one count with the Painel header: done (ok + warn) / working (started, not done) /
// todo (not started). A service in progress is never "done" and never "falta fazer".
const isWorking = r => r.c.verdict === 'todo' && r.s.phase === 'working'
const tally = (list, L) => {
  const rows = list.map(s => ({ s, c: serviceCheck(s, L) }))
  return {
    rows,
    total: rows.length,
    ok: rows.filter(r => r.c.verdict === 'ok').length,
    warn: rows.filter(r => r.c.verdict === 'warn').length,
    working: rows.filter(isWorking).length,
    todo: rows.filter(r => r.c.verdict === 'todo' && !isWorking(r)).length,
  }
}
const levelOf = t => (t.total === 0 ? 'none' : t.todo || t.working ? 'todo' : t.warn ? 'warn' : 'ok')

/**
 * Rows of the check list.
 *  by 'person' → one row per team member (also the ones with nothing today, at the end)
 *  by 'store'  → one row per store (contract stores with no job included)
 * Each row: { key, kind, title, sub, level: 'todo'|'warn'|'ok'|'none', ...tally, person?, store? }
 */
export function checkRows(panel, by = 'person', L = (en, ja, pt) => pt) {
  if (!panel) return []
  const all = [...(panel.stores || []).flatMap(st => st.services)]
  if (by === 'store') {
    return (panel.stores || []).map(st => {
      const t = tally(st.services, L)
      const level = st.noJob ? 'todo' : levelOf(t)
      return { key: `s:${st.key}`, kind: 'store', title: st.store, store: st, level, ...t } // v1.0.227 · a store with no job is not a service: shown under "Falta fazer" but not counted
    }).sort((a, b) => ORDER[a.level] - ORDER[b.level] || a.title.localeCompare(b.title))
  }
  return (panel.team || []).map(p => {
    // own services + the ones another person covered (shown as "feito por …")
    const mine = all.filter(s => s.assignedId === p.id)
    const t = tally(mine, L)
    return { key: `p:${p.id}`, kind: 'person', title: p.name, person: p, level: levelOf(t), ...t }
  }).sort((a, b) => ORDER[a.level] - ORDER[b.level] || a.title.localeCompare(b.title))
}
const ORDER = { todo: 0, warn: 1, ok: 2, none: 3 }

/** Filter: 'all' | 'working' | 'todo' | 'warn' | 'ok'. A row stays when it has at least one service of that kind. */
export function filterRows(rows, f) {
  if (!f || f === 'all') return rows
  return rows.filter(r => (r[f] || 0) > 0 || (f === 'todo' && r.store?.noJob))
}

/** Counts for the filter chips (services, not rows). */
export function checkCounts(rows) {
  return rows.reduce((a, r) => ({ total: a.total + r.total, ok: a.ok + r.ok, warn: a.warn + r.warn, working: a.working + (r.working || 0), todo: a.todo + r.todo }), { total: 0, ok: 0, warn: 0, working: 0, todo: 0 })
}

export { ON_SITE_METERS }
