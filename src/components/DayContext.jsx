import { useState } from 'react'
import { contextForRequest } from '../lib/dayContext'

const hhmm = (t) => (t ? String(t).slice(0, 5) : '')

// Under a day-off request: what the company has that day (jobs, who is off, people free).
export default function DayContext({ ctx, req, L }) {
  const [open, setOpen] = useState(false)
  const c = contextForRequest(ctx, req)
  if (!c) return <div className="dc-box dc-loading">{L('Loading the day…', '読み込み中…')}</div>

  // Fewer people free than the number of people already booked that day = short-handed
  const booked = new Set(c.jobs.map(j => j.employee_id).filter(Boolean)).size
  const tight = req.kind === 'off' && c.freeAfter < booked
  return (
    <div className="dc-box">
      <div className="dc-stats">
        <span><strong>{c.jobs.length}</strong> {L('jobs that day', 'その日の仕事')}</span>
        <span><strong>{c.othersOff.length}</strong> {L('others off', '他の休み')}</span>
        <span className={tight ? 'is-warn' : ''}><strong>{req.kind === 'off' ? c.freeAfter : c.freeCount}</strong>/{c.activeCount} {L(req.kind === 'off' ? 'free if approved' : 'free', req.kind === 'off' ? '承認後の出勤可' : '出勤可')}</span>
      </div>

      {c.mine.length > 0 && (
        <div className="dc-warn">
          ⚠ {L(`Has ${c.mine.length} job(s) booked that day. Reassign them if you approve.`, `この日に${c.mine.length}件の仕事があります。承認する場合は担当を変更してください。`)}
          <ul>{c.mine.map(j => <li key={j.id}>{hhmm(j.scheduled_time)} {j.client_name || j.title}{j.area ? ` · ${j.area}` : ''}</li>)}</ul>
        </div>
      )}

      {c.othersOff.length > 0 && (
        <div className="dc-off">
          {L('Off:', '休み:')} {c.othersOff.map(r => `${r.employee_name}${r.status === 'pending' ? ' (?)' : ''}`).join(', ')}
        </div>
      )}

      {c.jobs.length > 0 && (
        <>
          <button type="button" className="dc-toggle" onClick={() => setOpen(o => !o)}>
            {open ? L('Hide the day’s jobs ▲', '仕事を隠す ▲') : L('See the day’s jobs ▼', 'その日の仕事を見る ▼')}
          </button>
          {open && (
            <ul className="dc-jobs">
              {c.jobs.map(j => (
                <li key={j.id} className={j.employee_id === req.employee_id ? 'is-mine' : ''}>
                  <span className="dc-time">{hhmm(j.scheduled_time) || '—'}</span>
                  <span className="dc-client">{j.client_name || j.title}{j.area ? <em> · {j.area}</em> : null}</span>
                  <span className="dc-who">{j.employee_name || L('Unassigned', '未割当')}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
