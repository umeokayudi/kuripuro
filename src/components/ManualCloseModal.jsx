// v1.0.98 · "Fechar manualmente": closes a job left open, from Live Track or the Day agenda.
// Shows start, planned finish and time open; the admin picks the real finish (planned by default).
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang, localeOf } from '../hooks/useLang'
import { locationNameFromTitle } from '../lib/cleaningType'
import { contractForAgendaJob, expectedMinutes } from '../lib/agenda'
import { adminManualClose } from '../lib/jobAdminOps'
import './manual-close.css'
import { plannedEnd, suggestedEnd, manualCloseError, DEFAULT_CLOSE_REASON } from '../lib/manualClose'

const TZ = 'Asia/Tokyo'
const toLocalInput = iso => iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 16).replace(' ', 'T') : ''
const fromLocalInput = v => v ? new Date(`${v}:00+09:00`).toISOString() : null
const fmtMin = min => {
  if (min == null || Number.isNaN(min)) return '—'
  const m = Math.max(0, Math.round(min)), h = Math.floor(m / 60), r = m % 60
  return h ? (r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`) : `${r} min`
}

/** Button that opens the modal; same look as the buttons around it (`className`). */
export function ManualCloseButton({ job, expected, className = 'btn btn-sm', onDone }) {
  const { tr } = useLang()
  const [open, setOpen] = useState(false)
  if (job?.status !== 'in_progress') return null
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>🔒 {tr('Close manually', '手動で終了', 'Fechar manualmente')}</button>
      {open && <ManualCloseModal job={job} expected={expected} onClose={() => setOpen(false)} onDone={r => { setOpen(false); onDone?.(r) }} />}
    </>
  )
}

export default function ManualCloseModal({ job, expected: expectedProp, onClose, onDone }) {
  const { tr, lang } = useLang()
  const [expected, setExpected] = useState(expectedProp || null)
  const [start, setStart] = useState(toLocalInput(job.started_at))
  const [end, setEnd] = useState('')
  const [note, setNote] = useState('')
  const [err, setErr] = useState(null)
  const [saving, setSaving] = useState(false)
  const now = new Date()

  useEffect(() => {
    if (expectedProp) return
    supabase.from('service_contracts').select('*').then(({ data }) => setExpected(expectedMinutes(job, contractForAgendaJob(job, data || []))))
  }, [job.id, expectedProp]) // eslint-disable-line react-hooks/exhaustive-deps
  // Suggested finish = planned finish (never in the future), set once the plan is known.
  useEffect(() => { if (expected && !end) setEnd(toLocalInput(suggestedEnd(job, expected))) }, [expected]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saving, onClose])

  const startIso = fromLocalInput(start)
  const endIso = fromLocalInput(end)
  const planEnd = plannedEnd({ started_at: startIso }, expected)
  const openMin = startIso ? (now - new Date(startIso)) / 60000 : null
  const chosenMin = startIso && endIso ? (new Date(endIso) - new Date(startIso)) / 60000 : null
  const when = iso => iso ? new Date(iso).toLocaleString(localeOf(lang), { timeZone: TZ, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
  const errText = {
    start: tr('Enter the start time.', '開始時刻を入力してください。', 'Informe o horário de início.'),
    order: tr('The finish must be after the start.', '終了は開始より後にしてください。', 'O fim precisa ser depois do início.'),
    future: tr('The finish cannot be in the future.', '終了を未来の時刻にはできません。', 'O fim não pode ser no futuro.'),
    closed: tr('This job was already finished (the employee may have just closed it).', 'この作業はすでに終了しています（スタッフが終了した可能性があります）。', 'Este job já foi concluído (o funcionário pode ter acabado de fechar).'),
  }

  const save = async () => {
    const bad = manualCloseError({ startedAt: startIso, completedAt: endIso })
    setErr(bad)
    if (bad) return
    setSaving(true)
    try {
      const res = await adminManualClose(job, { startedAt: startIso, completedAt: endIso, note })
      toast.success(res.notified
        ? tr('Job closed · employee notified', '作業を終了し、スタッフに通知しました', 'Job fechado · funcionário avisado')
        : tr('Job closed', '作業を終了しました', 'Job fechado'))
      onDone?.(res)
    } catch (ex) {
      if (errText[ex.message]) setErr(ex.message)
      else toast.error(ex.message)
    }
    setSaving(false)
  }

  const row = (label, value, strong) => (
    <div className="mc-row"><span>{label}</span><b style={strong ? { color: '#dc2626' } : undefined}>{value}</b></div>
  )

  return (
    <div className="mc-overlay" role="dialog" aria-modal="true" aria-label={tr('Close manually', '手動で終了', 'Fechar manualmente')} onClick={() => !saving && onClose()}>
      <div className="mc-box" onClick={e => e.stopPropagation()}>
        <div className="mc-title">🔒 {tr('Close job manually', '作業を手動で終了', 'Fechar job manualmente')}</div>
        <div className="mc-sub">{locationNameFromTitle(job.title)} · {job.employee_name || '—'}</div>

        <div className="mc-facts">
          {row(tr('Started', '開始', 'Início'), when(startIso))}
          {row(tr('Planned finish', '予定終了', 'Fim planejado'), planEnd ? `${when(planEnd)} (${fmtMin(expected)})` : '—')}
          {row(tr('Open for', '経過時間', 'Tempo aberto'), fmtMin(openMin), expected && openMin > expected)}
        </div>

        {!job.started_at && (
          <label className="mc-field">{tr('Start', '開始', 'Início')} *
            <input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} className={err === 'start' ? 'is-bad' : ''} />
          </label>
        )}
        <label className="mc-field">{tr('Real finish time', '実際の終了時刻', 'Horário real de término')}
          <input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} className={err === 'order' || err === 'future' ? 'is-bad' : ''} />
        </label>
        <div className="mc-hint">
          {tr('Counts as', '計上される時間', 'Vai contar')}: <b>{fmtMin(chosenMin)}</b>
          {planEnd && endIso !== planEnd && <button type="button" className="mc-link" onClick={() => setEnd(toLocalInput(suggestedEnd({ started_at: startIso }, expected)))}>{tr('Use planned finish', '予定終了を使う', 'Usar fim planejado')}</button>}
        </div>

        <label className="mc-field">{tr('Note (optional)', 'メモ（任意）', 'Observação (opcional)')}
          <input value={note} onChange={e => setNote(e.target.value)} placeholder={DEFAULT_CLOSE_REASON[lang] || DEFAULT_CLOSE_REASON.en} />
        </label>

        {!job.photo_end_url && (
          <div className="mc-info">📷 {tr('No After photo yet: the job closes as "waiting for After photo" and stays on the employee\'s list.', 'After写真がまだありません：「After写真待ち」として終了し、スタッフのリストに残ります。', 'Ainda sem foto Depois: o job fecha como "aguardando foto Depois" e continua na lista do funcionário.')}</div>
        )}
        <div className="mc-info">🔔 {tr('The employee gets a message with the time used and can reply if it is wrong.', 'スタッフに使用した時刻がメッセージで届き、違う場合は返信できます。', 'O funcionário recebe uma mensagem com o horário usado e pode responder se estiver errado.')}</div>

        {err && <div className="mc-error">{errText[err]}</div>}

        <div className="mc-actions">
          <button type="button" className="btn" disabled={saving} onClick={onClose}>{tr('Cancel', 'キャンセル', 'Cancelar')}</button>
          <button type="button" className="btn btn-primary" disabled={saving || !end} onClick={save}>{saving ? '…' : tr('Close job', '終了する', 'Fechar job')}</button>
        </div>
      </div>
    </div>
  )
}
