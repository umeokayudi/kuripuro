import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { fill } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { plannerWeeks, weekDays, isLocked, byDate, nextKind, diffWeek, addDays, planningAlert } from '../lib/availability'

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

export function fmtDay(iso, lang, opts = { day: 'numeric', month: 'short' }) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-GB', { ...opts, timeZone: 'UTC' })
}

// Employee planner: tap days to switch between available / day off / extra work.
export default function AvailabilityPlanner({ user, e, lang, plans, onPlansChanged }) {
  const today = tokyoToday()
  const weeks = useMemo(() => plannerWeeks(today, 5), [today])
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
  const kindOf = (d) => draft[d] ?? saved[d]?.kind ?? 'available'
  const planned = new Set((plans || []).map(p => p.week_start))
  const alert = planningAlert(plans, today)

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

  return (
    <div className="av-planner">
      <div className="ex-section-title" style={{ marginBottom: 2 }}>{e.availability}</div>
      <p className="av-intro">{e.availIntro}</p>
      <div className="av-legend">
        {['available', 'off', 'extra'].map(k => <span key={k} className={`av-chip is-${k}`}>{KIND_ICON[k]} {kindLabel(k, e)}</span>)}
      </div>
      <PlanAlert alert={alert} e={e} lang={lang} />
      {weeks.map(ws => {
        const days = weekDays(ws)
        const dirty = days.some(d => d in draft && draft[d] !== (saved[d]?.kind ?? 'available'))
        const editable = days.some(d => !isLocked(d, today))
        return (
          <section key={ws} className="av-week">
            <div className="av-week-head">
              <strong>{fill(e.weekOf, { date: fmtDay(ws, lang) })}</strong>
              <span className={`av-week-state${planned.has(ws) ? ' is-done' : ''}`}>{planned.has(ws) ? e.weekPlanned : e.weekNotPlanned}</span>
            </div>
            <div className="av-days">
              {days.map(d => {
                const locked = isLocked(d, today)
                const kind = kindOf(d)
                const row = saved[d]
                const changed = d in draft && draft[d] !== (row?.kind ?? 'available')
                return (
                  <button key={d} type="button" disabled={locked}
                    title={locked ? e.lockedDay : kindLabel(kind, e)}
                    className={`av-day is-${kind}${locked ? ' is-locked' : ''}${changed ? ' is-changed' : ''}`}
                    onClick={() => setDraft(x => ({ ...x, [d]: nextKind(kind) }))}>
                    <small>{fmtDay(d, lang, { weekday: 'short' })}</small>
                    <b>{Number(d.slice(8))}</b>
                    <i aria-hidden="true">{locked && kind === 'available' ? '🔒' : KIND_ICON[kind]}</i>
                    {row && !changed && kind !== 'available' && <em className={`av-st is-${row.status}`} title={statusLabel(row.status, e)} />}
                  </button>
                )
              })}
            </div>
            {days.filter(d => saved[d] && saved[d].kind !== 'available' && !(d in draft)).map(d => (
              <div key={d} className="av-note">
                <span>{fmtDay(d, lang, { weekday: 'short', day: 'numeric', month: 'short' })} · {kindLabel(saved[d].kind, e)}</span>
                <span className={`av-st-label is-${saved[d].status}`}>{statusLabel(saved[d].status, e)}</span>
                {saved[d].admin_note && <small>{e.adminNote}: {saved[d].admin_note}</small>}
              </div>
            ))}
            {editable && (
              <button type="button" className="av-save" disabled={saving === ws || (!dirty && planned.has(ws))} onClick={() => saveWeek(ws)}>
                {saving === ws ? '…' : e.saveWeek}
              </button>
            )}
          </section>
        )
      })}
    </div>
  )
}
