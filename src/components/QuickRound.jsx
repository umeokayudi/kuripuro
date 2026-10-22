import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { tokyoToday } from '../lib/dates'
import {
  loadRound, saveRound, newRound, segmentStart, quickRoundRows, completeQuickRow, undoQuickRow,
  suggestedMinutes, placeWindow,
} from '../lib/quickRound'
import './QuickRound.css'

// Always in Portuguese: this mode exists only for the owner's own account.
const ERRORS = {
  already_done_today: 'Esse local já foi feito hoje por outra pessoa',
  blocked: 'Outra pessoa está fazendo esse local agora',
  transfer_race: 'Esse local acabou de mudar, tente de novo',
}

const MINUTE_CHIPS = [15, 30, 45, 60, 90, 120]

const pad = (n) => String(n).padStart(2, '0')
function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}
function fmtMinutes(min) {
  const m = Math.max(0, Math.round(min))
  return m >= 60 ? `${Math.floor(m / 60)}h${pad(m % 60)}` : `${m} min`
}
const fmtClock = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })

/**
 * Quick start: one button starts the clock, then places are added one by one
 * (now or later), each with an approximate time.
 */
export default function QuickRound({ user, allJobs, onChanged }) {
  const [round, setRound] = useState(() => loadRound(user.id))
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState(null)
  const [minutes, setMinutes] = useState(30)
  const [filter, setFilter] = useState('')

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

  const start = () => setRound(newRound())

  const finish = () => {
    if (!window.confirm('Encerrar o serviço de hoje?')) return
    closePicker()
    setRound(r => ({ ...r, endedAt: new Date().toISOString() }))
  }

  const closePicker = () => { setPicking(false); setPicked(null); setFilter('') }

  const pick = (row) => {
    setPicked(row)
    setMinutes(suggestedMinutes(segmentStart(round)))
  }

  const save = async () => {
    if (busy || !picked || !round || round.endedAt) return
    setBusy(true)
    try {
      const win = placeWindow(segmentStart(round), minutes)
      const result = await completeQuickRow(supabase, {
        employee: { id: user.id, name: user.name }, row: picked, ...win,
      })
      if (!result.ok) { toast.error(ERRORS[result.error] || result.detail || 'Não deu para salvar, tente de novo'); return }
      const already = !!result.already
      const at = already ? (result.job.completed_at || win.completedAt) : result.job.completed_at
      setRound(r => ({
        ...r,
        done: [...r.done, { key: picked.key, name: picked.name, jobId: result.job.id, at, from: already ? null : win.startedAt, minutes: already ? null : minutes, already }],
      }))
      toast.success(`✓ ${picked.name} · ${fmtMinutes(minutes)}`)
      closePicker()
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  const undo = async (entry) => {
    if (busy) return
    if (entry.already) { setRound(r => ({ ...r, done: r.done.filter(d => d.key !== entry.key) })); return }
    setBusy(true)
    try {
      const res = await undoQuickRow(supabase, entry.jobId)
      if (!res.ok) { toast.error(res.detail || 'Não deu para desfazer'); return }
      setRound(r => ({ ...r, done: r.done.filter(d => d.key !== entry.key) }))
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  if (!round) {
    return (
      <section className="qr-card qr-idle">
        <div>
          <small>Início rápido</small>
          <strong>Começar o serviço agora</strong>
          <span>Depois você adiciona cada local, um por um, com o tempo aproximado.</span>
        </div>
        <button type="button" className="qr-start" onClick={start}>▶ Começar</button>
      </section>
    )
  }

  const startedMs = new Date(round.startedAt).getTime()
  const endMs = round.endedAt ? new Date(round.endedAt).getTime() : now
  const ended = !!round.endedAt
  const doneRows = round.done
  const doneKeys = new Set(doneRows.map(d => d.key))
  const doneJobIds = new Set(doneRows.map(d => d.jobId))
  const q = filter.trim().toLowerCase()
  const pending = rows.filter(r =>
    !doneKeys.has(r.key) && !doneJobIds.has(r.job?.id) && r.job?.status !== 'completed'
    && (!q || r.name.toLowerCase().includes(q)))
  const scheduledPending = pending.filter(r => r.scheduled)
  const otherPending = pending.filter(r => !r.scheduled)
  const totalMin = doneRows.reduce((sum, d) => sum + (d.minutes || 0), 0)

  return (
    <section className={`qr-card${ended ? ' is-ended' : ' is-running'}`}>
      <div className="qr-head">
        <div>
          <small>{ended ? 'Serviço encerrado' : 'Serviço em andamento'}</small>
          <strong className="qr-timer">{fmtElapsed(endMs - startedMs)}</strong>
          <span>Início {fmtClock(round.startedAt)}{ended ? ` · fim ${fmtClock(round.endedAt)}` : ''} · {doneRows.length} {doneRows.length === 1 ? 'local' : 'locais'}{totalMin ? ` · ~${fmtMinutes(totalMin)}` : ''}</span>
        </div>
        {ended
          ? <button type="button" className="qr-start" onClick={() => setRound(null)}>Novo</button>
          : <button type="button" className="qr-stop" onClick={finish}>■ Encerrar</button>}
      </div>

      {doneRows.length > 0 && (
        <ol className="qr-list qr-done">
          {doneRows.map(d => (
            <li key={d.key}>
              <span className="qr-check" aria-hidden="true">✓</span>
              <div>
                <strong>{d.name}</strong>
                <span>{d.already ? `${fmtClock(d.at)} · já estava feito` : `${d.from ? `${fmtClock(d.from)}–` : ''}${fmtClock(d.at)} · ~${fmtMinutes(d.minutes ?? 0)}`}</span>
              </div>
              {!ended && <button type="button" className="qr-undo" disabled={busy} onClick={() => undo(d)}>Desfazer</button>}
            </li>
          ))}
        </ol>
      )}

      {!ended && !picking && (
        <button type="button" className="qr-add" onClick={() => setPicking(true)}>＋ Adicionar local</button>
      )}

      {!ended && picking && !picked && (
        <div className="qr-picker">
          <div className="qr-picker-head">
            <strong>Qual local você fez?</strong>
            <button type="button" className="qr-undo" onClick={closePicker}>Cancelar</button>
          </div>
          <input className="qr-search" type="search" placeholder="Buscar restaurante" value={filter} onChange={ev => setFilter(ev.target.value)} autoFocus />
          {scheduledPending.length > 0 && <p className="qr-label">Seus serviços de hoje</p>}
          <ul className="qr-list">
            {scheduledPending.map(r => <PickRow key={r.key} row={r} onPick={pick} />)}
          </ul>
          {otherPending.length > 0 && <p className="qr-label">Todos os restaurantes</p>}
          <ul className="qr-list qr-scroll">
            {otherPending.map(r => <PickRow key={r.key} row={r} onPick={pick} />)}
          </ul>
          {q && pending.length === 0 && <p className="qr-empty">Nenhum restaurante com esse nome</p>}
        </div>
      )}

      {!ended && picked && (
        <div className="qr-picker">
          <div className="qr-picker-head">
            <div><small>Local</small><strong>{picked.name}</strong></div>
            <button type="button" className="qr-undo" disabled={busy} onClick={() => setPicked(null)}>Trocar</button>
          </div>
          <p className="qr-label">Tempo aproximado</p>
          <div className="qr-minutes">
            <button type="button" aria-label="Menos 5 minutos" disabled={busy || minutes <= 5} onClick={() => setMinutes(m => Math.max(5, m - 5))}>−</button>
            <strong>{fmtMinutes(minutes)}</strong>
            <button type="button" aria-label="Mais 5 minutos" disabled={busy} onClick={() => setMinutes(m => Math.min(600, m + 5))}>＋</button>
          </div>
          <div className="qr-chips">
            {MINUTE_CHIPS.map(m => (
              <button key={m} type="button" className={m === minutes ? 'is-on' : ''} disabled={busy} onClick={() => setMinutes(m)}>{fmtMinutes(m)}</button>
            ))}
          </div>
          <button type="button" className="qr-save" disabled={busy} onClick={save}>{busy ? 'Salvando…' : `✓ Salvar ${picked.name}`}</button>
        </div>
      )}
    </section>
  )
}

function PickRow({ row, onPick }) {
  return (
    <li>
      <button type="button" className="qr-pick" onClick={() => onPick(row)}>
        <div><strong>{row.name}</strong>{row.title !== row.name && <span>{row.title}</span>}</div>
        <b aria-hidden="true">›</b>
      </button>
    </li>
  )
}
