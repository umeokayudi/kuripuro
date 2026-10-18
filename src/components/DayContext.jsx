import { useState } from 'react'
import { contextForRequest } from '../lib/dayContext'

const hhmm = (t) => (t ? String(t).slice(0, 5) : '')

// Under a day-off request: what the company has that day (jobs, who is off, people free).
export default function DayContext({ ctx, req, L }) {
  const [open, setOpen] = useState(false)
  const c = contextForRequest(ctx, req)
  if (!c) return <div className="dc-box dc-loading">{L('Loading the day…', '読み込み中…', 'Carregando o dia…')}</div>

  // Fewer people free than the number of people already booked that day = short-handed
  const booked = new Set(c.jobs.map(j => j.employee_id).filter(Boolean)).size
  const tight = req.kind === 'off' && c.freeAfter < booked
  return (
    <div className="dc-box">
      <div className="dc-stats">
        <span><strong>{c.jobs.length}</strong> {L('jobs that day', 'その日の仕事', 'trabalhos no dia')}</span>
        <span><strong>{c.othersOff.length}</strong> {L('others off', '他の休み', 'outros de folga')}</span>
        <span className={tight ? 'is-warn' : ''}><strong>{req.kind === 'off' ? c.freeAfter : c.freeCount}</strong>/{c.activeCount} {L(req.kind === 'off' ? 'free if approved' : 'free', req.kind === 'off' ? '承認後の出勤可' : '出勤可', req.kind === 'off' ? 'livres se aprovado' : 'livres')}</span>
      </div>

      {c.mine.length > 0 && (
        <div className="dc-warn">
          ⚠ {L(`Has ${c.mine.length} job(s) booked that day. Reassign them if you approve.`, `この日に${c.mine.length}件の仕事があります。承認する場合は担当を変更してください。`, `Tem ${c.mine.length} trabalho(s) marcado(s) nesse dia. Se aprovar, passe para outra pessoa.`)}
          <ul>{c.mine.map(j => <li key={j.id}>{hhmm(j.scheduled_time)} {j.client_name || j.title}{j.area ? ` · ${j.area}` : ''}</li>)}</ul>
        </div>
      )}

      {c.othersOff.length > 0 && (
        <div className="dc-off">
          {L('Off:', '休み:', 'De folga:')} {c.othersOff.map(r => `${r.employee_name}${r.status === 'pending' ? ' (?)' : ''}`).join(', ')}
        </div>
      )}

      {c.jobs.length > 0 && (
        <>
          <button type="button" className="dc-toggle" onClick={() => setOpen(o => !o)}>
            {open ? L('Hide the day’s jobs ▲', '仕事を隠す ▲', 'Ocultar trabalhos do dia ▲') : L('See the day’s jobs ▼', 'その日の仕事を見る ▼', 'Ver trabalhos do dia ▼')}
          </button>
          {open && (
            <ul className="dc-jobs">
              {c.jobs.map(j => (
                <li key={j.id} className={j.employee_id === req.employee_id ? 'is-mine' : ''}>
                  <span className="dc-time">{hhmm(j.scheduled_time) || '—'}</span>
                  <span className="dc-client">{j.client_name || j.title}{j.area ? <em> · {j.area}</em> : null}</span>
                  <span className="dc-who">{j.employee_name || L('Unassigned', '未割当', 'Sem responsável')}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
