import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { fetchPendingTimeOff, decideTimeOff, TIME_OFF_CHANGED } from '../lib/timeOff'
import { fmtDay } from './AvailabilityPlanner'

// Dashboard alert: pending day-off requests with Approve / Reject right here.
export default function TimeOffAlert() {
  const { lang } = useLang()
  const ja = lang === 'ja'
  const L = (en, jaText) => (ja ? jaText : en)
  const [rows, setRows] = useState([])
  const [notes, setNotes] = useState({})
  const [busy, setBusy] = useState(null)

  const load = () => fetchPendingTimeOff(tokyoToday()).then(setRows).catch(() => setRows([]))
  useEffect(() => {
    load()
    const id = setInterval(load, 60000)
    window.addEventListener(TIME_OFF_CHANGED, load)
    return () => { clearInterval(id); window.removeEventListener(TIME_OFF_CHANGED, load) }
  }, [])

  if (!rows.length) return null

  const decide = async (row, status) => {
    setBusy(row.id)
    try {
      await decideTimeOff(row.id, status, notes[row.id])
      toast.success(status === 'approved' ? L('Approved', '承認しました') : L('Rejected', '却下しました'))
      setRows(r => r.filter(x => x.id !== row.id))
    } catch (e) {
      toast.error(e.message)
    }
    setBusy(null)
  }

  const off = rows.filter(r => r.kind === 'off').length
  return (
    <section className="card timeoff-alert" role="alert" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div className="card-title" style={{ margin: 0 }}>
          🗓 {ja ? `承認待ちの申請 ${rows.length}件` : `${rows.length} request${rows.length > 1 ? 's' : ''} waiting for approval`}
          {off > 0 && <span className="badge badge-amber" style={{ marginLeft: 8 }}>{ja ? `休み ${off}` : `${off} day off`}</span>}
        </div>
        <Link to="/employees?tab=availability" className="btn btn-sm">{L('See calendar', 'カレンダーを見る')}</Link>
      </div>
      {rows.slice(0, 8).map(r => (
        <div key={r.id} className="timeoff-alert-row">
          <div>
            <strong>{r.employee_name || '—'}</strong>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>
              {fmtDay(r.date, lang, { weekday: 'short', day: 'numeric', month: 'short' })} · {r.kind === 'off' ? L('Day off', '休み') : L('Extra work', '追加勤務')}
              {r.note ? ` · “${r.note}”` : ''}
            </div>
          </div>
          <div className="timeoff-alert-actions">
            <input value={notes[r.id] || ''} onChange={e => setNotes(n => ({ ...n, [r.id]: e.target.value }))} placeholder={L('Note (optional)', 'メモ（任意）')} />
            <button className="btn btn-sm btn-primary" disabled={busy === r.id} onClick={() => decide(r, 'approved')}>{L('Approve', '承認')}</button>
            <button className="btn btn-sm btn-danger" disabled={busy === r.id} onClick={() => decide(r, 'rejected')}>{L('Reject', '却下')}</button>
          </div>
        </div>
      ))}
      {rows.length > 8 && <Link to="/employees?tab=availability" style={{ fontSize: 12 }}>{ja ? `他 ${rows.length - 8}件` : `+${rows.length - 8} more`}</Link>}
    </section>
  )
}
