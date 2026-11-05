// v1.0.151 · "Meu shift": the employee marks each of the next days — ✅ Vou trabalhar / ✕ Não posso / ＋ Extra.
// The weekly pattern only shows what is EXPECTED; the mark is for that specific day and never changes the pattern.
// Until 21:00 of the day before the office sees "aguardando confirmação"; after it, "SEM CONFIRMAÇÃO".
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { tokyoToday } from '../lib/dates'
import { addDays, dowOf, workDaysOf } from '../lib/schedulePlan'
import { shiftMarkOf, SHIFT_CUTOFF } from '../lib/dayPanel'
import { saveShiftMark, clearShiftMark, fetchShiftMarks } from '../lib/shiftMarks'
import { fmtDay } from './AvailabilityPlanner'
import './dayPanel.css'

const DAYS = 7

export default function ShiftMarkCard({ user, lang, L, jobs = [], days = DAYS }) {
  const today = tokyoToday()
  const to = addDays(today, days - 1)
  const [rows, setRows] = useState([])
  const [emp, setEmp] = useState(null)
  const [reasonFor, setReasonFor] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState('')

  const load = () => {
    fetchShiftMarks(user.id, today, to).then(setRows).catch(() => {})
    supabase.from('employees').select('id,full_name,work_days').eq('id', user.id).maybeSingle().then(({ data }) => setEmp(data || null))
  }
  useEffect(load, [user.id, today]) // eslint-disable-line react-hooks/exhaustive-deps

  const mark = async (date, kind, why = '') => {
    setBusy(date + kind)
    try {
      await saveShiftMark({ employee: { id: user.id, name: user.name }, date, kind, reason: why, by: { name: user.name, role: 'employee' } })
      toast.success(kind === 'confirmed' ? L('Confirmed — see you there', '出勤を確認しました', 'Confirmado — até lá') : kind === 'off' ? L('Sent: you cannot work this day', '送信: この日は不可', 'Enviado: você não pode neste dia') : L('Extra work offered', '追加勤務を申し出ました', 'Trabalho extra oferecido'))
      setReasonFor(null); setReason('')
      load()
    } catch (e) { toast.error(e.message) }
    setBusy('')
  }
  const clear = async date => {
    setBusy(date + 'clear')
    try { await clearShiftMark(user.id, date); load() } catch (e) { toast.error(e.message) }
    setBusy('')
  }

  const wd = workDaysOf(emp)
  const list = Array.from({ length: days }, (_, i) => addDays(today, i))
  return (
    <section className="smc" aria-label={L('My shift', 'マイシフト', 'Meu shift')}>
      <div className="smc-head">
        <h3>🗓 {L('My shift — confirm each day', 'マイシフト — 毎日確認', 'Meu shift — confirme cada dia')}</h3>
        <p>{L(`Mark by ${SHIFT_CUTOFF} of the day before. The weekly pattern is only what is expected.`, `前日${SHIFT_CUTOFF}までに確認してください。週のパターンは予定のみです。`, `Marque até ${SHIFT_CUTOFF} da véspera. O padrão semanal é só o esperado.`)}</p>
      </div>
      <ul className="smc-days">
        {list.map(d => {
          const m = shiftMarkOf(rows.find(r => r.date === d))
          const expected = !!(wd && wd.has(dowOf(d)))
          const n = jobs.filter(j => j.scheduled_date === d && j.status !== 'cancelled').length
          return (
            <li key={d} className={m ? `has-${m.kind}` : ''}>
              <div className="smc-day">
                <strong>{d === today ? L('Today', '今日', 'Hoje') : d === addDays(today, 1) ? L('Tomorrow', '明日', 'Amanhã') : fmtDay(d, lang, { weekday: 'short' })} · {fmtDay(d, lang, { day: 'numeric', month: 'short' })}</strong>
                <small>{expected ? L('expected (weekly pattern)', '予定あり（週パターン）', 'esperado (padrão semanal)') : L('outside the weekly pattern', '週パターン外', 'fora do padrão semanal')}{n ? L(` · ${n} job${n > 1 ? 's' : ''}`, ` · ${n}件`, ` · ${n} ${n === 1 ? 'serviço' : 'serviços'}`) : ''}</small>
                <span className={`smc-state ${m ? m.kind : expected || n ? 'none' : 'muted'}`}>
                  {m?.kind === 'confirmed' ? L('✅ Confirmed', '✅ 確認済み', '✅ Confirmado') : m?.kind === 'off' ? L("✕ Can't", '✕ 不可', '✕ Não posso') + (m.reason ? ` · ${m.reason}` : '') + (m.status === 'approved' ? L(' (approved)', '（承認済）', ' (aprovado)') : '') : m?.kind === 'extra' ? L('＋ Extra work', '＋ 追加勤務', '＋ Trabalho extra') : L('No mark yet', '未確認', 'Sem marca')}
                </span>
              </div>
              <div className="smc-btns">
                <button type="button" className={m?.kind === 'confirmed' ? 'on ok' : ''} disabled={!!busy} onClick={() => mark(d, 'confirmed')}>✅ {L("I'll work", '出勤', 'Vou trabalhar')}</button>
                <button type="button" className={m?.kind === 'off' ? 'on bad' : ''} disabled={!!busy} onClick={() => { setReasonFor(reasonFor === d ? null : d); setReason(m?.reason || '') }}>✕ {L("Can't", '不可', 'Não posso')}</button>
                <button type="button" className={m?.kind === 'extra' ? 'on info' : ''} disabled={!!busy} onClick={() => mark(d, 'extra')}>＋ {L('Extra', '追加', 'Extra')}</button>
                {m && <button type="button" className="smc-clear" disabled={!!busy} onClick={() => clear(d)} aria-label={L('Remove the mark', '取り消す', 'Tirar a marca')}>↺</button>}
              </div>
              {reasonFor === d && (
                <div className="smc-reason">
                  <input value={reason} onChange={e => setReason(e.target.value)} placeholder={L('Reason (optional)', '理由（任意）', 'Motivo (opcional)')} />
                  <button type="button" disabled={!!busy} onClick={() => mark(d, 'off', reason)}>{L('Send', '送信', 'Enviar')}</button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
