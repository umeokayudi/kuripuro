import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { plannerWeeks, weekDays, addDays, targetPlanWeek, unplannedEmployees, weekStartOf } from '../lib/availability'
import { fmtDay } from './AvailabilityPlanner'
import { decideTimeOff } from '../lib/timeOff'

const KIND = {
  off: { en: 'Day off', ja: '休み', cls: 'badge-red' },
  extra: { en: 'Extra work', ja: '追加勤務', cls: 'badge-navy' },
}
const STATUS = {
  pending: { en: 'Pending', ja: '承認待ち', cls: 'badge-amber' },
  approved: { en: 'Approved', ja: '承認済み', cls: 'badge-green' },
  rejected: { en: 'Rejected', ja: '却下', cls: 'badge-red' },
}

// Admin view of employee availability: requests to approve, who has not planned, and a week grid.
export default function AvailabilityAdmin({ employees, onPendingCount }) {
  const { lang } = useLang()
  const ja = lang === 'ja'
  const L = (en, jaText) => (ja ? jaText : en)
  const today = tokyoToday()
  const active = useMemo(() => (employees || []).filter(e => e.is_active !== false), [employees])
  const weeks = useMemo(() => [weekStartOf(today), ...plannerWeeks(today, 5)].filter((w, i, a) => a.indexOf(w) === i), [today])
  const [rows, setRows] = useState([])
  const [plans, setPlans] = useState([])
  const [week, setWeek] = useState(targetPlanWeek(today))
  const [notes, setNotes] = useState({})

  const load = async () => {
    const [av, wp] = await Promise.all([
      supabase.from('employee_availability').select('*').gte('date', today).order('date').limit(2000),
      supabase.from('employee_week_plans').select('*').gte('week_start', weeks[0]).limit(2000),
    ])
    setRows(av.data || [])
    setPlans(wp.data || [])
    onPendingCount?.((av.data || []).filter(r => r.status === 'pending').length)
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (row, status) => {
    try { await decideTimeOff(row.id, status, notes[row.id]) } catch (error) { return toast.error(error.message) }
    toast.success(status === 'approved' ? L('Approved', '承認しました') : L('Rejected', '却下しました'))
    load()
  }

  const pending = rows.filter(r => r.status === 'pending')
  const missing = unplannedEmployees(active, plans, today)
  const target = targetPlanWeek(today)
  const deadline = addDays(target, -7)
  const days = weekDays(week)
  const cell = {}
  for (const r of rows) cell[`${r.employee_id}|${r.date}`] = r
  const plannedThisWeek = new Set(plans.filter(p => p.week_start === week).map(p => p.employee_id))
  const name = (r) => r.employee_name || active.find(e => e.id === r.employee_id)?.full_name || '—'

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title">{L('Requests to review', '確認待ちの申請')} ({pending.length})</div>
        {pending.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>{L('Nothing waiting.', '確認待ちはありません。')}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>{L('Employee', 'スタッフ')}</th><th>{L('Date', '日付')}</th><th>{L('Type', '種類')}</th><th>{L('Note to employee', 'スタッフへのメモ')}</th><th /></tr></thead>
              <tbody>
                {pending.map(r => (
                  <tr key={r.id}>
                    <td>{name(r)}</td>
                    <td>{fmtDay(r.date, lang, { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                    <td><span className={`badge ${KIND[r.kind]?.cls || ''}`}>{KIND[r.kind]?.[ja ? 'ja' : 'en'] || r.kind}</span></td>
                    <td><input value={notes[r.id] || ''} onChange={e => setNotes(n => ({ ...n, [r.id]: e.target.value }))} placeholder={L('Optional', '任意')} style={{ minWidth: 140 }} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm btn-primary" onClick={() => decide(r, 'approved')}>{L('Approve', '承認')}</button>{' '}
                      <button className="btn btn-sm" onClick={() => decide(r, 'rejected')}>{L('Reject', '却下')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title">
          {L('Not planned yet', '未提出')} · {L('week of', '')} {fmtDay(target, lang)}{ja ? 'の週' : ''} ({missing.length})
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
          {L(`Deadline ${deadline}. These employees see an alert in their portal until they send the plan.`, `締切 ${deadline}。提出するまでスタッフのポータルにアラートが表示されます。`)}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {missing.length === 0
            ? <span className="badge badge-green">{L('Everyone planned ✓', '全員提出済み ✓')}</span>
            : missing.map(e => <span key={e.id} className="badge badge-amber">{e.full_name}</span>)}
        </div>
      </div>

      <div className="card">
        <div className="card-title">{L('Availability by week', '週ごとの勤務希望')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {weeks.map(w => (
            <button key={w} className={`tab-pill${w === week ? ' active' : ''}`} onClick={() => setWeek(w)}>{fmtDay(w, lang)}</button>
          ))}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{L('Employee', 'スタッフ')}</th>
                {days.map(d => <th key={d} style={{ textAlign: 'center' }}>{fmtDay(d, lang, { weekday: 'short', day: 'numeric' })}</th>)}
                <th>{L('Plan', '提出')}</th>
              </tr>
            </thead>
            <tbody>
              {active.map(emp => (
                <tr key={emp.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{emp.full_name}</td>
                  {days.map(d => {
                    const r = cell[`${emp.id}|${d}`]
                    if (!r) return <td key={d} style={{ textAlign: 'center', color: 'var(--text3)' }}>·</td>
                    return (
                      <td key={d} style={{ textAlign: 'center' }} title={`${KIND[r.kind]?.[ja ? 'ja' : 'en']} · ${STATUS[r.status]?.[ja ? 'ja' : 'en']}${r.admin_note ? ' · ' + r.admin_note : ''}`}>
                        <span className={`badge ${r.status === 'rejected' ? '' : KIND[r.kind]?.cls}`} style={{ opacity: r.status === 'pending' ? 0.7 : 1 }}>
                          {r.kind === 'off' ? '✕' : '＋'}{r.status === 'pending' ? '?' : ''}
                        </span>
                      </td>
                    )
                  })}
                  <td>{plannedThisWeek.has(emp.id) ? <span className="badge badge-green">✓</span> : <span className="badge badge-amber">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>
          {L('✕ day off · ＋ wants extra work · ? waiting for approval', '✕ 休み · ＋ 追加勤務希望 · ? 承認待ち')}
        </div>
      </div>
    </div>
  )
}
