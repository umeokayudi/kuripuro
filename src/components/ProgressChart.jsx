// "Done × pending × late" chart by day / week / month, with client and employee filters.
// Tapping a bar segment opens the list of those jobs.
import { useEffect, useMemo, useState } from 'react'
import './agenda.css'
import { supabase } from '../lib/supabase'
import { useLang, localeOf } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { locationNameFromTitle } from '../lib/cleaningType'
import { progressSeries, contractForAgendaJob, expectedMinutes, bucketKey, DEFAULT_AGENDA_SETTINGS } from '../lib/agenda'

const COLORS = { done: '#22c55e', pending: '#60a5fa', late: '#ef4444' }
const SPAN = { day: 14, week: 12 * 7, month: 6 * 31 }

function addDays(d, n) {
  const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10)
}

export default function ProgressChart({ anchorDate, settings = DEFAULT_AGENDA_SETTINGS, refreshKey = 0, defaultUnit = 'day', onOpenJob }) {
  const { lang, tr } = useLang()
  const [unit, setUnit] = useState(defaultUnit)
  const [clientId, setClientId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [jobs, setJobs] = useState([])
  const [clients, setClients] = useState([])
  const [employees, setEmployees] = useState([])
  const [contracts, setContracts] = useState([])
  const [picked, setPicked] = useState(null)
  const [error, setError] = useState(null)
  const end = anchorDate || tokyoToday()
  const start = unit === 'month' ? `${addDays(end, -SPAN.month).slice(0, 7)}-01` : bucketKey(addDays(end, -SPAN[unit] + 1), unit)

  useEffect(() => {
    let alive = true
    Promise.all([
      supabase.from('clients').select('id,company_name').eq('is_active', true).order('company_name'),
      supabase.from('employees').select('id,full_name').eq('is_active', true).order('full_name'),
      supabase.from('service_contracts').select('*'),
    ]).then(([c, e, sc]) => {
      if (!alive) return
      setClients(c.data || []); setEmployees(e.data || []); setContracts(sc.data || [])
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    setError(null)
    supabase.from('jobs')
      .select('*') // '*' so it works before and after the v1.0.96 columns exist
      .gte('scheduled_date', start).lte('scheduled_date', end).neq('status', 'cancelled')
      .then(({ data, error: err }) => {
        if (!alive) return
        if (err) setError(err.message)
        setJobs(data || [])
      })
    return () => { alive = false }
  }, [start, end, refreshKey])

  const clientOf = j => j.client_id || contractForAgendaJob(j, contracts)?.client_id || ''
  const filtered = useMemo(() => jobs.filter(j =>
    (!clientId || clientOf(j) === clientId) && (!employeeId || j.employee_id === employeeId)), [jobs, clientId, employeeId, contracts])
  const series = useMemo(() => progressSeries(filtered, {
    unit, settings, expectedOf: j => expectedMinutes(j, contractForAgendaJob(j, contracts)),
  }), [filtered, unit, settings, contracts])
  const max = Math.max(1, ...series.map(r => r.done + r.pending + r.late))
  const totals = series.reduce((s, r) => ({ done: s.done + r.done, pending: s.pending + r.pending, late: s.late + r.late }), { done: 0, pending: 0, late: 0 })
  const labels = { done: tr('Done', '完了', 'Feito'), pending: tr('Pending', '未完了', 'Pendente'), late: tr('Late', '遅れ', 'Atrasado') }
  const fmtKey = key => {
    const locale = localeOf(lang)
    if (unit === 'month') return new Date(key + '-01T12:00:00').toLocaleDateString(locale, { month: 'short', year: '2-digit' })
    return new Date(key + 'T12:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'numeric' })
  }
  const pickedJobs = picked ? jobs.filter(j => picked.ids.includes(j.id)) : []

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>{tr('Done × pending × late', '完了 × 未完了 × 遅れ', 'Feito × pendente × atrasado')}</div>
        <div className="tab-pills" style={{ margin: 0 }}>
          {[['day', tr('Day', '日', 'Dia')], ['week', tr('Week', '週', 'Semana')], ['month', tr('Month', '月', 'Mês')]].map(([k, l]) => (
            <button key={k} type="button" className={`tab-pill${unit === k ? ' active' : ''}`} onClick={() => { setUnit(k); setPicked(null) }}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <select className="ag-select" style={{ flex: '1 1 160px', minWidth: 0 }} value={clientId} onChange={e => { setClientId(e.target.value); setPicked(null) }} aria-label={tr('Client', '顧客', 'Cliente')}>
          <option value="">{tr('All clients', '全顧客', 'Todos os clientes')}</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
        <select className="ag-select" style={{ flex: '1 1 160px', minWidth: 0 }} value={employeeId} onChange={e => { setEmployeeId(e.target.value); setPicked(null) }} aria-label={tr('Employee', 'スタッフ', 'Funcionário')}>
          <option value="">{tr('Everyone', '全員', 'Todos')}</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, marginBottom: 8 }}>
        {Object.keys(COLORS).map(k => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: COLORS[k] }} />{labels[k]} {totals[k]}
          </span>
        ))}
      </div>
      {error && <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>}
      {!series.length && !error && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{tr('No jobs in this period.', 'この期間の作業はありません。', 'Nenhum job no período.')}</div>}
      {series.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 140, overflowX: 'auto', paddingBottom: 2 }}>
          {series.map(r => {
            const total = r.done + r.pending + r.late
            return (
              <div key={r.key} style={{ flex: '1 0 22px', maxWidth: 48, display: 'flex', flexDirection: 'column', alignItems: 'stretch', height: '100%', justifyContent: 'flex-end' }}>
                <div style={{ display: 'flex', flexDirection: 'column-reverse', height: `${(total / max) * 112}px`, borderRadius: 5, overflow: 'hidden' }}>
                  {['done', 'pending', 'late'].map(b => r[b] > 0 && (
                    <button key={b} type="button" title={`${fmtKey(r.key)} · ${labels[b]}: ${r[b]}`}
                      onClick={() => setPicked({ key: r.key, bucket: b, ids: r.ids[b] })}
                      style={{ flex: r[b], minHeight: 4, border: 'none', padding: 0, cursor: 'pointer', background: COLORS[b], opacity: picked && !(picked.key === r.key && picked.bucket === b) ? 0.45 : 1 }} />
                  ))}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)', textAlign: 'center', marginTop: 4, whiteSpace: 'nowrap' }}>{fmtKey(r.key)}</div>
              </div>
            )
          })}
        </div>
      )}
      {picked && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ fontWeight: 800, fontSize: 13 }}><span style={{ color: COLORS[picked.bucket] }}>●</span> {labels[picked.bucket]} · {fmtKey(picked.key)} ({pickedJobs.length})</div>
            <button type="button" className="btn btn-sm" onClick={() => setPicked(null)}>✕</button>
          </div>
          {pickedJobs.map(j => (
            <button key={j.id} type="button" onClick={() => onOpenJob?.(j)}
              style={{ display: 'flex', width: '100%', justifyContent: 'space-between', gap: 8, padding: '7px 4px', border: 'none', borderBottom: '1px solid var(--border)', background: 'none', cursor: onOpenJob ? 'pointer' : 'default', textAlign: 'left', color: 'var(--text)', fontSize: 13 }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{locationNameFromTitle(j.title)}</span>
              <span style={{ color: 'var(--text3)', flexShrink: 0 }}>{j.employee_name || '—'} · {j.scheduled_date.slice(5)} {j.scheduled_time || ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
