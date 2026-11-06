import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { fill, localeOf } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { plannerWeeks, weekDays, weekStartOf, isLocked, byDate, nextKind, diffWeek, addDays, planningAlert } from '../lib/availability'

const KIND_ICON = { available: '✓', off: '✕', extra: '＋' }

export function kindLabel(kind, e) {
  return kind === 'off' ? e.kindOff : kind === 'extra' ? e.kindExtra : e.kindAvailable
}

export function statusLabel(status, e) {
  return status === 'approved' ? e.stApproved : status === 'rejected' ? e.stRejected : e.stPending
}

/** Banner used on the employee home and on the planner itself. */
export function PlanAlert({ alert, e, lang, onOpen }) {
  if (!alert) return null
  const date = fmtDay(alert.week, lang)
  const deadline = fmtDay(alert.deadline, lang)
  return (
    <button type="button" className={`av-alert${alert.level === 'urgent' ? ' is-urgent' : ''}`} onClick={onOpen}>
      <span className="av-alert-icon" aria-hidden="true">📅</span>
      <span className="av-alert-copy">
        <strong>{alert.level === 'urgent' ? fill(e.planAlertUrgent, { date, deadline }) : fill(e.planAlertTitle, { date })}</strong>
        {alert.level !== 'urgent' && <small>{fill(e.planAlertBody, { deadline, days: Math.max(alert.daysLeft, 0) })}</small>}
      </span>
      {onOpen && <span className="av-alert-cta">{e.planNow}</span>}
    </button>
  )
}

/** Every day-off request with its answer (upcoming + still pending). Lives on the availability tab, not on home. */
export function TimeOffList({ rows, e, lang }) {
  return (
    <section className="emp-timeoff" aria-label={e.myTimeOff}>
      <div className="emp-timeoff-head"><h3>🗓 {e.myTimeOff}</h3></div>
      {rows.length === 0 ? <div style={{ fontSize: 12, color: '#5f6b7d' }}>{e.timeOffEmpty}</div> : rows.map(r => (
        <div key={r.id} className="emp-timeoff-row">
          <div>
            <strong>{fmtDay(r.date, lang, { weekday: 'short', day: 'numeric', month: 'short' })}</strong>
            {r.admin_note && <small>{e.timeOffAdminNote}: {r.admin_note}</small>}
          </div>
          <span className={`emp-timeoff-st is-${r.status || 'pending'}`}>{statusLabel(r.status, e)}</span>
        </div>
      ))}
    </section>
  )
}

export function fmtDay(iso, lang, opts = { day: 'numeric', month: 'short' }) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString(localeOf(lang), { ...opts, timeZone: 'UTC' })
}

// v1.0.163 · Employee weekly shift: ONE calendar (current week → 5 weeks ahead), week by week.
// Tap a day: disponível → folga → extra. Each open week is SENT on its own ("Enviar semana").
// Weeks inside the 7-day notice are closed (🔒) but still show the jobs of each day.
export default function AvailabilityPlanner({ user, e, lang, plans, onPlansChanged, jobs = [] }) {
  const today = tokyoToday()
  const L = (en, ja, pt) => (lang === 'ja' ? ja : lang === 'pt' ? pt : en)
  const weeks = useMemo(() => {
    const first = weekStartOf(today)
    const lastOpen = plannerWeeks(today, 5)
    const out = []
    for (let ws = first; ws <= lastOpen[lastOpen.length - 1]; ws = addDays(ws, 7)) out.push(ws)
    return out
  }, [today])
  const [rows, setRows] = useState([])
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState('')

  const load = async () => {
    const { data } = await supabase.from('employee_availability').select('*')
      .eq('employee_id', user.id).gte('date', weeks[0]).lte('date', addDays(weeks[weeks.length - 1], 6))
    setRows(data || [])
    setDraft({})
  }
  useEffect(() => { load() }, [user.id, weeks[0]]) // eslint-disable-line react-hooks/exhaustive-deps

  const saved = byDate(rows)
  // a daily "vou trabalhar" mark (v1.0.151, no longer used) reads as available here
  const savedKind = (d) => (saved[d]?.kind === 'confirmed' || saved[d]?.status === 'rejected' ? 'available' : saved[d]?.kind) || 'available'
  const kindOf = (d) => draft[d] ?? savedKind(d)
  const planned = new Set((plans || []).map(p => p.week_start))
  const alert = planningAlert(plans, today)
  const jobsBy = useMemo(() => {
    const m = {}
    for (const j of jobs || []) if (j && j.status !== 'cancelled' && j.scheduled_date) m[j.scheduled_date] = (m[j.scheduled_date] || 0) + 1
    return m
  }, [jobs])

  const saveWeek = async (ws) => {
    setSaving(ws)
    const days = weekDays(ws)
    const weekDraft = Object.fromEntries(days.filter(d => d in draft).map(d => [d, draft[d]]))
    const { upserts, deletes } = diffWeek({ draft: weekDraft, saved: rows.filter(r => days.includes(r.date)), today, employee: user })
    try {
      if (upserts.length) {
        const { error } = await supabase.from('employee_availability').upsert(upserts, { onConflict: 'employee_id,date' })
        if (error) throw error
      }
      if (deletes.length) {
        const { error } = await supabase.from('employee_availability').delete().eq('employee_id', user.id).in('date', deletes)
        if (error) throw error
      }
      const { error } = await supabase.from('employee_week_plans').upsert(
        { employee_id: user.id, employee_name: user.name, week_start: ws, submitted_at: new Date().toISOString() },
        { onConflict: 'employee_id,week_start' })
      if (error) throw error
      toast.success(e.planSaved)
      await load()
      onPlansChanged?.()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving('')
    }
  }

  const range = (ws) => {
    const end = addDays(ws, 6)
    const sameMonth = ws.slice(5, 7) === end.slice(5, 7)
    return sameMonth ? `${Number(ws.slice(8))}–${fmtDay(end, lang)}` : `${fmtDay(ws, lang)} – ${fmtDay(end, lang)}`
  }
  const dows = weekDays(weeks[0]).map(d => fmtDay(d, lang, { weekday: 'short' }).replace('.', ''))

  return (
    <div className="av-planner av2">
      <div className="av2-head">
        <span className="av2-head-icon" aria-hidden="true">📅</span>
        <div>
          <h3>{L('My weekly shift', '週のシフト', 'Meu shift semanal')}</h3>
          <p>{L('Tap a day to mark a day off or extra work, then send the week. Send each week at least 7 days before.',
            '日付をタップして休み・追加勤務を選び、週ごとに送信。7日前までに送信してください。',
            'Toque no dia para marcar folga ou extra e envie a semana. Cada semana vai até 7 dias antes.')}</p>
        </div>
      </div>
      <div className="av-legend">
        {['available', 'off', 'extra'].map(k => <span key={k} className={`av-chip is-${k}`}>{KIND_ICON[k]} {kindLabel(k, e)}</span>)}
        <span className="av-chip is-jobs">● {L('jobs that day', 'その日の作業', 'serviços no dia')}</span>
      </div>

      <section className="av2-cal" aria-label={L('Shift calendar', 'シフトカレンダー', 'Calendário do shift')}>
        <div className="av2-dows" aria-hidden="true">{dows.map((d, i) => <span key={i} className={i >= 5 ? 'is-weekend' : ''}>{d}</span>)}</div>
        {weeks.map(ws => {
          const days = weekDays(ws)
          const editable = days.some(d => !isLocked(d, today))
          const dirty = days.some(d => d in draft && draft[d] !== savedKind(d))
          const sent = planned.has(ws)
          const isTarget = alert?.week === ws
          const state = !editable ? 'locked' : dirty ? 'dirty' : sent ? 'sent' : 'todo'
          const pill = {
            locked: L('🔒 Closed', '🔒 締切', '🔒 Fechada'),
            dirty: L('Changes not sent', '未送信の変更', 'Mudanças não enviadas'),
            sent: L('✓ Sent', '✓ 送信済み', '✓ Enviada'),
            todo: isTarget ? L(`Send by ${fmtDay(alert.deadline, lang)}`, `${fmtDay(alert.deadline, lang)}までに送信`, `Enviar até ${fmtDay(alert.deadline, lang)}`) : L('Not sent', '未送信', 'Falta enviar'),
          }[state]
          return (
            <div key={ws} className={`av2-week is-${state}${isTarget ? ' is-target' : ''}`}>
              <div className="av2-week-head">
                <strong>{range(ws)}</strong>
                <span className={`av2-pill is-${state}`}>{pill}</span>
              </div>
              <div className="av2-days">
                {days.map(d => {
                  const locked = isLocked(d, today)
                  const kind = kindOf(d)
                  const row = saved[d]
                  const changed = d in draft && draft[d] !== savedKind(d)
                  const n = jobsBy[d] || 0
                  const past = d < today
                  return (
                    <button key={d} type="button" disabled={locked}
                      aria-label={`${fmtDay(d, lang, { weekday: 'long', day: 'numeric', month: 'long' })} · ${kindLabel(kind, e)}${n ? ` · ${n}` : ''}`}
                      title={locked ? e.lockedDay : kindLabel(kind, e)}
                      className={`av2-day is-${kind}${locked ? ' is-locked' : ''}${changed ? ' is-changed' : ''}${d === today ? ' is-today' : ''}${past ? ' is-past' : ''}`}
                      onClick={() => setDraft(x => ({ ...x, [d]: nextKind(kind) }))}>
                      <b>{Number(d.slice(8))}</b>
                      <i aria-hidden="true">{kind === 'available' ? (locked ? '' : '✓') : KIND_ICON[kind]}</i>
                      <em className={`av2-jobs${n ? '' : ' is-none'}`} aria-hidden="true">{n ? `● ${n}` : ''}</em>
                      {row && !changed && kind !== 'available' && <span className={`av-st is-${row.status}`} title={statusLabel(row.status, e)} />}
                    </button>
                  )
                })}
              </div>
              {editable && (state === 'todo' || state === 'dirty') && (
                  <button type="button" className="av2-send" disabled={saving === ws} onClick={() => saveWeek(ws)}>
                    {saving === ws ? '…' : state === 'dirty' && sent ? L('Send changes', '変更を送信', 'Enviar mudanças') : L(`Send week ${range(ws)}`, `${range(ws)}を送信`, `Enviar semana ${range(ws)}`)}
                  </button>
                )}
            </div>
          )
        })}
      </section>

    </div>
  )
}

/** v1.0.163 · Início button that opens the weekly shift (always there; orange while a week is missing). */
export function ShiftWeekButton({ plans, lang, onOpen }) {
  const today = tokyoToday()
  const L = (en, ja, pt) => (lang === 'ja' ? ja : lang === 'pt' ? pt : en)
  const alert = planningAlert(plans, today)
  const sentWeeks = (plans || []).map(p => p.week_start).filter(w => w >= weekStartOf(today)).sort()
  const last = sentWeeks[sentWeeks.length - 1]
  const title = L('My weekly shift', '週のシフト', 'Meu shift semanal')
  const sub = alert
    ? L(`Send the week of ${fmtDay(alert.week, lang)} by ${fmtDay(alert.deadline, lang)}`, `${fmtDay(alert.week, lang)}の週を${fmtDay(alert.deadline, lang)}までに送信`, `Envie a semana de ${fmtDay(alert.week, lang)} até ${fmtDay(alert.deadline, lang)}`)
    : last ? L(`Sent up to the week of ${fmtDay(last, lang)}`, `${fmtDay(last, lang)}の週まで送信済み`, `Enviado até a semana de ${fmtDay(last, lang)}`)
      : L('See the calendar and your days off', 'カレンダーと休みを見る', 'Ver calendário e folgas')
  return (
    <button type="button" className={`av2-home${alert ? (alert.level === 'urgent' ? ' is-urgent' : ' is-todo') : ' is-ok'}`} onClick={onOpen}>
      <span className="av2-home-icon" aria-hidden="true">📅</span>
      <span className="av2-home-copy"><strong>{title}</strong><small>{sub}</small></span>
      <span className="av2-home-cta">{alert ? L('Send', '送信', 'Enviar') : L('Open', '開く', 'Abrir')} ›</span>
    </button>
  )
}
