import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { tokyoToday } from '../lib/dates'
import {
  loadRound, saveRound, newRound, segmentStart, quickRoundRows, completeQuickRow, undoQuickRow,
} from '../lib/quickRound'
import './QuickRound.css'

// Always in Portuguese: this mode exists only for the owner's own account.
const ERRORS = {
  already_done_today: 'Esse local já foi feito hoje por outra pessoa',
  blocked: 'Outra pessoa está fazendo esse local agora',
  transfer_race: 'Esse local acabou de mudar, tente de novo',
}

const pad = (n) => String(n).padStart(2, '0')
function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}
function fmtMinutes(ms) {
  const m = Math.max(0, Math.round(ms / 60000))
  return m >= 60 ? `${Math.floor(m / 60)}h${pad(m % 60)}` : `${m} min`
}
const fmtClock = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })

export default function QuickRound({ user, allJobs, onChanged }) {
  const [round, setRound] = useState(() => loadRound(user.id))
  const [now, setNow] = useState(Date.now())
  const [busyKey, setBusyKey] = useState(null)
  const [filter, setFilter] = useState('')
  const [showAll, setShowAll] = useState(false)

  useEffect(() => { saveRound(user.id, round) }, [user.id, round])
  useEffect(() => {
    if (!round || round.endedAt) return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [round])

  const today = tokyoToday()
  const rows = useMemo(
    () => quickRoundRows((allJobs || []).filter(j => j.scheduled_date === today), user.id),
    [allJobs, today, user.id],
  )
  const doneByKey = useMemo(() => new Map((round?.done || []).map(d => [d.key, d])), [round])

  const start = () => setRound(newRound())

  const finish = () => {
    if (!window.confirm('Encerrar a rodada?')) return
    setRound(r => ({ ...r, endedAt: new Date().toISOString() }))
  }

  const markDone = async (row) => {
    if (busyKey || !round || round.endedAt) return
    setBusyKey(row.key)
    try {
      const result = await completeQuickRow(supabase, {
        employee: { id: user.id, name: user.name }, row, startedAt: segmentStart(round),
      })
      if (!result.ok) { toast.error(ERRORS[result.error] || result.detail || 'Não deu para salvar, tente de novo'); return }
      const at = result.already ? (result.job.completed_at || new Date().toISOString()) : result.job.completed_at
      setRound(r => ({ ...r, done: [...r.done, { key: row.key, name: row.name, jobId: result.job.id, at, already: !!result.already }] }))
      toast.success(`✓ ${row.name}`)
      onChanged?.()
    } finally {
      setBusyKey(null)
    }
  }

  const undo = async (row) => {
    const entry = doneByKey.get(row.key)
    if (!entry || busyKey) return
    if (entry.already) { setRound(r => ({ ...r, done: r.done.filter(d => d.key !== row.key) })); return }
    setBusyKey(row.key)
    try {
      const res = await undoQuickRow(supabase, entry.jobId)
      if (!res.ok) { toast.error(res.detail || 'Não deu para desfazer'); return }
      setRound(r => ({ ...r, done: r.done.filter(d => d.key !== row.key) }))
      onChanged?.()
    } finally {
      setBusyKey(null)
    }
  }

  if (!round) {
    return (
      <section className="qr-card qr-idle">
        <div>
          <small>Rodada rápida</small>
          <strong>Todos os restaurantes</strong>
          <span>Sem checklist, foto ou GPS. Só o horário.</span>
        </div>
        <button type="button" className="qr-start" onClick={start}>▶ Start</button>
      </section>
    )
  }

  const startedMs = new Date(round.startedAt).getTime()
  const endMs = round.endedAt ? new Date(round.endedAt).getTime() : now
  const ended = !!round.endedAt
  const doneRows = round.done
  const q = filter.trim().toLowerCase()
  const doneJobIds = new Set(doneRows.map(d => d.jobId))
  const pending = rows.filter(r =>
    !doneByKey.has(r.key) && !doneJobIds.has(r.job?.id) && r.job?.status !== 'completed'
    && (!q || r.name.toLowerCase().includes(q)))
  const scheduledPending = pending.filter(r => r.scheduled)
  const otherPending = pending.filter(r => !r.scheduled)
  const visibleOthers = showAll || q ? otherPending : []

  return (
    <section className={`qr-card${ended ? ' is-ended' : ' is-running'}`}>
      <div className="qr-head">
        <div>
          <small>{ended ? 'Rodada encerrada' : 'Rodada rápida em andamento'}</small>
          <strong className="qr-timer">{fmtElapsed(endMs - startedMs)}</strong>
          <span>Início {fmtClock(round.startedAt)}{ended ? ` · fim ${fmtClock(round.endedAt)}` : ''} · {doneRows.length} {doneRows.length === 1 ? 'local feito' : 'locais feitos'}</span>
        </div>
        {ended
          ? <button type="button" className="qr-start" onClick={() => setRound(null)}>Nova rodada</button>
          : <button type="button" className="qr-stop" onClick={finish}>■ Encerrar</button>}
      </div>

      {doneRows.length > 0 && (
        <ul className="qr-list qr-done">
          {doneRows.map((d, i) => {
            const from = i === 0 ? round.startedAt : doneRows[i - 1].at
            const row = { key: d.key }
            return (
              <li key={d.key}>
                <span className="qr-check" aria-hidden="true">✓</span>
                <div><strong>{d.name}</strong><span>{fmtClock(d.at)}{d.already ? ' · já estava feito' : ` · ${fmtMinutes(new Date(d.at) - new Date(from))}`}</span></div>
                {!ended && <button type="button" className="qr-undo" disabled={!!busyKey} onClick={() => undo(row)}>Desfazer</button>}
              </li>
            )
          })}
        </ul>
      )}

      {!ended && (
        <>
          <input className="qr-search" type="search" placeholder="Buscar restaurante" value={filter} onChange={ev => setFilter(ev.target.value)} />
          {scheduledPending.length > 0 && <p className="qr-label">Seus serviços de hoje</p>}
          <ul className="qr-list">
            {scheduledPending.map(r => <PendingRow key={r.key} row={r} busy={busyKey === r.key} disabled={!!busyKey} onDone={markDone} />)}
          </ul>
          {otherPending.length > 0 && !q && (
            <button type="button" className="qr-more" onClick={() => setShowAll(v => !v)}>
              {showAll ? 'Esconder outros restaurantes' : `Outros restaurantes (${otherPending.length})`}
            </button>
          )}
          {visibleOthers.length > 0 && (
            <ul className="qr-list">
              {visibleOthers.map(r => <PendingRow key={r.key} row={r} busy={busyKey === r.key} disabled={!!busyKey} onDone={markDone} />)}
            </ul>
          )}
          {q && pending.length === 0 && <p className="qr-empty">Nenhum restaurante com esse nome</p>}
        </>
      )}
    </section>
  )
}

function PendingRow({ row, busy, disabled, onDone }) {
  return (
    <li>
      <div><strong>{row.name}</strong>{row.title !== row.name && <span>{row.title}</span>}</div>
      <button type="button" className="qr-done-btn" disabled={disabled} onClick={() => onDone(row)}>{busy ? '…' : 'Feito'}</button>
    </li>
  )
}
