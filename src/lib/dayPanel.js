// v1.0.151 · Painel do Dia — ONE source of numbers for the day (Painel, Reports, Agenda, Ao vivo, sino).
// Pure builder + one fetch. Everything is by STORE (a store with 2 services is done only when both are),
// plus one row per field employee with the shift state of THAT day.
//
// Shift of the day (employee_availability, one row per person per day):
//   kind 'confirmed' → ✅ Confirmado ("vou trabalhar")      (status approved, no approval needed)
//   kind 'off'       → ✕ Não posso (note = optional reason)  (pending/approved; rejected = no mark)
//   kind 'extra'     → ＋ Trabalho extra
//   no row           → SEM CONFIRMAÇÃO when the weekly pattern expects the person (or they have jobs)
//                      and the cut-off (21:00 of the day before) passed; before it: "aguardando".
// The weekly pattern (employees.work_days) is only the reference ("esperado"); it is never changed here.
// Jobs of a person who said "Não posso" are NOT reassigned and do not disappear: they show "sem cobertura".
import { splitName, contractTargets, jobFulfils, dowOf, addDays, workDaysOf } from './schedulePlan.js'
import { roleCan } from './employeeRoles.js'
import { isTestJob, isTestEmployee } from './testData.js'
import { coveredJobs } from './jobCoverage.js'
import { isLateJob } from './jobCounts.js'
import { isDeadlineJob, deadlineOf, otpRouteAlerts } from './jobDeadline.js'

export const SHIFT_CUTOFF = '21:00' // of the day before; configurable via buildDayPanel({ cutoff })
export const SHIFT_KINDS = ['confirmed', 'off', 'extra']

const norm = s => String(s || '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim()
export const storeOf = j => splitName(j?.title).base
const tokyoHM = iso => {
  if (!iso) return ''
  const d = new Date(new Date(iso).getTime() + 9 * 3600e3)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}
const firstName = n => String(n || '').trim().split(/\s+/)[0] || ''

/**
 * Service type of a job, for cards that must be told apart without opening them:
 * { kind: 'basic' | 'deep' | 'spot' | 'other', item } → "Básica" / "Deep Cleaning — Range Hood".
 */
export function serviceOf(job) {
  const rest = splitName(job?.title).rest
  if (job?.job_category === 'spot') return { kind: 'spot', item: rest }
  if (!rest || /basic|básic|limpeza básica/i.test(rest)) return { kind: 'basic', item: '' }
  const deep = /deep\s*clean(?:ing)?\s*\(([^)]*)\)/i.exec(rest)
  if (deep) return { kind: 'deep', item: deep[1].trim() }
  if (/deep/i.test(rest)) return { kind: 'deep', item: rest.replace(/deep\s*clean(?:ing)?/i, '').replace(/^[\s—–-]+|[\s—–-]+$/g, '') }
  return { kind: 'other', item: rest }
}
export function serviceLabel(job, L = (en, ja, pt) => pt) {
  const s = serviceOf(job)
  if (s.kind === 'basic') return L('Basic', 'ベーシック', 'Básica')
  if (s.kind === 'deep') return s.item ? `Deep Cleaning — ${s.item}` : 'Deep Cleaning'
  if (s.kind === 'spot') return s.item ? `Spot — ${s.item}` : 'Spot'
  return s.item || '—'
}

/** Mark of the day (or null). A rejected request counts as no mark. */
export function shiftMarkOf(row) {
  if (!row || row.status === 'rejected' || !SHIFT_KINDS.includes(row.kind)) return null
  return { kind: row.kind, reason: row.kind === 'off' ? (row.note || '') : '', status: row.status, at: row.updated_at || row.created_at || null, by: row.marked_by || null, byRole: row.marked_by_role || null }
}

/** The cut-off moment (ms) for marking `date`: 21:00 Tokyo of the day before. */
export function shiftCutoffMs(date, cutoff = SHIFT_CUTOFF) {
  return new Date(`${addDays(date, -1)}T${cutoff}:00+09:00`).getTime()
}

/**
 * Shift state of one person for `date`:
 *   confirmed | cant | extra | unconfirmed (expected, no mark, past cut-off) | awaiting (before cut-off) | not_expected
 */
export function shiftState({ emp, date, mark, hasJobs, now = new Date(), cutoff = SHIFT_CUTOFF }) {
  const wd = workDaysOf(emp)
  const expected = !!(wd && wd.has(dowOf(date)))
  if (mark?.kind === 'confirmed') return { state: 'confirmed', expected }
  if (mark?.kind === 'off') return { state: 'cant', expected }
  if (mark?.kind === 'extra') return { state: 'extra', expected }
  if (!expected && !hasJobs) return { state: 'not_expected', expected }
  return { state: now.getTime() >= shiftCutoffMs(date, cutoff) ? 'unconfirmed' : 'awaiting', expected }
}

const STORE_ORDER = { late: 0, not_started: 1, working: 2, done: 3 }

/**
 * jobs: jobs of `date` (any status; cancelled and test jobs are left out here).
 * employees: rows of employees. availability: employee_availability rows of `date`.
 * targets: contractTargets() (optional; weekly contract places with no job become "sem job criado").
 * owners: usual person per store (norm(base) → employee id), to know who "costuma cobrir" a store.
 */
export function buildDayPanel({ date, jobs = [], employees = [], availability = [], targets = [], owners = {}, now = new Date(), nowMin = null, cutoff = SHIFT_CUTOFF, keepTests = false, today = null }) {
  const live = (jobs || []).filter(j => j && j.scheduled_date === date && j.status !== 'cancelled' && (keepTests || !isTestJob(j)))
  const cov = coveredJobs(live) // A.id → B (completed the same service)
  const nm = nowMin ?? (() => { const d = new Date(now.getTime() + 9 * 3600e3); return d.getUTCHours() * 60 + d.getUTCMinutes() })()
  const day = today || (() => { const d = new Date(now.getTime() + 9 * 3600e3); return d.toISOString().slice(0, 10) })()
  const empById = Object.fromEntries((employees || []).map(e => [e.id, e]))
  const marks = {}
  for (const r of availability || []) if (r.date === date) { const m = shiftMarkOf(r); if (m) marks[r.employee_id] = m }
  const cantIds = new Set(Object.entries(marks).filter(([, m]) => m.kind === 'off').map(([id]) => id))

  // ---- services (one per job; a covered A job becomes "feito por B") ----
  const services = []
  for (const j of live) {
    const b = cov.get(j.id)
    const done = !!b || j.status === 'completed'
    const late = !done && isLateJob(j, day, nm)
    const svc = {
      id: j.id, job: j, store: storeOf(j), service: serviceOf(j), assigned: j.employee_name || '', assignedId: j.employee_id || null,
      status: done ? 'done' : j.status === 'in_progress' ? 'working' : late ? 'late' : 'not_started',
      late, deadline: deadlineOf(j), time: isDeadlineJob(j) ? null : String(j.scheduled_time || '').slice(0, 5) || null,
      doneBy: b ? (b.employee_name || '') : (done ? j.employee_name || '' : ''), doneAt: tokyoHM(b ? b.completed_at : j.completed_at),
      coveredBy: b ? (b.employee_name || '') : '', startedAt: tokyoHM(j.started_at),
      uncovered: !done && (!j.employee_id || cantIds.has(j.employee_id)),
      noPerson: !done && !j.employee_id,
    }
    if (svc.status === 'working' && svc.late) svc.status = 'late' // deadline jobs running past the deadline
    services.push(svc)
  }
  // B's own completed job for a service it covered is the same service: count it once (under A's line)
  const coverers = new Set([...cov.values()].map(b => b.id))
  const counted = services.filter(s => !coverers.has(s.id))

  // ---- stores ----
  const byStore = new Map()
  for (const s of counted) {
    const k = norm(s.store)
    if (!byStore.has(k)) byStore.set(k, { key: k, store: s.store, clientName: s.job.client_name || '', services: [] })
    byStore.get(k).services.push(s)
  }
  // weekly contract places due today with no job at all → the store exists, nobody will do it
  for (const t of targets || []) {
    if (t.kind !== 'weekly' || !t.days.includes(dowOf(date))) continue
    const k = norm(t.base)
    if (byStore.has(k)) continue
    if (live.some(j => jobFulfils(j.title, t))) continue
    const ownerId = owners[k] || null
    byStore.set(k, { key: k, store: t.base, clientName: t.clientName || '', services: [], noJob: true, usualId: ownerId, usualName: empById[ownerId]?.full_name || '' })
  }
  const stores = [...byStore.values()].map(st => {
    const sv = st.services
    const doneN = sv.filter(s => s.status === 'done').length
    const allDone = sv.length > 0 && doneN === sv.length
    const anyLate = sv.some(s => s.status === 'late')
    const anyWorking = sv.some(s => s.status === 'working') || (doneN > 0 && !allDone)
    const state = st.noJob ? 'not_started' : allDone ? 'done' : anyLate ? 'late' : anyWorking ? 'working' : 'not_started'
    const doneBy = [...new Set(sv.filter(s => s.status === 'done').map(s => s.doneBy).filter(Boolean))]
    const doneAt = sv.map(s => s.doneAt).filter(Boolean).sort().pop() || ''
    const workers = [...new Set(sv.filter(s => s.status === 'working').map(s => s.assigned).filter(Boolean))]
    const since = sv.map(s => s.startedAt).filter(Boolean).sort()[0] || ''
    const people = [...new Set(sv.map(s => s.assigned).filter(Boolean))]
    const covered = sv.some(s => s.coveredBy)
    const uncovered = !!st.noJob || sv.some(s => s.uncovered)
    const deadline = sv.map(s => s.deadline).find(Boolean) || null
    const firstTime = sv.map(s => s.time).filter(Boolean).sort()[0] || null
    return { ...st, state, doneN, total: sv.length, doneBy, doneAt, workers, since, people, covered, uncovered, deadline, firstTime }
  }).sort((a, b) => STORE_ORDER[a.state] - STORE_ORDER[b.state] || a.store.localeCompare(b.store))

  // ---- team: every field employee, also the ones with nothing today ----
  const team = []
  const seenEmp = new Set()
  const people = (employees || []).filter(e => e.is_active !== false && (keepTests || !isTestEmployee(e)))
  for (const emp of people) {
    const mine = services.filter(s => s.assignedId === emp.id && !s.coveredBy)
    const coveredMine = services.filter(s => s.assignedId === emp.id && s.coveredBy)
    if (!mine.length && !coveredMine.length && !roleCan(emp.job_role, 'routes')) continue
    seenEmp.add(emp.id)
    const mark = marks[emp.id] || null
    const sh = shiftState({ emp, date, mark, hasJobs: mine.length > 0, now, cutoff })
    const usual = stores.filter(st => st.noJob && st.usualId === emp.id)
    const notDone = mine.filter(s => s.status !== 'done')
    const firstStart = mine.map(s => s.startedAt).filter(Boolean).sort()[0] || ''
    const noServiceReason = mine.length || coveredMine.length ? null : mark?.kind === 'off' ? 'off' : !sh.expected ? 'weekday' : 'none'
    team.push({
      id: emp.id, name: emp.full_name || '—', first: firstName(emp.full_name), mark, ...sh,
      total: mine.length, done: mine.filter(s => s.status === 'done').length, working: mine.filter(s => s.status === 'working').length,
      late: mine.filter(s => s.status === 'late').length, notStarted: mine.filter(s => s.status === 'not_started').length,
      coveredByOthers: coveredMine.map(s => s.coveredBy), firstStart, noServiceReason,
      uncoveredStores: sh.state === 'cant' ? [...new Set([...notDone.map(s => s.store), ...usual.map(u => u.store)])] : [],
    })
  }
  // jobs of people who are not in the employee list (inactive / deleted): still visible
  for (const s of services) {
    if (!s.assignedId || seenEmp.has(s.assignedId)) continue
    seenEmp.add(s.assignedId)
    const mine = services.filter(x => x.assignedId === s.assignedId && !x.coveredBy)
    team.push({ id: s.assignedId, name: s.assigned || '—', first: firstName(s.assigned), mark: marks[s.assignedId] || null, state: 'unconfirmed', expected: false,
      total: mine.length, done: mine.filter(x => x.status === 'done').length, working: mine.filter(x => x.status === 'working').length,
      late: mine.filter(x => x.status === 'late').length, notStarted: mine.filter(x => x.status === 'not_started').length,
      coveredByOthers: [], firstStart: mine.map(x => x.startedAt).filter(Boolean).sort()[0] || '', noServiceReason: null, uncoveredStores: [] })
  }
  const TEAM_ORDER = p => (p.late ? 0 : p.total && p.done < p.total ? 1 : p.total ? 2 : 3)
  team.sort((a, b) => TEAM_ORDER(a) - TEAM_ORDER(b) || a.name.localeCompare(b.name))

  // ---- alerts of the day (same items as the bell's "sem cobertura" / route groups) ----
  const alerts = []
  if (date === day) for (const a of otpRouteAlerts(live, { today: day, nowMin: nm })) if (!a.startedAt) alerts.push({ id: a.id, kind: 'route', who: a.employeeName, employeeId: a.employeeId, n: a.jobs })
  for (const p of team) if (p.state === 'cant' && p.uncoveredStores.length) alerts.push({ id: `cant:${date}:${p.id}`, kind: 'cant', who: p.name, employeeId: p.id, n: p.uncoveredStores.length, stores: p.uncoveredStores, reason: p.mark?.reason || '', at: p.mark?.at || null, byRole: p.mark?.byRole || null })
  const noPersonStores = stores.filter(st => st.services.some(s => s.noPerson))
  if (noPersonStores.length) alerts.push({ id: `noperson:${date}`, kind: 'no_person', n: noPersonStores.length, stores: noPersonStores.map(s => s.store) })
  const noJobStores = stores.filter(st => st.noJob)
  if (noJobStores.length) alerts.push({ id: `nojob:${date}`, kind: 'no_job', n: noJobStores.length, stores: noJobStores.map(s => s.store) })
  const lateStores = stores.filter(st => st.state === 'late')
  if (lateStores.length) alerts.push({ id: `late:${date}`, kind: 'late', n: lateStores.length, services: counted.filter(s => s.status === 'late').length, stores: lateStores.map(s => s.store) })

  const count = {
    stores: stores.length, storesDone: stores.filter(s => s.state === 'done').length, storesWorking: stores.filter(s => s.state === 'working').length,
    storesLate: lateStores.length, storesNotStarted: stores.filter(s => s.state === 'not_started').length,
    storesCovered: stores.filter(s => s.covered).length, storesUncovered: stores.filter(s => s.uncovered && s.state !== 'done').length,
    services: counted.length, servicesDone: counted.filter(s => s.status === 'done').length, servicesWorking: counted.filter(s => s.status === 'working').length,
    servicesLate: counted.filter(s => s.status === 'late').length, servicesNotStarted: counted.filter(s => s.status === 'not_started').length,
  }
  return { date, count, stores, team, alerts, services: counted }
}

/** Several days (Reports "Semana"): the same numbers summed, stores of each day kept apart. */
export function mergePanels(panels = []) {
  const count = {}
  for (const p of panels) for (const [k, v] of Object.entries(p.count)) count[k] = (count[k] || 0) + v
  return { count, days: panels }
}

// ---------- texts (PT first; L = (en, ja, pt)) ----------
/** Correct plural: plural(1,'loja','lojas') → '1 loja'. */
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

export function shiftBadge(p, L = (en, ja, pt) => pt) {
  switch (p.state) {
    case 'confirmed': return { cls: 'ok', text: L('✅ Confirmed', '✅ 確認済み', '✅ Confirmado') }
    case 'cant': return { cls: 'bad', text: L("✕ Can't", '✕ 不可', '✕ Não pode') + (p.mark?.reason ? ` · ${p.mark.reason}` : '') }
    case 'extra': return { cls: 'info', text: L('＋ Extra work', '＋ 追加勤務', '＋ Trabalho extra') }
    case 'unconfirmed': return { cls: 'warn', text: L('NO CONFIRMATION', '未確認', 'SEM CONFIRMAÇÃO') }
    case 'awaiting': return { cls: 'muted', text: L('waiting for confirmation', '確認待ち', 'aguardando confirmação') }
    default: return { cls: 'muted', text: L('not expected', '予定外', 'fora do padrão semanal') }
  }
}

/** "0 de 10 · nada iniciado · 10 atrasados" / "nenhum serviço hoje" (+ why). */
export function teamProgressText(p, L = (en, ja, pt) => pt) {
  if (!p.total) {
    const why = p.noServiceReason === 'off' ? L('day off marked', '休みの申請あり', 'folga marcada') : p.noServiceReason === 'weekday' ? L('outside the weekly pattern', '週の予定外', 'fora do padrão semanal') : ''
    const base = p.coveredByOthers?.length ? L(`all covered by ${p.coveredByOthers.join(', ')}`, `${p.coveredByOthers.join(', ')}が対応`, `tudo coberto por ${p.coveredByOthers.join(', ')}`) : L('no service today', '本日の作業なし', 'nenhum serviço hoje')
    return [base, why].filter(Boolean).join(' · ')
  }
  const parts = [L(`${p.done} of ${p.total}`, `${p.total}件中${p.done}件`, `${p.done} de ${p.total}`)]
  if (!p.done && !p.working) parts.push(L('nothing started', '未着手', 'nada iniciado'))
  else if (p.working) parts.push(L(`${p.working} in progress`, `${p.working}件作業中`, `${p.working} em andamento`))
  if (p.late) parts.push(L(`${p.late} late`, `${p.late}件遅れ`, p.late === 1 ? '1 atrasado' : `${p.late} atrasados`))
  if (p.coveredByOthers?.length) parts.push(L(`${p.coveredByOthers.length} covered by others`, `${p.coveredByOthers.length}件 他の人が対応`, p.coveredByOthers.length === 1 ? `1 coberto por ${p.coveredByOthers[0]}` : `${p.coveredByOthers.length} cobertos por outros`))
  return parts.join(' · ')
}

export function storeStateText(st, L = (en, ja, pt) => pt) {
  const who = list => list.join(', ')
  if (st.state === 'done') return L(`Done${st.doneBy.length ? ` by ${who(st.doneBy)}` : ''}${st.doneAt ? ` · ${st.doneAt}` : ''}`, `完了${st.doneBy.length ? `（${who(st.doneBy)}）` : ''}${st.doneAt ? ` · ${st.doneAt}` : ''}`, `Feita${st.doneBy.length ? ` por ${who(st.doneBy)}` : ''}${st.doneAt ? ` · ${st.doneAt}` : ''}`)
  if (st.state === 'working') return L(`In progress${st.workers.length ? ` · ${who(st.workers)}` : ''}${st.since ? ` since ${st.since}` : ''}`, `作業中${st.workers.length ? `（${who(st.workers)}）` : ''}${st.since ? ` ${st.since}から` : ''}`, `Em andamento${st.workers.length ? ` · ${who(st.workers)}` : ''}${st.since ? ` desde ${st.since}` : ''}`)
  if (st.noJob) return L(`Not started · no job created${st.usualName ? ` (usually ${st.usualName})` : ''}`, `未開始・作業未作成${st.usualName ? `（通常 ${st.usualName}）` : ''}`, `Não iniciada · sem serviço criado${st.usualName ? ` (costuma ser ${st.usualName})` : ''}`)
  if (st.state === 'late') return L(`Late${st.deadline ? ` · deadline ${st.deadline}` : st.firstTime ? ` · planned ${st.firstTime}` : ''}`, `遅れ${st.deadline ? ` · 期限 ${st.deadline}` : st.firstTime ? ` · 予定 ${st.firstTime}` : ''}`, `Atrasada${st.deadline ? ` · prazo ${st.deadline}` : st.firstTime ? ` · previsto ${st.firstTime}` : ''}`)
  return L(`Not started${st.deadline ? ` · deadline ${st.deadline}` : st.firstTime ? ` · planned ${st.firstTime}` : ''}`, `未開始${st.deadline ? ` · 期限 ${st.deadline}` : st.firstTime ? ` · 予定 ${st.firstTime}` : ''}`, `Não iniciada${st.deadline ? ` · prazo ${st.deadline}` : st.firstTime ? ` · previsto ${st.firstTime}` : ''}`)
}

export function alertText(a, L = (en, ja, pt) => pt) {
  if (a.kind === 'route') return L(`Route has not started — ${a.who} (${a.n} services)`, `ルート未開始 — ${a.who}（${a.n}件）`, `Rota não começou — ${a.who} (${plural(a.n, 'serviço', 'serviços')})`)
  if (a.kind === 'cant') return L(`${a.who} can't today — ${a.n} store${a.n === 1 ? '' : 's'} without cover`, `${a.who} 本日不可 — ${a.n}店舗 担当なし`, `${a.who} não pode hoje — ${plural(a.n, 'loja sem cobertura', 'lojas sem cobertura')}`) + (a.reason ? ` (“${a.reason}”)` : '')
  if (a.kind === 'no_person') return L(`${a.n} store${a.n === 1 ? '' : 's'} with nobody assigned`, `担当者なし ${a.n}店舗`, `${plural(a.n, 'loja', 'lojas')} sem pessoa atribuída`)
  if (a.kind === 'no_job') return L(`${a.n} contract store${a.n === 1 ? '' : 's'} with no job created`, `作業未作成の契約店舗 ${a.n}`, `${plural(a.n, 'loja do contrato', 'lojas do contrato')} sem serviço criado`)
  if (a.kind === 'late') return L(`${a.n} store${a.n === 1 ? '' : 's'} late (${a.services} services)`, `遅れ ${a.n}店舗（${a.services}件）`, `${plural(a.n, 'loja atrasada', 'lojas atrasadas')} (${plural(a.services, 'serviço', 'serviços')})`)
  return ''
}

// ---------- fetch ----------
/** Load `from..to` (inclusive) and return one panel per day (newest first). */
export async function fetchDayPanels(from, to = from, { nowMin = null, now = new Date(), today = null } = {}) {
  const { supabase } = await import('./supabase.js')
  const [c, cl, e, j, h, av] = await Promise.all([
    supabase.from('service_contracts').select('*').eq('is_active', true),
    supabase.from('clients').select('id,company_name,is_active'),
    supabase.from('employees').select('*'),
    supabase.from('jobs').select('id,title,description,client_id,client_name,scheduled_date,scheduled_time,status,employee_id,employee_name,job_category,spot_status,started_at,completed_at,admin_reviewed,retro_report')
      .gte('scheduled_date', from).lte('scheduled_date', to).limit(5000),
    supabase.from('jobs').select('title,employee_id').gte('scheduled_date', addDays(from, -28)).lt('scheduled_date', from)
      .not('employee_id', 'is', null).neq('status', 'cancelled').limit(3000),
    supabase.from('employee_availability').select('*').gte('date', from).lte('date', to),
  ])
  if (j.error) throw j.error
  const employees = e.data || []
  const empById = Object.fromEntries(employees.map(x => [x.id, x]))
  const owners = usualOwners(h.data || [], empById)
  const targets = c.error ? [] : contractTargets(c.data || [], cl.data || [])
  const out = []
  for (let d = to; d >= from; d = addDays(d, -1)) {
    out.push(buildDayPanel({ date: d, jobs: (j.data || []).filter(x => x.scheduled_date === d), employees, availability: (av.data || []).filter(x => x.date === d), targets, owners, now, nowMin, today }))
  }
  return out
}
export const fetchDayPanel = async (date, opts) => (await fetchDayPanels(date, date, opts))[0]

/** Who did each store most in `history` → { 'kodama oimachi': employeeId } (active people only). */
export function usualOwners(history, empById = {}) {
  const counts = {}
  for (const j of history || []) {
    const emp = empById[j.employee_id]
    if (!emp || emp.is_active === false) continue
    const p = norm(splitName(j.title).base)
    counts[p] = counts[p] || {}
    counts[p][j.employee_id] = (counts[p][j.employee_id] || 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).map(([p, c]) => [p, Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]]))
}
