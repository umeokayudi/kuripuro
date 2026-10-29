import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { useLang, fill, localeOf } from '../hooks/useLang'
import { askConfirm } from '../components/ConfirmDialog'
import { roleInfo } from '../lib/employeeRoles'

// Roles that never get cleaning routes from the generator.
const NO_ROUTE_ROLES = ['office']

function addDaysStr(d, n) {
  const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10)
}
/** Dates covered by the chosen scope (day / week Mon–Sun / month). */
function scopeDays(scope, anchor, month) {
  if (scope === 'day') return [anchor]
  if (scope === 'week') {
    const dow = (new Date(anchor + 'T12:00:00Z').getUTCDay() + 6) % 7
    const mon = addDaysStr(anchor, -dow)
    return Array.from({ length: 7 }, (_, i) => addDaysStr(mon, i))
  }
  return monthDays(month)
}
import {
  DEFAULT_LOCATIONS, SCHEDULE_ROUTES, SCHEDULE_COLORS, buildMonthSchedule, assignEmployees,
  availabilityIndex, defaultScheduleEmployees, scheduleStats, jobsToRows,
  locationsFromContracts, DOW_EN, DOW_JA,
} from '../lib/scheduleGenerator'

const OWNERS_KEY = 'kp_schedule_route_owners'
const TEAM_KEY = 'kp_schedule_team'

function readStored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
function writeStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode */ }
}

function monthDays(month) {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

const MARK_STYLE = {
  off: { background: 'rgba(248,113,113,0.18)', color: 'var(--red, #dc2626)', label: '✕' },
  extra: { background: 'rgba(74,222,128,0.18)', color: 'var(--green, #16a34a)', label: '＋' },
}

export default function ScheduleGenerator() {
  const { lang, t, tr } = useLang()
  const s = t.schedule
  const dateLocale = localeOf(lang)
  const dowLabels = tr(DOW_EN, DOW_JA, ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'])

  const [month, setMonth] = useState(() => {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() + 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [baseJobs, setBaseJobs] = useState([])
  const [loading, setLoading] = useState(false)
  const [existingCount, setExistingCount] = useState(0)
  const [employees, setEmployees] = useState([])
  const [team, setTeam] = useState(() => readStored(TEAM_KEY, null)) // ids na escala; null = padrão
  const [owners, setOwners] = useState(() => readStored(OWNERS_KEY, {}))
  const [overrides, setOverrides] = useState({})
  const [availRows, setAvailRows] = useState([])
  const [locations, setLocations] = useState(DEFAULT_LOCATIONS)
  const [expandedDay, setExpandedDay] = useState(null)
  const [scope, setScope] = useState('month')
  const [anchor, setAnchor] = useState(() => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).split(' ')[0])
  const [onlyPeople, setOnlyPeople] = useState(() => new Set())
  const [jobEdits, setJobEdits] = useState({})
  const rangeDays = useMemo(() => scopeDays(scope, anchor, month), [scope, anchor, month])
  const rangeMonths = useMemo(() => [...new Set(rangeDays.map(d => d.slice(0, 7)))], [rangeDays])

  useEffect(() => { loadData() }, [])
  useEffect(() => { loadExisting(); loadAvailability(); setBaseJobs([]); setOverrides({}); setJobEdits({}) }, [month, scope, anchor, onlyPeople])

  const loadData = async () => {
    const [{ data: emps }, { data: serviceContracts }] = await Promise.all([
      supabase.from('employees').select('id, full_name, is_active, job_role').eq('is_active', true).order('full_name'),
      supabase.from('service_contracts').select('*').eq('is_active', true),
    ])
    setEmployees(emps || [])
    setLocations(locationsFromContracts(serviceContracts) || DEFAULT_LOCATIONS)
  }

  const loadAvailability = async () => {
    const days = rangeMonths.flatMap(monthDays)
    const { data } = await supabase.from('employee_availability')
      .select('employee_id, date, kind, status')
      .gte('date', days[0]).lte('date', days[days.length - 1])
    setAvailRows(data || [])
  }

  const loadExisting = async () => {
    const days = rangeDays
    let q = supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .gte('scheduled_date', days[0])
      .lte('scheduled_date', days[days.length - 1])
    if (onlyPeople.size) q = q.in('employee_id', [...onlyPeople])
    const { count } = await q
    setExistingCount(count || 0)
  }

  const teamIds = useMemo(() => {
    const valid = new Set(employees.map(e => e.id))
    const ids = team ? team.filter(id => valid.has(id)) : defaultScheduleEmployees(employees).map(e => e.id)
    return new Set(ids.filter(id => !NO_ROUTE_ROLES.includes(employees.find(e => e.id === id)?.job_role)))
  }, [team, employees])
  // Active people not in the schedule (e.g. just hired): shown with a warning, never silently.
  const outOfTeam = useMemo(() => employees.filter(e => !teamIds.has(e.id) && !NO_ROUTE_ROLES.includes(e.job_role)), [employees, teamIds])
  const teamEmployees = useMemo(() => employees.filter(e => teamIds.has(e.id)), [employees, teamIds])

  const colorOf = useMemo(() =>
    Object.fromEntries(employees.map((e, i) => [e.id, SCHEDULE_COLORS[i % SCHEDULE_COLORS.length]])),
  [employees])
  const nameOf = (id) => employees.find(e => e.id === id)?.full_name || s.nobody

  const availability = useMemo(() => availabilityIndex(availRows), [availRows])

  const inRange = useMemo(() => new Set(rangeDays), [rangeDays])
  const preview = useMemo(() => {
    if (!baseJobs.length) return []
    const assigned = assignEmployees(baseJobs, { employees: teamEmployees, availability, owners, overrides })
    return assigned
      .filter(j => inRange.has(j.date))
      .map(j => {
        const ed = jobEdits[j.id]
        if (!ed) return j
        const emp = ed.employeeId !== undefined ? teamEmployees.find(e => e.id === ed.employeeId) : null
        return {
          ...j,
          time: ed.time ?? j.time,
          ...(ed.employeeId !== undefined ? { employeeId: ed.employeeId || null, employee: emp ? emp.full_name.split(' ')[0] : '', employeeName: emp?.full_name || null, assignReason: 'manual' } : {}),
          removed: !!ed.removed,
        }
      })
      .filter(j => !onlyPeople.size || onlyPeople.has(j.employeeId || ''))
  }, [baseJobs, teamEmployees, availability, owners, overrides, jobEdits, inRange, onlyPeople])
  const kept = useMemo(() => preview.filter(j => !j.removed), [preview])
  const editJob = (id, patch) => setJobEdits(e => ({ ...e, [id]: { ...(e[id] || {}), ...patch } }))

  const toggleTeam = (id) => {
    const next = new Set(teamIds)
    next.has(id) ? next.delete(id) : next.add(id)
    const arr = [...next]
    setTeam(arr)
    writeStored(TEAM_KEY, arr)
  }

  const setOwner = (routeKey, id) => {
    const next = { ...owners, [routeKey]: id || undefined }
    if (!id) delete next[routeKey]
    setOwners(next)
    writeStored(OWNERS_KEY, next)
  }

  const runPreview = () => {
    if (!teamEmployees.length) { toast.error(s.noTeam); return }
    // Built per month so routes stay fair, then cut to the chosen day / week / people.
    const jobs = rangeMonths.flatMap((m, mi) => buildMonthSchedule(m, { locations }).map(j => ({ ...j, id: mi * 100000 + Number(j.id) })))
    setOverrides({})
    setJobEdits({})
    setBaseJobs(jobs)
    const n = jobs.filter(j => inRange.has(j.date)).length
    toast.success(fill(s.previewToast, { count: n, employees: teamEmployees.length }))
  }

  const stats = useMemo(() => scheduleStats(kept), [kept])
  const unassigned = stats.byEmployee[''] || 0
  const covered = useMemo(() => new Set(preview.filter(j => j.assignReason === 'ownerOff').map(j => j.groupKey)).size, [preview])

  const byDate = useMemo(() => {
    const acc = {}
    preview.forEach(j => { (acc[j.date] = acc[j.date] || []).push(j) })
    return acc
  }, [preview])

  const handleGenerate = async () => {
    if (!kept.length) { toast.error(s.previewFirst); return }
    const summary = Object.entries(stats.byEmployee)
      .map(([id, c]) => `${id ? nameOf(id) : s.nobody}: ${c}`).join(', ')
    const days = rangeDays
    const label = scope === 'month' ? month : `${days[0]} → ${days[days.length - 1]}`
    if (existingCount > 0) {
      const ok = await askConfirm({ title: tr('Replace jobs?', '作業を置き換えますか？', 'Substituir jobs?'), message: fill(s.confirmReplace, { existing: existingCount, month: label, count: kept.length, summary }), danger: true, confirmLabel: tr('Replace', '置き換え', 'Substituir') })
      if (!ok) return
      let del = supabase.from('jobs').delete()
        .gte('scheduled_date', days[0])
        .lte('scheduled_date', days[days.length - 1])
        .eq('status', 'assigned')
        .neq('job_category', 'spot')
      if (onlyPeople.size) del = del.in('employee_id', [...onlyPeople].filter(Boolean))
      const { error: delErr } = await del
      if (delErr) { toast.error(delErr.message); return }
    } else {
      const ok = await askConfirm({ title: tr('Create jobs?', '作業を作成しますか？', 'Criar jobs?'), message: fill(s.confirmCreate, { count: kept.length, summary }), confirmLabel: tr('Create', '作成', 'Criar') })
      if (!ok) return
    }

    setLoading(true)
    const rows = jobsToRows(kept)
    for (let i = 0; i < rows.length; i += 50) {
      const { error } = await supabase.from('jobs').insert(rows.slice(i, i + 50))
      if (error) { toast.error(error.message); setLoading(false); return }
    }
    toast.success(fill(s.jobsCreated, { count: rows.length }))
    setLoading(false)
    loadExisting()
  }

  const calDays = rangeDays
  const routeLabel = (key) => SCHEDULE_ROUTES.find(r => r.key === key)?.label || key

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">🗓 {s.generator}</div>
        <div className="tab-pills" style={{ marginBottom: 12 }}>
          {[['day', tr('Day', '日', 'Dia')], ['week', tr('Week', '週', 'Semana')], ['month', tr('Month', '月', 'Mês')]].map(([k, l]) => (
            <button key={k} type="button" className={`tab-pill${scope === k ? ' active' : ''}`} onClick={() => setScope(k)}>{l}</button>
          ))}
        </div>
        <div className="grid-2" style={{ marginBottom: 14 }}>
          {scope === 'month' ? (
            <div className="form-group">
              <label>{s.month}</label>
              <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} />
            </div>
          ) : (
            <div className="form-group">
              <label>{scope === 'day' ? tr('Day', '日', 'Dia') : tr('Any day of the week', '週の任意の日', 'Qualquer dia da semana')}</label>
              <input type="date" value={anchor} onChange={e => e.target.value && setAnchor(e.target.value)} />
              {scope === 'week' && <small style={{ color: 'var(--text3)' }}>{rangeDays[0]} → {rangeDays[6]}</small>}
            </div>
          )}
          <div className="form-group">
            <label>{s.existingJobs}</label>
            <div style={{ padding: '10px 12px', background: existingCount ? 'rgba(251,191,36,0.1)' : 'var(--surface2)', borderRadius: 8, fontSize: 14, fontWeight: 600 }}>
              {existingCount > 0 ? fill(s.jobsInMonth, { count: existingCount, month }) : s.noJobsMonth}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">🧑 {tr('Generate for', '対象者', 'Gerar para')}</div>
        <div className="ag-people" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className={`tab-pill${onlyPeople.size === 0 ? ' active' : ''}`} onClick={() => setOnlyPeople(new Set())}>{tr('Everyone', '全員', 'Todos')}</button>
          {teamEmployees.map(e => (
            <button key={e.id} type="button" className={`tab-pill${onlyPeople.has(e.id) ? ' active' : ''}`}
              onClick={() => setOnlyPeople(prev => { const n = new Set(prev); n.has(e.id) ? n.delete(e.id) : n.add(e.id); return n })}>{e.full_name}</button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>{tr('Only these people\'s jobs are created or replaced.', '選んだ人の作業だけを作成・置き換えます。', 'Só os jobs dessas pessoas são criados ou substituídos.')}</div>
      </div>

      {outOfTeam.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '4px solid #f59e0b', background: 'rgba(245,158,11,0.08)' }}>
          ⚠️ <b>{tr('Not in the schedule:', 'スケジュール対象外:', 'Fora da escala:')}</b> {outOfTeam.map(e => e.full_name).join(', ')} — {tr('tick them below to include.', '含めるには下でチェックしてください。', 'marque abaixo para incluir.')}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">👥 {s.teamTitle}</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>{s.teamHint}</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: 'var(--text2)', marginBottom: 10 }}>
          <span><b style={{ color: MARK_STYLE.off.color }}>✕</b> {s.legendOff}</span>
          <span><b style={{ color: MARK_STYLE.extra.color }}>＋</b> {s.legendExtra}</span>
          <span><b style={{ opacity: 0.55 }}>✕</b> {s.legendPending}</span>
          <span>· {s.legendBlank}</span>
        </div>
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11, minWidth: '100%' }}>
            <thead>
              <tr>
                <th style={{ position: 'sticky', left: 0, background: 'var(--surface)', textAlign: 'left', padding: '6px 8px', minWidth: 130 }}>{s.employee}</th>
                {calDays.map(d => {
                  const dow = new Date(d + 'T12:00:00').getDay()
                  return (
                    <th key={d} style={{ padding: '4px 0', minWidth: 24, fontWeight: 500, color: dow === 0 ? 'var(--red, #dc2626)' : 'var(--text3)' }}>
                      <div>{Number(d.slice(8))}</div>
                      <div style={{ fontSize: 9 }}>{dowLabels[dow]}</div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {employees.map(e => {
                const inTeam = teamIds.has(e.id)
                const marks = availRows.filter(r => r.employee_id === e.id && r.status !== 'rejected' && r.kind !== 'available').length
                return (
                  <tr key={e.id} style={{ borderTop: '1px solid var(--border)', opacity: inTeam ? 1 : 0.45 }}>
                    <td style={{ position: 'sticky', left: 0, background: 'var(--surface)', padding: '6px 8px', whiteSpace: 'nowrap' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                        <input type="checkbox" checked={inTeam} disabled={NO_ROUTE_ROLES.includes(e.job_role)} onChange={() => toggleTeam(e.id)} />
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: colorOf[e.id] }} />
                        <span style={{ fontWeight: 600 }}>{e.full_name}</span>
                        {roleInfo(e.job_role, lang) && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, color: roleInfo(e.job_role, lang).color, background: roleInfo(e.job_role, lang).bg }}>{roleInfo(e.job_role, lang).label}</span>}
                      </label>
                      {NO_ROUTE_ROLES.includes(e.job_role) && <div style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 22 }}>{tr('Role without cleaning routes', '清掃ルートなしの役割', 'Função sem rotas de limpeza')}</div>}
                      {!inTeam && !NO_ROUTE_ROLES.includes(e.job_role) && <div style={{ fontSize: 10, color: '#b45309', marginLeft: 22, fontWeight: 700 }}>⚠️ {tr('Not in the schedule', 'スケジュール対象外', 'Fora da escala')}</div>}
                      {inTeam && marks === 0 && <div style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 22 }}>{s.noMarks}</div>}
                    </td>
                    {calDays.map(d => {
                      const mark = availability[`${e.id}|${d}`]
                      const st = mark ? MARK_STYLE[mark.kind] : null
                      const pending = mark?.status === 'pending'
                      return (
                        <td key={d} title={mark ? `${mark.kind === 'off' ? s.legendOff : s.legendExtra}${pending ? ` · ${s.pending}` : ''}` : ''}
                          style={{ textAlign: 'center', padding: '5px 0', background: st?.background, color: st?.color, fontWeight: 700, opacity: pending ? 0.55 : 1 }}>
                          {st ? st.label : ''}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">📋 {s.routesTitle}</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>{s.routesHint}</div>
        <div style={{ display: 'grid', gap: 10 }}>
          {SCHEDULE_ROUTES.map(r => (
            <div key={r.key} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', padding: '10px 12px', background: 'var(--surface2)', borderRadius: 10, borderLeft: `4px solid ${owners[r.key] ? colorOf[owners[r.key]] : 'var(--border)'}` }}>
              <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{r.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{r.detail}</div>
              </div>
              <div className="form-group" style={{ margin: 0, flex: '0 1 220px', minWidth: 160 }}>
                <label style={{ fontSize: 11 }}>{s.owner}</label>
                <select value={owners[r.key] && teamIds.has(owners[r.key]) ? owners[r.key] : ''} onChange={e => setOwner(r.key, e.target.value)}>
                  <option value="">{s.ownerAuto}</option>
                  {teamEmployees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10 }}>
          {fill(s.locationsCount, { count: locations.length })}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
          <button className="btn" onClick={runPreview} disabled={!teamEmployees.length}>👁 {s.preview}</button>
          <button className="btn btn-primary" onClick={handleGenerate} disabled={loading || !kept.length}>
            {loading ? s.creating : `✅ ${fill(s.generate, { count: kept.length || '…' })}`}
          </button>
        </div>
      </div>

      {preview.length > 0 && (
        <div className="card">
          <div className="card-title">{fill(s.previewTitle, { total: stats.total, days: stats.days })}</div>

          {(unassigned > 0 || covered > 0) && (
            <div style={{ fontSize: 12, padding: '8px 12px', borderRadius: 8, marginBottom: 12, background: unassigned ? 'rgba(248,113,113,0.12)' : 'rgba(251,191,36,0.12)' }}>
              {unassigned > 0 && <div>⚠️ {fill(s.unassignedWarn, { count: unassigned })}</div>}
              {covered > 0 && <div>🔁 {fill(s.coveredInfo, { count: covered })}</div>}
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
            {teamEmployees.map(e => (
              <div key={e.id} style={{ padding: '10px 14px', borderRadius: 10, background: `${colorOf[e.id]}12`, border: `1px solid ${colorOf[e.id]}30`, minWidth: 100 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{e.full_name.split(' ')[0]}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: colorOf[e.id] }}>{stats.byEmployee[e.id] || 0}</div>
              </div>
            ))}
            {unassigned > 0 && (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', minWidth: 100 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{s.nobody}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--red, #dc2626)' }}>{unassigned}</div>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            {dowLabels.map((label, i) => (
              <div key={label} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, background: 'var(--surface2)' }}>
                {label}: <b>{stats.byDow[i]}</b>
              </div>
            ))}
          </div>

          <div style={{ maxHeight: 620, overflowY: 'auto' }}>
            {Object.keys(byDate).sort().map(date => {
              const dayJobs = byDate[date]
              const dow = new Date(date + 'T12:00:00').getDay()
              const isOpen = expandedDay === date
              const groups = {}
              dayJobs.forEach(j => { (groups[j.groupKey] = groups[j.groupKey] || []).push(j) })
              const off = teamEmployees.filter(e => availability[`${e.id}|${date}`]?.kind === 'off')
              const hasProblem = dayJobs.some(j => !j.employeeId)
              return (
                <div key={date} style={{ marginBottom: 8, border: `1px solid ${hasProblem ? 'rgba(248,113,113,0.5)' : 'var(--border)'}`, borderRadius: 10, overflow: 'hidden' }}>
                  <button type="button" onClick={() => setExpandedDay(isOpen ? null : date)}
                    style={{ width: '100%', display: 'flex', justifyContent: 'space-between', gap: 8, padding: '10px 14px', background: 'var(--surface2)', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'inherit' }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>
                      {dowLabels[dow]} {new Date(date + 'T12:00:00').toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' })}
                      {off.length > 0 && <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text3)', marginLeft: 8 }}>{fill(s.offToday, { names: off.map(e => e.full_name.split(' ')[0]).join(', ') })}</span>}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{dayJobs.length} {s.jobsLabel} {isOpen ? '▲' : '▼'}</span>
                  </button>
                  <div style={{ padding: '8px 14px 10px', display: 'grid', gap: 8 }}>
                    {Object.entries(groups).map(([key, gJobs]) => {
                      const g = gJobs[0]
                      const color = g.employeeId ? colorOf[g.employeeId] : 'var(--red, #dc2626)'
                      return (
                        <div key={key}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
                            <span style={{ flex: '1 1 160px', minWidth: 0, color: 'var(--text2)' }}>{routeLabel(g.routeKey)} · {gJobs.length}</span>
                            <select value={g.employeeId || ''} onChange={e => setOverrides(o => ({ ...o, [key]: e.target.value }))}
                              style={{ fontSize: 12, padding: '4px 8px', maxWidth: 190, color, fontWeight: 600 }}>
                              <option value="">{s.nobody}</option>
                              {teamEmployees.map(e => {
                                const isOff = availability[`${e.id}|${date}`]?.kind === 'off'
                                return <option key={e.id} value={e.id}>{e.full_name}{isOff ? ` (${s.legendOff})` : ''}</option>
                              })}
                            </select>
                          </div>
                          {g.assignReason === 'ownerOff' && <div style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 16 }}>🔁 {fill(s.coveringFor, { name: g.coveringFor })}</div>}
                          {g.assignReason === 'nobody' && <div style={{ fontSize: 11, color: 'var(--red, #dc2626)', marginLeft: 16 }}>⚠️ {s.nobodyFree}</div>}
                          {g.assignReason === 'manual' && g.employeeId && availability[`${g.employeeId}|${date}`]?.kind === 'off' && (
                            <div style={{ fontSize: 11, color: 'var(--red, #dc2626)', marginLeft: 16 }}>⚠️ {s.manualOnOff}</div>
                          )}
                          {(isOpen || scope !== 'month') && (
                            <div style={{ marginLeft: 16, marginTop: 4 }}>
                              {gJobs.map(j => (
                                <div key={j.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 12, opacity: j.removed ? 0.45 : 1 }}>
                                  <input type="time" value={j.time} onChange={e => editJob(j.id, { time: e.target.value })} style={{ fontSize: 12, padding: '2px 4px', width: 92 }} aria-label={tr('Time', '時刻', 'Horário')} />
                                  <span style={{ flex: '1 1 140px', minWidth: 0, textDecoration: j.removed ? 'line-through' : 'none' }}>{j.title.split(' —')[0]}</span>
                                  {j.type === 'deep' && <span className="badge badge-amber" style={{ fontSize: 10 }}>{t.jobs.deep}</span>}
                                  <select value={j.employeeId || ''} onChange={e => editJob(j.id, { employeeId: e.target.value })} style={{ fontSize: 12, padding: '2px 6px', maxWidth: 150 }} aria-label={s.employee}>
                                    <option value="">{s.nobody}</option>
                                    {teamEmployees.map(e => <option key={e.id} value={e.id}>{e.full_name}{availability[`${e.id}|${date}`]?.kind === 'off' ? ` (${s.legendOff})` : ''}</option>)}
                                  </select>
                                  <button type="button" className="btn btn-sm" onClick={() => editJob(j.id, { removed: !j.removed })} title={j.removed ? tr('Keep', '戻す', 'Manter') : tr('Leave out', '除外', 'Tirar')}>{j.removed ? '↺' : '✕'}</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
