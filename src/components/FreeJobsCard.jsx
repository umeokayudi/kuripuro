// v1.0.154 · "Pegou, é meu": free services of the day (no fixed person) shown on the employee home.
// One tap = the job is mine: it leaves the others' list and the Painel shows the store "com <nome>".
// The take is atomic (assignOps.takeOffer: only while nobody has it), so two people never get the same job.
import { useState } from 'react'
import { serviceLabel, storeOf } from '../lib/dayPanel'
import { jobTimeLabel } from '../lib/jobDeadline'
import { fmtDay } from './AvailabilityPlanner'
import './dayPanel.css'

export default function FreeJobsCard({ jobs = [], lang, L, onTake, onSkip }) {
  const [busy, setBusy] = useState(null)
  const free = jobs.filter(j => j._open)
  if (!free.length) return null
  const take = async j => { setBusy(j.id); try { await onTake(j) } finally { setBusy(null) } }
  return (
    <section className="smc fjc" aria-label={L('Free services', '空き作業', 'Serviços livres')}>
      <div className="smc-head">
        <h3>🙋 {L('Free services — take one', '空き作業 — 取ってください', 'Serviços livres — pegue um')} <span className="dp-n">{free.length}</span></h3>
        <p>{L('Tap "Take it — it\'s mine": the job becomes yours and leaves the others\' list. Whoever takes it finishes it.', '「取る」を押すとあなたの作業になり、他の人のリストから消えます。取った人が完了まで担当します。', 'Toque em "Pegar — é meu": o serviço vira seu e sai da lista dos outros. Quem pegou é o responsável por concluir.')}</p>
      </div>
      <ul className="fjc-list">
        {free.map(j => (
          <li key={j.id}>
            <div className="fjc-info">
              <strong>{storeOf(j)}</strong>
              <span>{serviceLabel(j, L)}</span>
              <small>{fmtDay(j.scheduled_date, lang, { weekday: 'short', day: '2-digit', month: '2-digit' })} · {jobTimeLabel(j, L)}</small>
            </div>
            <div className="fjc-btns">
              <button type="button" className="fjc-take" disabled={busy === j.id} onClick={() => take(j)}>✋ {L("Take it — it's mine", '取る — 自分の作業', 'Pegar — é meu')}</button>
              <button type="button" className="fjc-skip" disabled={busy === j.id} onClick={() => onSkip(j)}>{L('Not for me', '今回はパス', 'Não é pra mim')}</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
