import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { useLang, localeOf } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import {
  SCHEDULE_ROUTES, buildMonthSchedule, assignEmployees, availabilityIndex, jobsToRows,
  locationsFromContracts, DEFAULT_LOCATIONS, DOW_EN, DOW_JA,
} from '../lib/scheduleGenerator'
import {
  periodDays, canWork, outOfSchedule, contractTargets, dupKey, dowOf, isTestAccount, addDays,
} from '../lib/schedulePlan'
import {
  asItem, pendingReason, conflictsFor, suggestPeople, planBatch, placeInDay, coverageCounts, requiredRole,
  weekOf, indexByEmp,
} from '../lib/assignFlow'
import { roleCan } from '../lib/employeeRoles'
import { assignJob, assignMany, offerJob, notifyCreated } from '../lib/assignOps'
import { pendingChanged } from '../lib/adminPending'
import { assignText, conflictLabel, RED_CONFLICTS } from '../components/assignText'
import '../components/assign.css'

// v1.0.101 · Generate and assign are one flow. The generator preview IS the Pending box: every
// service of the period that has no person shows here (not created yet, created without a person,
// declined spot, person off / inactive, open offer), with the reason, a suggested person to accept
// with one tap, a board to drag jobs to people, and an urgent offer to everyone with the role.
// Two counts stay on top: PROGRAMMED (created × contract) and ASSIGNED (with person × created).

const OWNERS_KEY = 'kp_schedule_route_owners'
function readStored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
function writeStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode */ }
}
const defaultTime = t => (t.kind === 'weekly' ? (/atomic/i.test(t.base) ? '21:00' : '00:30') : '09:00')
const firstName = e => (e?.full_name || '').split(' ')[0]
const byTime = (a, b) => a.date.localeCompare(b.date) || String(a.time || '99:99').localeCompare(String(b.time || '99:99')) || String(a.title).localeCompare(String(b.title))

/** sequence_order for new rows (and changed neighbours) so each lands in the right place of the person's day. */
function sequenceFor(newRows, existing) {
  const seqOf = new Map()
  const updates = []
  const groups = {}
  for (const r of newRows) (groups[`${r.employeeId || ''}|${r.date}`] = groups[`${r.employeeId || ''}|${r.date}`] || []).push(r)
  for (const [k, list] of Object.entries(groups)) {
    const [emp, date] = k.split('|')
    const orig = emp ? existing.filter(j => j.employee_id === emp && j.scheduled_date === date && j.status !== 'cancelled') : []
    let day = orig.map(j => ({ id: j.id, scheduled_time: j.scheduled_time, title: j.title, sequence_order: j.sequence_order }))
    for (const r of [...list].sort(byTime)) {
      const ups = placeInDay(day, { id: r.key, scheduled_time: r.time, title: r.title })
      day = [...day, { id: r.key, scheduled_time: r.time, title: r.title, sequence_order: null }]
      for (const u of ups) { const d = day.find(x => x.id === u.id); if (d) d.sequence_order = u.sequence_order }
    }
    for (const d of day) {
      if (list.some(r => r.key === d.id)) seqOf.set(d.id, d.sequence_order)
      else if (Number(orig.find(o => o.id === d.id)?.sequence_order) !== d.sequence_order) updates.push({ id: d.id, sequence_order: d.sequence_order })
    }
  }
  return { seqOf, updates }
}

export default function ScheduleGenerator() {
  const { lang, tr } = useLang()
  const T = useMemo(() => assignText(tr), [lang])
  const dateLocale = localeOf(lang)
  const dowLabels = tr(DOW_EN, DOW_JA, ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'])

  // ---- period ----
  const [kind, setKind] = useState('week')
  const [anchor, setAnchor] = useState(tokyoToday)
  const [month, setMonth] = useState(() => tokyoToday().slice(0, 7))
  const [templates, setTemplates] = useState(() => new Set(SCHEDULE_ROUTES.map(r => r.key)))
  const [owners, setOwners] = useState(() => readStored(OWNERS_KEY, {}))
  const [showTemplates, setShowTemplates] = useState(false)
  const days = useMemo(() => periodDays(kind, anchor, month), [kind, anchor, month])
  const wholeMonth = kind === 'month'
  // Week loads need whole weeks around the period.
  const range = useMemo(() => [weekOf(days[0])[0], weekOf(days[days.length - 1])[6]], [days])

  // ---- data ----
  const [employees, setEmployees] = useState([])
  const [contracts, setContracts] = useState([])
  const [clients, setClients] = useState([])
  const [existing, setExisting] = useState([])
  const [history, setHistory] = useState([])
  const [availRows, setAvailRows] = useState([])
  const [loaded, setLoaded] = useState(false)

  // ---- pending box ----
  const [rows, setRows] = useState([]) // not created yet (generator preview)
  const [choice, setChoice] = useState({}) // existing job id → employee id ('' = nobody)
  const [jobSkip, setJobSkip] = useState(() => new Set())
  const [forced, setForced] = useState(() => new Set())
  const [view, setView] = useState('list')
  const [filter, setFilter] = useState('all')
  const [offerFor, setOfferFor] = useState(null)
  const [busy, setBusy] = useState(null)
  const [sqlMissing, setSqlMissing] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('employees').select('*').order('full_name'),
      supabase.from('service_contracts').select('*').eq('is_active', true),
      supabase.from('clients').select('id,company_name,is_active'),
    ]).then(([e, c, cl]) => {
      setEmployees((e.data || []).map(({ password, pin, ...rest }) => rest))
      setContracts(c.data || [])
      setClients(cl.data || [])
    })
  }, [])

  const fetchExisting = async () => {
    const { data } = await supabase.from('jobs').select('*')
      .gte('scheduled_date', range[0]).lte('scheduled_date', range[1]).limit(5000)
    setExisting(data || [])
    return data || []
  }
  const loadPeriod = async () => {
    setLoaded(false)
    const [, av, hist] = await Promise.all([
      fetchExisting(),
      supabase.from('employee_availability').select('employee_id,date,kind,status').gte('date', range[0]).lte('date', range[1]),
      supabase.from('jobs').select('title,employee_id').gte('scheduled_date', addDays(days[0], -28)).lt('scheduled_date', days[0])
        .not('employee_id', 'is', null).neq('status', 'cancelled').limit(3000),
    ])
    setAvailRows(av.data || [])
    setHistory(hist.data || [])
    setChoice({}); setJobSkip(new Set())
    setLoaded(true)
  }
  useEffect(() => { loadPeriod() }, [days[0], days[days.length - 1]])

  const inPeriod = useMemo(() => new Set(days), [days])
  const empById = useMemo(() => Object.fromEntries(employees.map(e => [e.id, e])), [employees])
  const activeEmployees = useMemo(() => employees.filter(e => e.is_active !== false && !isTestAccount(e)), [employees])
  const availability = useMemo(() => availabilityIndex(availRows), [availRows])
  const targets = useMemo(() => contractTargets(contracts, clients), [contracts, clients])
  const locations = useMemo(() => (contracts.length ? locationsFromContracts(contracts) : DEFAULT_LOCATIONS), [contracts])
  const periodJobs = useMemo(() => existing.filter(j => inPeriod.has(j.scheduled_date)), [existing, inPeriod])
  const liveJobs = useMemo(() => periodJobs.filter(j => j.status !== 'cancelled'), [periodJobs])
  const existingKeys = useMemo(() => new Set(liveJobs.map(j => dupKey(j.scheduled_date, j.title))), [liveJobs])

  // Who usually does each place (last 4 weeks) — only the first suggestion, never a lock.
  const placeOwners = useMemo(() => {
    const counts = {}
    for (const j of history) {
      if (!empById[j.employee_id] || empById[j.employee_id].is_active === false) continue
      const p = asItem({ ...j, scheduled_date: '' }).place.toLowerCase()
      counts[p] = counts[p] || {}
      counts[p][j.employee_id] = (counts[p][j.employee_id] || 0) + 1
    }
    return Object.fromEntries(Object.entries(counts).map(([p, c]) => [p, Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]]))
  }, [history, empById])

  const workIndex = useMemo(() => {
    const idx = { ...availability }
    for (const e of employees) for (const d of days) {
      if (!canWork(e, d, availability, forced).ok) idx[`${e.id}|${d}`] = { kind: 'off', status: 'approved' }
    }
    return idx
  }, [employees, days, availability, forced])
  const pool = useMemo(() => employees.filter(e => days.some(d => canWork(e, d, availability, forced).ok)), [employees, days, availability, forced])

  // Jobs that already count for loads / same-time checks (valid owner).
  const plannedItems = useMemo(() => existing
    .filter(j => j.status !== 'cancelled' && j.employee_id && !pendingReason(j, { empById, availability }))
    .map(asItem), [existing, empById, availability])

  // ---- generator preview = "not created yet" lines ----
  const buildRows = () => {
    if (!employees.length) return
    const months = [...new Set(days.map(d => d.slice(0, 7)))]
    const routes = SCHEDULE_ROUTES.filter(r => templates.has(r.key))
    const base = months.flatMap((m, mi) => buildMonthSchedule(m, { routes, locations }).map(j => ({ ...j, id: mi * 100000 + Number(j.id) })))
      .filter(j => inPeriod.has(j.date))
    const suggested = {}
    for (const [k, v] of Object.entries(owners)) if (v && pool.some(e => e.id === v)) suggested[k] = v
    const seen = new Set(existingKeys)
    const next = []
    for (const j of assignEmployees(base, { employees: pool, availability: workIndex, owners: suggested })) {
      const k = dupKey(j.date, j.title)
      if (seen.has(k)) continue
      seen.add(k)
      next.push({ ...j, key: `t${j.id}`, checked: true, source: 'template' })
    }
    // Every contract visit not in a template comes in too: nothing due stays invisible.
    const cov = coverageCounts(targets, days, [...liveJobs, ...next.map(r => ({ scheduled_date: r.date, title: r.title, status: 'assigned' }))], { wholeMonth })
    const extra = cov.missing.map(m => ({
      key: `c${m.target.id}|${m.date}`, id: `c${m.target.id}|${m.date}`, date: m.date, time: defaultTime(m.target),
      title: `${m.target.base} — ${m.target.service}`, client: m.target.clientName, clientId: m.target.clientId,
      address: m.target.address || null, description: null, routeKey: 'contract', type: /deep/i.test(m.target.service) ? 'deep' : 'basic',
      category: m.target.kind === 'weekly' ? 'regular' : 'maintenance', value: m.target.price || null, seq: 1,
      employeeId: null, employee: '', employeeName: null, assignReason: 'auto', checked: true, source: 'contract',
    }))
    const plan = planBatch(extra.map(asItem), {
      employees: activeEmployees, availability, owners: placeOwners,
      jobs: [...plannedItems, ...next.filter(r => r.employeeId).map(asItem)],
    })
    for (const r of extra) {
      const p = plan.get(r.key)
      if (p) Object.assign(r, { employeeId: p.emp.id, employee: firstName(p.emp), employeeName: p.emp.full_name, why: p.why })
    }
    setRows([...next, ...extra].sort(byTime))
  }
  useEffect(() => { if (loaded) buildRows() }, [loaded, employees, locations, templates, owners, forced])

  const setRowPerson = (key, id) => {
    const emp = empById[id]
    setRows(rs => rs.map(r => r.key === key ? { ...r, employeeId: id || null, employee: firstName(emp), employeeName: emp?.full_name || null, assignReason: 'manual', why: [] } : r))
  }
  const editRow = (key, patch) => setRows(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r))

  // ---- existing jobs waiting for a person ----
  const pendingJobs = useMemo(() => periodJobs
    .map(j => ({ job: j, reason: pendingReason(j, { empById, availability }) }))
    .filter(p => p.reason)
    // a declined spot that was already replaced by another job of the same visit is not pending
    .filter(p => p.reason !== 'spotDeclined' || !existingKeys.has(dupKey(p.job.scheduled_date, p.job.title))), [periodJobs, empById, availability, existingKeys])

  const ctxJobs = useMemo(() => [
    ...plannedItems,
    ...rows.filter(r => r.checked && r.employeeId).map(asItem),
  ], [plannedItems, rows])
  const ctx = useMemo(() => ({ employees: activeEmployees, availability, owners: placeOwners, jobs: ctxJobs, byEmp: indexByEmp(ctxJobs) }),
    [activeEmployees, availability, placeOwners, ctxJobs])

  const jobPlan = useMemo(() => planBatch(
    pendingJobs.filter(p => p.reason !== 'offerOpen').map(p => asItem(p.job)),
    { employees: activeEmployees, availability, owners: placeOwners, jobs: plannedItems },
  ), [pendingJobs, activeEmployees, availability, placeOwners, plannedItems])

  // One list for both kinds of pending line.
  const lines = useMemo(() => {
    const fromRows = rows.map(r => ({
      key: r.key, kind: 'new', row: r, item: asItem(r), checked: r.checked,
      reason: r.source === 'contract' ? 'contractMissing' : 'notCreated',
      personId: r.employeeId || '',
      why: r.why?.length ? r.why : r.assignReason === 'owner' ? ['route'] : r.assignReason === 'ownerOff' ? ['covering'] : r.employeeId && r.assignReason === 'auto' ? ['onRoute'] : [],
      coveringFor: r.coveringFor,
    }))
    const fromJobs = pendingJobs.map(({ job, reason }) => {
      const sug = jobPlan.get(job.id)
      const personId = Object.prototype.hasOwnProperty.call(choice, job.id) ? choice[job.id] : (reason === 'offerOpen' ? '' : sug?.emp.id || '')
      return {
        key: job.id, kind: 'job', job, item: asItem(job), reason, personId,
        checked: reason !== 'offerOpen' && !!personId && !jobSkip.has(job.id),
        why: !Object.prototype.hasOwnProperty.call(choice, job.id) && sug ? sug.why : [],
      }
    })
    return [...fromRows, ...fromJobs].sort((a, b) => byTime(a.item, b.item))
  }, [rows, pendingJobs, jobPlan, choice, jobSkip])

  // Ranked people per line (options of the select + warnings of the chosen one).
  const rankings = useMemo(() => {
    const m = new Map()
    for (const l of lines) m.set(l.key, suggestPeople(l.item, ctx))
    return m
  }, [lines, ctx])
  const warningsOf = l => (l.personId ? rankings.get(l.key)?.find(r => r.emp.id === l.personId)?.conflicts || [{ kind: 'unknown' }] : [])

  // ---- counts ----
  const counts = useMemo(() => coverageCounts(targets, days, periodJobs, { wholeMonth, empById, availability }), [targets, days, periodJobs, wholeMonth, empById, availability])
  const ready = liveJobs.filter(j => !pendingReason(j, { empById, availability })).length

  // ---- writes ----
  const after = (r) => {
    if (r?.notices?.missing) setSqlMissing(true)
    pendingChanged()
  }

  /** Create preview rows (with or without person), each in the right place of the person's day. */
  const createRows = async (list, { asOffer = null } = {}) => {
    if (!list.length) return { created: 0, dup: 0 }
    const { data: now } = await supabase.from('jobs').select('title,scheduled_date')
      .gte('scheduled_date', days[0]).lte('scheduled_date', days[days.length - 1]).neq('status', 'cancelled').limit(5000)
    const taken = new Set((now || []).map(j => dupKey(j.scheduled_date, j.title)))
    const toCreate = []
    let dup = 0
    for (const r of list) {
      const k = dupKey(r.date, r.title)
      if (taken.has(k)) { dup++; continue }
      taken.add(k)
      toCreate.push(asOffer ? { ...r, employeeId: null, employee: '', employeeName: null } : r)
    }
    const { seqOf, updates } = sequenceFor(toCreate, existing)
    const payload = jobsToRows(toCreate.map(r => ({ ...r, seq: seqOf.get(r.key) || 1 })))
      .map(p => (asOffer ? { ...p, job_category: 'spot', spot_status: 'pending', spot_value: Number(asOffer.value) || 0 } : p))
    const inserted = []
    let error = null
    for (let i = 0; i < payload.length; i += 50) {
      const { data, error: err } = await supabase.from('jobs').insert(payload.slice(i, i + 50)).select()
      if (err) error = err.message; else inserted.push(...(data || []))
    }
    if (updates.length) await Promise.all(updates.map(({ id, ...p }) => supabase.from('jobs').update(p).eq('id', id)))
    const notices = await notifyCreated(inserted)
    // Lines that now exist in the database (created now or already there) leave the box.
    const nowExists = new Set([...(now || []), ...inserted].map(j => dupKey(j.scheduled_date, j.title)))
    setRows(rs => rs.filter(r => !nowExists.has(dupKey(r.date, r.title))))
    if (error) toast.error(error)
    after({ notices })
    return { created: inserted.length, dup }
  }

  const doLine = async (l) => {
    setBusy(l.key)
    try {
      if (l.kind === 'new') {
        const { created, dup } = await createRows([l.row])
        if (created) toast.success(l.personId ? tr(`Created and given to ${firstName(empById[l.personId])}`, `作成して${firstName(empById[l.personId])}さんに割当`, `Criado e atribuído a ${firstName(empById[l.personId])}`) : tr('Created without a person', '担当なしで作成', 'Criado sem pessoa'))
        if (dup) toast(tr('Already existed — not duplicated.', '既に存在 — 重複なし', 'Já existia — não duplicado.'))
      } else {
        const r = await assignJob(l.job, empById[l.personId] || null)
        toast.success(tr(`Given to ${firstName(empById[l.personId])}`, `${firstName(empById[l.personId])}さんに割当`, `Atribuído a ${firstName(empById[l.personId])}`))
        after(r)
      }
      await fetchExisting()
    } catch (err) { toast.error(err.message) }
    setBusy(null)
  }

  const confirmAll = async () => {
    const newOnes = lines.filter(l => l.kind === 'new' && l.checked).map(l => l.row)
    const jobOnes = lines.filter(l => l.kind === 'job' && l.checked && l.personId)
    if (!newOnes.length && !jobOnes.length) return
    setBusy('all')
    try {
      const c = await createRows(newOnes)
      const a = await assignMany(jobOnes.map(l => ({ job: l.job, emp: empById[l.personId] })))
      after(a)
      toast.success(tr(`${c.created} created · ${a.done} assigned`, `${c.created}件作成・${a.done}件割当`, `${c.created} criados · ${a.done} atribuídos`))
      if (a.errors.length) toast.error(a.errors[0])
      setChoice({}); setJobSkip(new Set())
      await fetchExisting()
    } catch (err) { toast.error(err.message) }
    setBusy(null)
  }

  const sendOffer = async (l, value) => {
    setBusy(l.key)
    try {
      if (l.kind === 'new') await createRows([l.row], { asOffer: { value } })
      else after(await offerJob(l.job, { value }))
      toast.success(tr('Offer sent to everyone with the role', '役割のある全員にオファーを送信', 'Oferta enviada para todos com o papel'))
      setOfferFor(null)
      await fetchExisting()
    } catch (err) { toast.error(err.message) }
    setBusy(null)
  }
  const cancelOffer = async job => {
    const { error } = await supabase.from('jobs').update({ job_category: 'regular', spot_status: null }).eq('id', job.id)
    if (error) toast.error(error.message)
    await fetchExisting()
  }

  const toggleLine = l => (l.kind === 'new'
    ? editRow(l.key, { checked: !l.checked })
    : setJobSkip(s => { const n = new Set(s); n.has(l.key) ? n.delete(l.key) : n.add(l.key); return n }))
  const choosePerson = (l, id) => (l.kind === 'new' ? setRowPerson(l.key, id) : setChoice(c => ({ ...c, [l.key]: id })))

  // ---- view helpers ----
  const fmtDay = d => `${dowLabels[dowOf(d)]} ${new Date(d + 'T12:00:00').toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' })}`
  const periodLabel = days.length === 1 ? fmtDay(days[0]) : `${fmtDay(days[0])} → ${fmtDay(days[days.length - 1])}`
  const out = useMemo(() => outOfSchedule(employees, days, availability, forced), [employees, days, availability, forced])
  const warnCount = lines.filter(l => warningsOf(l).length || !l.personId).length
  const shown = lines.filter(l => filter === 'all' ? true
    : filter === 'new' ? l.kind === 'new'
      : filter === 'job' ? l.kind === 'job'
        : warningsOf(l).length || !l.personId)
  const byDate = {}
  shown.forEach(l => { (byDate[l.item.date] = byDate[l.item.date] || []).push(l) })
  const toConfirm = lines.filter(l => l.checked && (l.kind === 'new' || l.personId))
  const accepted = periodJobs.filter(j => j.job_category === 'spot' && j.spot_status === 'accepted' && j.spot_responded_at && Date.now() - new Date(j.spot_responded_at) < 3 * 86400000)
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 100)

  return (
    <div className="as-page">
      {/* PERIOD */}
      <div className="card as-card">
        <div className="as-period">
          <div className="tab-pills" style={{ margin: 0 }}>
            {[['day', tr('Day', '日', 'Dia')], ['week', tr('Week', '週', 'Semana')], ['month', tr('Month', '月', 'Mês')]].map(([k, l]) => (
              <button key={k} type="button" className={`tab-pill${kind === k ? ' active' : ''}`} onClick={() => setKind(k)}>{l}</button>
            ))}
          </div>
          {kind === 'month'
            ? <input type="month" className="as-input" value={month} onChange={e => e.target.value && setMonth(e.target.value)} />
            : <input type="date" className="as-input" value={anchor} onChange={e => e.target.value && setAnchor(e.target.value)} />}
          <b className="as-period-label">{periodLabel}</b>
          <button type="button" className="btn btn-sm" onClick={() => setShowTemplates(s => !s)}>⚙️ {tr('Templates', 'テンプレート', 'Modelos')}</button>
        </div>
        {showTemplates && (
          <div className="as-templates">
            <div className="as-muted">{tr('Templates fill the box with what is not created yet. "Usually done by" is only the first suggestion.', 'テンプレートは未作成の作業を追加します。「通常の担当」は最初の提案のみ。', 'Os modelos trazem para a caixa o que ainda não foi criado. "Normalmente faz" é só a primeira sugestão.')}</div>
            {SCHEDULE_ROUTES.map(r => (
              <div key={r.key} className="as-template">
                <label>
                  <input type="checkbox" checked={templates.has(r.key)} onChange={() => setTemplates(s => { const n = new Set(s); n.has(r.key) ? n.delete(r.key) : n.add(r.key); return n })} />
                  <span><b>{r.label}</b> <span className="as-muted">· {r.detail}</span></span>
                </label>
                <select className="as-input" value={owners[r.key] || ''}
                  onChange={e => { const next = { ...owners, [r.key]: e.target.value || undefined }; if (!e.target.value) delete next[r.key]; setOwners(next); writeStored(OWNERS_KEY, next) }}>
                  <option value="">{tr('Usually done by: automatic', '通常の担当: 自動', 'Normalmente faz: automático')}</option>
                  {pool.map(e => <option key={e.id} value={e.id}>{tr('Usually done by: ', '通常の担当: ', 'Normalmente faz: ')}{e.full_name}</option>)}
                </select>
              </div>
            ))}
            {out.length > 0 && (
              <div className="as-out">
                <b>🚫 {tr('Outside the schedule', 'スケジュール対象外', 'Fora da escala')}</b>
                {out.map(({ emp, reason }) => (
                  <div key={emp.id} className="as-out-row">
                    <span>{emp.full_name} <span className="as-muted">— {reason === 'unavailable' ? tr('unavailable in the period', '期間中に勤務不可', 'indisponível no período') : T.conflict[reason] || reason}</span></span>
                    <button type="button" className="btn btn-sm" onClick={() => setForced(s => new Set(s).add(emp.id))}>{tr('Include anyway', '例外で追加', 'Incluir mesmo assim')}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* TWO COUNTS — always visible */}
      <div className="as-counts">
        <button type="button" className={`as-count${filter === 'new' ? ' on' : ''}`} onClick={() => setFilter(f => f === 'new' ? 'all' : 'new')}>
          <span className="as-count-label">{tr('Programmed', 'プログラム済み', 'Programados')}</span>
          <b className={counts.programmed.done === counts.programmed.total ? 'ok' : 'bad'}>{counts.programmed.done}<small>/{counts.programmed.total}</small></b>
          <span className="as-bar"><i style={{ width: `${pct(counts.programmed.done, counts.programmed.total)}%` }} /></span>
          <span className="as-count-hint">{tr('jobs created × contract', '作成済み × 契約', 'jobs criados × contrato')}</span>
        </button>
        <button type="button" className={`as-count${filter === 'job' ? ' on' : ''}`} onClick={() => setFilter(f => f === 'job' ? 'all' : 'job')}>
          <span className="as-count-label">{tr('Assigned', '割当済み', 'Atribuídos')}</span>
          <b className={counts.assigned.done === counts.assigned.total ? 'ok' : 'bad'}>{counts.assigned.done}<small>/{counts.assigned.total}</small></b>
          <span className="as-bar"><i style={{ width: `${pct(counts.assigned.done, counts.assigned.total)}%` }} /></span>
          <span className="as-count-hint">{tr('with a person × created', '担当あり × 作成済み', 'com pessoa × programados')}</span>
        </button>
        <div className="as-count as-ready">
          <span className="as-count-label">{tr('Ready', '準備完了', 'Prontos')}</span>
          <b className={lines.length ? 'warn' : 'ok'}>{ready}</b>
          <span className="as-count-hint">{lines.length ? tr(`${lines.length} still pending below`, `未完了 ${lines.length}件（下）`, `${lines.length} ainda pendentes abaixo`) : tr('Everything programmed and assigned ✓', 'すべて完了 ✓', 'Tudo programado e atribuído ✓')}</span>
        </div>
      </div>

      {sqlMissing && (
        <div className="as-note">ℹ️ {tr('Saved. Notices to employees start after the database update (SQL) is applied.', '保存しました。従業員への通知はDB更新（SQL）後に有効になります。', 'Salvo. Os avisos ao funcionário começam depois que o SQL do banco for aplicado.')}</div>
      )}

      {accepted.length > 0 && (
        <div className="card as-card as-accepted">
          <b>⚡ {tr('Offers accepted', '承諾されたオファー', 'Ofertas aceitas')}</b>
          {accepted.map(j => (
            <div key={j.id} className="as-muted">✓ <b>{j.employee_name}</b> {tr('took', 'が承諾:', 'pegou')} {asItem(j).place} · {fmtDay(j.scheduled_date)} {String(j.scheduled_time || '').slice(0, 5)} · {new Date(j.spot_responded_at).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })}</div>
          ))}
        </div>
      )}

      {/* PENDING BOX */}
      <div className="card as-card">
        <div className="as-box-head">
          <div className="as-box-title">📥 {tr('Pending box', '未割当ボックス', 'Caixa de Pendentes')} <span className="as-pill">{lines.length}</span></div>
          <div className="tab-pills" style={{ margin: 0 }}>
            <button type="button" className={`tab-pill${view === 'list' ? ' active' : ''}`} onClick={() => setView('list')}>☰ {tr('List', 'リスト', 'Lista')}</button>
            <button type="button" className={`tab-pill${view === 'board' ? ' active' : ''}`} onClick={() => setView('board')}>▦ {tr('Board', 'ボード', 'Quadro')}</button>
          </div>
        </div>

        {view === 'list' && (
          <>
            <div className="as-filters">
              {[['all', tr('All', 'すべて', 'Todos')], ['new', T.reason.notCreated], ['job', tr('Created, no person', '作成済み・担当なし', 'Criados sem pessoa')], ['warn', `⚠️ ${tr('With a warning', '警告あり', 'Com aviso')} (${warnCount})`]].map(([k, l]) => (
                <button key={k} type="button" className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
              ))}
            </div>
            {!loaded && <div className="as-muted">{tr('Loading…', '読み込み中…', 'Carregando…')}</div>}
            {loaded && !lines.length && <div className="as-empty">✅ {tr('Nothing pending in this period: every service has a person.', 'この期間の未割当はありません。', 'Nada pendente neste período: todo serviço tem pessoa.')}</div>}
            {Object.keys(byDate).sort().map(date => (
              <div key={date}>
                <div className={`as-day${dowOf(date) === 0 ? ' sun' : ''}`}>{fmtDay(date)} · {byDate[date].length}</div>
                {byDate[date].map(l => (
                  <PendingLine key={l.key} l={l} T={T} tr={tr} ranking={rankings.get(l.key) || []} warnings={warningsOf(l)}
                    busy={busy === l.key} offerOpen={offerFor === l.key} employees={employees}
                    onToggle={() => toggleLine(l)} onPerson={id => choosePerson(l, id)} onTime={t => editRow(l.key, { time: t })}
                    onDo={() => doLine(l)} onOffer={() => setOfferFor(o => o === l.key ? null : l.key)} onSendOffer={v => sendOffer(l, v)}
                    onCancelOffer={() => cancelOffer(l.job)} />
                ))}
              </div>
            ))}
          </>
        )}

        {view === 'board' && (
          <AssignBoard T={T} tr={tr} days={days} fmtDay={fmtDay} wholeMonth={wholeMonth} employees={activeEmployees.filter(e => roleCan(e.job_role, 'routes') || liveJobs.some(j => j.employee_id === e.id))}
            empById={empById} availability={availability} liveJobs={liveJobs} pendingJobs={pendingJobs} rows={rows.filter(r => r.checked)}
            onMoveJob={async (job, emp) => {
              try {
                const before = asItem(job)
                const warn = emp ? conflictsFor(before, emp, plannedItems.filter(i => i.employeeId === emp.id && i.date === before.date), { availability }) : []
                after(await assignJob(job, emp))
                if (warn.length) toast(`⚠️ ${warn.map(c => conflictLabel(c, T)).join(' · ')}`, { duration: 5000 })
                else toast.success(emp ? tr(`Given to ${firstName(emp)}`, `${firstName(emp)}さんに割当`, `Atribuído a ${firstName(emp)}`) : tr('Back to the Pending box', '未割当に戻しました', 'Voltou para a Caixa de Pendentes'))
                await fetchExisting()
              } catch (err) { toast.error(err.message) }
            }}
            onMoveRow={(row, emp) => setRowPerson(row.key, emp?.id || '')} />
        )}
      </div>

      {/* CONFIRM */}
      <div className="as-sticky">
        <span className="as-sticky-text">
          {toConfirm.length
            ? tr(`${toConfirm.filter(l => l.kind === 'new').length} to create · ${toConfirm.filter(l => l.kind === 'job').length} to assign`, `作成 ${toConfirm.filter(l => l.kind === 'new').length}件・割当 ${toConfirm.filter(l => l.kind === 'job').length}件`, `${toConfirm.filter(l => l.kind === 'new').length} para criar · ${toConfirm.filter(l => l.kind === 'job').length} para atribuir`)
            : tr('Nothing selected', '選択なし', 'Nada selecionado')}
        </span>
        <button type="button" className="btn btn-primary" disabled={!!busy || !toConfirm.length} onClick={confirmAll}>
          {busy === 'all' ? tr('Saving…', '保存中…', 'Salvando…') : `✅ ${tr(`Confirm ${toConfirm.length}`, `${toConfirm.length}件を確定`, `Confirmar ${toConfirm.length}`)}`}
        </button>
      </div>
    </div>
  )
}

function PendingLine({ l, T, tr, ranking, warnings, busy, offerOpen, employees, onToggle, onPerson, onTime, onDo, onOffer, onSendOffer, onCancelOffer }) {
  const it = l.item
  const service = it.title.split(' — ')[1] || ''
  const client = l.row?.client || l.job?.client_name || ''
  const type = l.job?.job_category === 'spot' ? 'spot' : it.deep ? 'deep' : 'basic'
  const best = ranking.find(r => r.ok)
  const okPeople = ranking.filter(r => r.ok)
  const warnPeople = ranking.filter(r => !r.ok)
  const inactive = employees.filter(e => e.is_active === false && e.id === l.personId)
  const [value, setValue] = useState(() => Number(l.job?.spot_value || l.job?.value || l.row?.value || 0))
  const canTake = okPeople.length
  const isOffer = l.reason === 'offerOpen'
  const reasonColor = ['noPerson', 'spotDeclined', 'personGone', 'personOff', 'contractMissing'].includes(l.reason) ? 'red' : isOffer ? 'gold' : 'amber'
  return (
    <div className={`as-line${isOffer ? ' offer' : warnings.length || !l.personId ? ' warn' : ''}${l.checked || isOffer ? '' : ' off'}`}>
      <div className="as-line-top">
        {!isOffer && <input type="checkbox" checked={l.checked} onChange={onToggle} aria-label={tr('Select', '選択', 'Selecionar')} />}
        <div className="as-line-main">
          <div className="as-place">{it.place} <span className="as-muted">· {service}{client ? ` · ${client}` : ''}</span></div>
          <div className="as-meta">
            {l.kind === 'new'
              ? <input type="time" className="as-time" value={it.time} onChange={e => onTime(e.target.value)} aria-label={tr('Time', '時刻', 'Horário')} />
              : <span>🕐 {it.time || '—'}</span>}
            <span className={`as-tag t-${type}`}>{T.type[type]}</span>
            <span className="as-tag">👤 {T.role[requiredRole(it)]}</span>
            <span className={`as-reason r-${reasonColor}`}>{T.reason[l.reason]}{l.reason === 'personOff' || l.reason === 'personGone' ? `: ${l.job?.employee_name || ''}` : ''}</span>
          </div>
        </div>
      </div>

      {isOffer ? (
        <div className="as-actions">
          <span className="as-muted">⚡ {tr(`${canTake} people can accept · the first one keeps it`, `${canTake}人が承諾可能・最初の人が担当`, `${canTake} pessoas podem aceitar · o primeiro fica com o job`)}</span>
          <button type="button" className="btn btn-sm" onClick={onCancelOffer}>{tr('Cancel offer', 'オファー取消', 'Cancelar oferta')}</button>
        </div>
      ) : (
        <div className="as-actions">
          <select className="as-input as-person" value={l.personId} onChange={e => onPerson(e.target.value)} aria-label={tr('Person', '担当', 'Pessoa')}>
            <option value="">— {T.reason.noPerson} —</option>
            {okPeople.length > 0 && (
              <optgroup label={tr('Can do it', '担当可能', 'Podem fazer')}>
                {okPeople.map(r => <option key={r.emp.id} value={r.emp.id}>{r === best ? '★ ' : ''}{r.emp.full_name}{r.conflicts.length ? ` (⚠️ ${r.conflicts.map(c => T.conflict[c.kind]).join(', ')})` : ''}</option>)}
              </optgroup>
            )}
            {warnPeople.length > 0 && (
              <optgroup label={tr('With a warning', '警告あり', 'Com aviso')}>
                {warnPeople.map(r => <option key={r.emp.id} value={r.emp.id}>{r.emp.full_name} (⚠️ {r.conflicts.map(c => T.conflict[c.kind]).join(', ')})</option>)}
              </optgroup>
            )}
            {inactive.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
          <button type="button" className="btn btn-sm btn-primary as-do" disabled={busy || (l.kind === 'job' && !l.personId)} onClick={onDo}>
            {busy ? '…' : l.kind === 'new' ? (l.personId ? `✓ ${tr('Create + assign', '作成して割当', 'Criar e atribuir')}` : `+ ${tr('Create', '作成', 'Criar')}`) : `✓ ${tr('Assign', '割当', 'Atribuir')}`}
          </button>
          <button type="button" className="btn btn-sm as-offer-btn" onClick={onOffer} title={tr('Urgent: offer to everyone with the role', '至急：役割のある全員にオファー', 'Urgente: ofertar para todos com o papel')}>⚡ {tr('Offer', 'オファー', 'Ofertar')}</button>
        </div>
      )}

      {!isOffer && l.personId && (l.why?.length > 0 || warnings.length > 0) && (
        <div className="as-why">
          {l.why?.length > 0 && <span className="as-sug">★ {l.why.map(w => w === 'covering' && l.coveringFor ? `${T.why.covering} ${l.coveringFor}` : T.why[w]).filter(Boolean).join(' · ')}</span>}
          {warnings.map((c, i) => <span key={i} className={`as-warn${RED_CONFLICTS.has(c.kind) ? ' red' : ''}`}>⚠️ {conflictLabel(c, T)}</span>)}
        </div>
      )}
      {!isOffer && !l.personId && (
        <div className="as-why"><span className="as-warn red">⚠️ {best ? tr(`Suggestion: ${best.emp.full_name}`, `提案: ${best.emp.full_name}`, `Sugestão: ${best.emp.full_name}`) : tr('Nobody free with this role — offer it or pick someone with a warning.', 'この役割で空いている人がいません — オファーするか警告付きで選んでください。', 'Ninguém livre com esse papel — oferte ou escolha alguém com aviso.')}</span>
          {best && <button type="button" className="btn btn-sm" onClick={() => onPerson(best.emp.id)}>{tr('Use', '使う', 'Usar')}</button>}</div>
      )}

      {offerOpen && (
        <div className="as-offer">
          <label className="as-muted">⚡ {tr('Spot value (¥) — added to salary', 'スポット額（¥）— 給与に加算', 'Valor do spot (¥) — vai pro salário')}
            <input type="number" min="0" className="as-input" value={value} onChange={e => setValue(e.target.value)} />
          </label>
          <span className="as-muted">{tr(`Goes to ${canTake} people with the role and free that day. The first to accept keeps it; the others see it closed.`, `役割があり当日空いている${canTake}人に送ります。最初に承諾した人が担当、他の人には締切を通知。`, `Vai para ${canTake} pessoas com o papel e livres no dia. O primeiro que aceitar fica com o job; os outros veem que fechou.`)}</span>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => onSendOffer(value)}>⚡ {tr('Send offer', 'オファー送信', 'Enviar oferta')}</button>
        </div>
      )}
    </div>
  )
}

/** Board: one column per person (+ Pending). Drag a card to a column, or use the "→" picker on phones. */
function AssignBoard({ T, tr, days, fmtDay, wholeMonth, employees, empById, availability, liveJobs, pendingJobs, rows, onMoveJob, onMoveRow }) {
  const [drag, setDrag] = useState(null)
  const dragRef = useRef(null)
  const cards = useMemo(() => {
    const pendingIds = new Set(pendingJobs.map(p => p.job.id))
    return [
    ...liveJobs.map(j => ({ key: j.id, job: j, item: asItem(j), col: pendingIds.has(j.id) ? '' : j.employee_id })),
    ...pendingJobs.filter(p => p.job.status === 'cancelled').map(p => ({ key: p.job.id, job: p.job, item: asItem(p.job), col: '' })),
    ...rows.map(r => ({ key: r.key, row: r, item: asItem(r), col: r.employeeId || '' })),
    ]
  }, [liveJobs, pendingJobs, rows])
  if (wholeMonth) return <div className="as-empty">{tr('The board works by day or week. Choose Day or Week above.', 'ボードは日・週単位です。上で日か週を選んでください。', 'O quadro funciona por dia ou semana. Escolha Dia ou Semana acima.')}</div>

  const cols = [{ id: '', name: `📥 ${tr('Pending', '未割当', 'Pendentes')}` }, ...employees.map(e => ({ id: e.id, name: e.full_name, emp: e }))]
  const itemsOf = id => cards.filter(c => (c.col || '') === id)
  const move = (card, colId) => {
    if ((card.col || '') === colId) return
    const emp = colId ? empById[colId] : null
    if (card.row) onMoveRow(card.row, emp)
    else if (card.job.status === 'in_progress' || card.job.status === 'completed') toast.error(tr('Only jobs not started can change person.', '開始前の作業のみ担当変更できます。', 'Só job não iniciado pode mudar de pessoa.'))
    else onMoveJob(card.job, emp)
  }
  const down = (e, card) => {
    if (e.button !== undefined && e.button !== 0) return
    dragRef.current = { card, x: e.clientX, y: e.clientY, active: false }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const moveP = e => {
    const d = dragRef.current
    if (!d) return
    if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return
    d.active = true
    const col = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-as-col]')
    setDrag({ key: d.card.key, x: e.clientX, y: e.clientY, over: col ? col.getAttribute('data-as-col') : null, place: d.card.item.place })
  }
  const up = () => {
    const d = dragRef.current
    dragRef.current = null
    const cur = drag
    setDrag(null)
    if (d?.active && cur?.over != null) move(d.card, cur.over)
  }

  return (
    <div className="as-board" onPointerMove={moveP} onPointerUp={up} onPointerCancel={up}>
      {cols.map(col => {
        const list = itemsOf(col.id).sort((a, b) => byTime(a.item, b.item))
        const mineItems = list.map(c => ({ ...c.item, employeeId: col.id }))
        const offDays = col.emp ? days.filter(d => !canWork(col.emp, d, availability).ok) : []
        const minutes = list.reduce((s, c) => s + c.item.minutes, 0)
        const warnings = col.emp ? list.map(c => conflictsFor(c.item, col.emp, mineItems, { availability })) : list.map(() => [])
        const nWarn = warnings.filter(w => w.length).length
        const byDay = {}
        list.forEach((c, i) => { (byDay[c.item.date] = byDay[c.item.date] || []).push([c, warnings[i]]) })
        return (
          <div key={col.id || 'pending'} className={`as-col${drag?.over === col.id ? ' drop' : ''}${col.id ? '' : ' pending'}`} data-as-col={col.id}>
            <div className="as-col-head">
              <b>{col.name}</b>
              <span>{list.length} · {Math.round(minutes / 6) / 10}h{nWarn ? ` · ⚠️ ${nWarn}` : ''}</span>
            </div>
            {offDays.length > 0 && <div className="as-col-off">🌴 {T.conflict.off}: {offDays.map(d => fmtDay(d)).join(', ')}</div>}
            {Object.keys(byDay).sort().map(d => (
              <div key={d}>
                {days.length > 1 && <div className="as-col-day">{fmtDay(d)}</div>}
                {byDay[d].map(([c, w]) => (
                  <div key={c.key} className={`as-bcard${c.row ? ' new' : ''}${w.length ? ' warn' : ''}${drag?.key === c.key ? ' dragging' : ''}`} onPointerDown={e => down(e, c)}>
                    <div className="as-bcard-top">
                      <b>{c.item.place}</b>
                      <span>{c.item.time}</span>
                    </div>
                    <div className="as-bcard-meta">
                      <span className={`as-tag t-${c.job?.job_category === 'spot' ? 'spot' : c.item.deep ? 'deep' : 'basic'}`}>{T.type[c.job?.job_category === 'spot' ? 'spot' : c.item.deep ? 'deep' : 'basic']}</span>
                      {c.row && <span className="as-tag">{T.reason.notCreated}</span>}
                      {!col.id && c.job && <span className="as-reason r-red">{T.reason[pendingJobs.find(p => p.job.id === c.job.id)?.reason] || ''}</span>}
                    </div>
                    {w.map((x, i) => <div key={i} className={`as-warn${RED_CONFLICTS.has(x.kind) ? ' red' : ''}`}>⚠️ {conflictLabel(x, T)}</div>)}
                    <select className="as-move" value="" onPointerDown={e => e.stopPropagation()} onChange={e => { const v = e.target.value; if (v !== '') move(c, v === '-' ? '' : v) }} aria-label={tr('Move to', '移動先', 'Mover para')}>
                      <option value="">→ {tr('Move to…', '移動…', 'Mover para…')}</option>
                      {col.id && <option value="-">📥 {tr('Pending', '未割当', 'Pendentes')}</option>}
                      {employees.filter(e => e.id !== col.id).map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            ))}
            {!list.length && <div className="as-empty">{tr('Drop a job here', 'ここにドロップ', 'Solte um job aqui')}</div>}
          </div>
        )
      })}
      {drag && <div className="as-ghost" style={{ left: drag.x + 8, top: drag.y + 8 }}>{drag.place}</div>}
    </div>
  )
}
