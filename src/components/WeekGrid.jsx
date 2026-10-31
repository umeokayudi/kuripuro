import { useEffect, useMemo, useRef, useState } from 'react'
import { asItem } from '../lib/assignFlow'
import { canWork, dowOf } from '../lib/schedulePlan'

// v1.0.123 · The week at a glance. People × days: every job as a coloured card (done, planned,
// passed without start, no person, still to create) and the days off. Places × days: each contract
// day with who did it or ✗ when it is missing. Tap a card to change person / day / time, or drag it
// to another cell. Writes go through the same assign flow as the rest of the screen.

const stateOf = (c, today, pendingIds) => {
  if (c.row) return 'new'
  const j = c.job
  if (j.status === 'completed') return 'done'
  if (j.status === 'in_progress') return 'doing'
  if (!j.employee_id || pendingIds.has(j.id)) return 'nobody'
  if (j.scheduled_date < today) return 'missed'
  return 'planned'
}
const MARK = { done: '✓', doing: '▶', missed: '!', nobody: '?', new: '+', planned: '' }

export default function WeekGrid({ tr, days, today, fmtDay, employees, empById, availability, liveJobs, pendingJobs, rows, check, onMoveJob, onMoveRow }) {
  const [mode, setMode] = useState('people')
  const [sel, setSel] = useState(null)
  const [drag, setDrag] = useState(null)
  const dragRef = useRef(null)
  const pendingIds = useMemo(() => new Set(pendingJobs.map(p => p.job.id)), [pendingJobs])
  const cards = useMemo(() => [
    ...liveJobs.map(j => ({ key: j.id, job: j, item: asItem(j), emp: pendingIds.has(j.id) ? '' : j.employee_id || '' })),
    ...rows.map(r => ({ key: r.key, row: r, item: asItem(r), emp: r.employeeId || '' })),
  ].map(c => ({ ...c, state: stateOf(c, today, pendingIds) })), [liveJobs, rows, pendingIds, today])
  const at = (emp, date) => cards.filter(c => c.emp === emp && c.item.date === date).sort((a, b) => String(a.item.time).localeCompare(String(b.item.time)))
  const people = useMemo(() => employees.filter(e => cards.some(c => c.emp === e.id) || days.some(d => canWork(e, d, availability).ok)), [employees, cards, days, availability])
  const selected = cards.find(c => c.key === sel)

  const down = (e, c) => {
    if (e.button !== undefined && e.button !== 0) return
    dragRef.current = { c, x: e.clientX, y: e.clientY, active: false }
  }
  const moveP = e => {
    const d = dragRef.current
    if (!d) return
    if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8) return
    d.active = true
    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-wg-cell]')
    setDrag({ key: d.c.key, x: e.clientX, y: e.clientY, over: cell?.getAttribute('data-wg-cell') ?? null, place: d.c.item.place })
  }
  const up = () => {
    const d = dragRef.current
    dragRef.current = null
    const cur = drag
    setDrag(null)
    if (!d) return
    if (!d.active) { setSel(s => (s === d.c.key ? null : d.c.key)); return }
    if (cur?.over == null) return
    const [emp, date] = cur.over.split('|')
    move(d.c, emp, date)
  }
  const move = (c, emp, date) => {
    if (c.emp === emp && c.item.date === date) return
    const person = emp ? empById[emp] : null
    if (c.row) onMoveRow(c.row, person, date)
    else onMoveJob(c.job, person, date)
  }

  const dayHeads = days.map(d => <th key={d} className={`${d === today ? 'today' : ''}${dowOf(d) === 0 ? ' sun' : ''}`}>{fmtDay(d)}</th>)
  const Card = ({ c }) => (
    <div className={`wg-card s-${c.state}${sel === c.key ? ' sel' : ''}${drag?.key === c.key ? ' dragging' : ''}`} onPointerDown={e => down(e, c)}
      title={`${c.item.title}${c.job?.employee_name ? ` · ${c.job.employee_name}` : ''}`}>
      <b>{c.item.place}</b><span>{c.item.time || ''} {MARK[c.state]}</span>
    </div>
  )

  return (
    <div onPointerMove={moveP} onPointerUp={up} onPointerCancel={() => { dragRef.current = null; setDrag(null) }}>
      <div className="as-filters" style={{ marginBottom: 8 }}>
        <button type="button" className={mode === 'people' ? 'on' : ''} onClick={() => setMode('people')}>👥 {tr('By person', '担当者別', 'Por pessoa')}</button>
        <button type="button" className={mode === 'places' ? 'on' : ''} onClick={() => setMode('places')}>📍 {tr('By place', '場所別', 'Por local')}</button>
      </div>

      {mode === 'people' && (
        <div className="wg-scroll">
          <table className="wg">
            <thead><tr><th className="wg-corner" />{dayHeads}</tr></thead>
            <tbody>
              <tr className="wg-nobody">
                <th>📥 {tr('No person', '担当なし', 'Sem pessoa')}<small>{cards.filter(c => !c.emp).length}</small></th>
                {days.map(d => <td key={d} data-wg-cell={`|${d}`} className={drag?.over === `|${d}` ? 'drop' : ''}>{at('', d).map(c => <Card key={c.key} c={c} />)}</td>)}
              </tr>
              {people.map(e => {
                const mine = cards.filter(c => c.emp === e.id)
                return (
                  <tr key={e.id}>
                    <th>{e.full_name.split(' ')[0]}<small>{tr(`${mine.length} jobs`, `${mine.length}件`, `${mine.length} serviços`)}</small></th>
                    {days.map(d => {
                      const list = at(e.id, d)
                      const st = canWork(e, d, availability)
                      const off = !st.ok && !list.length
                      return (
                        <td key={d} data-wg-cell={`${e.id}|${d}`} className={`${off ? 'off' : ''}${drag?.over === `${e.id}|${d}` ? ' drop' : ''}`}>
                          {off && <span className="wg-off">{st.reason === 'off' ? `🌴 ${tr('day off', '休み', 'folga')}` : '—'}</span>}
                          {list.map(c => <Card key={c.key} c={c} />)}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {mode === 'places' && (
        <div className="wg-scroll">
          <table className="wg wg-places">
            <thead><tr><th className="wg-corner" />{dayHeads}<th className="wg-n">{check.totals.ok}/{check.totals.expected}</th></tr></thead>
            <tbody>
              {[...check.places].sort((a, b) => String(a.target.base).localeCompare(String(b.target.base))).map(p => (
                <tr key={p.target.id}>
                  <th>{p.target.base}<small>{p.target.service}</small></th>
                  {days.map(d => {
                    const s = p.slots.find(x => x.date === d)
                    if (!s) return <td key={d} className="na" />
                    const who = s.jobs[0]?.employee_name?.split(' ')[0] || s.rows[0]?.employeeName?.split(' ')[0] || ''
                    const st = s.state === 'ok' ? (s.jobs[0]?.status === 'completed' ? 'done' : s.jobs[0]?.scheduled_date < today && !s.jobs[0]?.started_at ? 'missed' : 'planned') : s.state
                    return (
                      <td key={d}>
                        <span className={`wg-dot s-${st}`}>
                          {st === 'done' ? '✓' : st === 'planned' ? '•' : st === 'missed' ? '!' : st === 'toCreate' ? '📥' : st === 'noPerson' ? '?' : '✗'} {st === 'missing' ? tr('missing', '不足', 'falta') : who}
                          {s.jobs.length > 1 ? ` ×${s.jobs.length}` : ''}
                        </span>
                      </td>
                    )
                  })}
                  <td className={`wg-n ${p.state === 'ok' ? 'ok' : 'bad'}`}>{p.done}/{p.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="wg-legend">
        <span><i className="s-done" />{tr('done', '完了', 'feito')}</span>
        <span><i className="s-planned" />{tr('planned', '予定', 'programado')}</span>
        <span><i className="s-missed" />{tr('passed, not started', '未開始のまま', 'passou e não iniciou')}</span>
        <span><i className="s-nobody" />{tr('no person', '担当なし', 'sem pessoa')}</span>
        <span><i className="s-new" />{tr('to create (Confirm)', '作成待ち（確定）', 'a criar (Confirmar)')}</span>
        <span>🌴 {tr('day off', '休み', 'folga')}</span>
        {mode === 'people' && <span className="as-muted">{tr('Tap a card to edit · drag it to another cell', 'タップで編集・ドラッグで移動', 'Toque no cartão para editar · arraste para outra célula')}</span>}
      </div>

      {selected && <CardEditor key={selected.key} c={selected} tr={tr} days={days} employees={employees} onClose={() => setSel(null)}
        onSave={(emp, date, time) => {
          const person = emp ? empById[emp] : null
          if (selected.row) onMoveRow(selected.row, person, date, time)
          else onMoveJob(selected.job, person, date, time)
          setSel(null)
        }} />}
      {drag && <div className="as-ghost" style={{ left: drag.x + 8, top: drag.y + 8 }}>{drag.place}</div>}
    </div>
  )
}

function CardEditor({ c, tr, employees, onClose, onSave }) {
  const [emp, setEmp] = useState(c.emp)
  const [date, setDate] = useState(c.item.date)
  const [time, setTime] = useState(c.item.time || '')
  const locked = c.job && (c.job.status === 'completed' || c.job.status === 'in_progress')
  const ref = useRef(null)
  useEffect(() => { ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }) }, [])
  return (
    <div className="wg-editor" ref={ref}>
      <div className="as-place">{c.item.title} {c.job?.employee_name && <span className="as-muted">· {c.job.employee_name}</span>}</div>
      {locked
        ? <div className="as-muted">{tr('Already started or done — it can no longer move.', '開始済み・完了済みのため移動できません。', 'Já iniciado ou feito — não pode mais mudar.')}</div>
        : (
          <div className="as-offer-edit">
            <label className="as-muted">{tr('Person', '担当', 'Pessoa')}
              <select className="as-input" value={emp} onChange={e => setEmp(e.target.value)}>
                <option value="">📥 {tr('No person', '担当なし', 'Sem pessoa')}</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </label>
            <label className="as-muted">{tr('Day', '日付', 'Dia')}<input type="date" className="as-input" value={date} onChange={e => e.target.value && setDate(e.target.value)} /></label>
            <label className="as-muted">{tr('Time', '時刻', 'Horário')}<input type="time" className="as-input" value={time} onChange={e => setTime(e.target.value)} /></label>
          </div>
        )}
      <div className="as-actions">
        {!locked && <button type="button" className="btn btn-sm btn-primary" onClick={() => onSave(emp, date, time)}>✓ {tr('Save', '保存', 'Salvar')}</button>}
        <button type="button" className="btn btn-sm" onClick={onClose}>{tr('Close', '閉じる', 'Fechar')}</button>
      </div>
    </div>
  )
}
