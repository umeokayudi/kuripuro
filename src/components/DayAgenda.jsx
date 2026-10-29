// Agenda do Dia — the default Jobs screen. One column per person, in execution order
// (jobs.sequence_order). Drag the number to reorder or move to someone else; it saves at once.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import './agenda.css'
import { supabase } from '../lib/supabase'
import { useLang, localeOf } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { getCleaningType, locationNameFromTitle, parseDeepTaskList, DEEP_TASKS, deepTaskName } from '../lib/cleaningType'
import { checklistDisplayLabel } from '../lib/jobChecklist'
import { isMissedJob } from '../lib/jobOverdue'
import {
  agendaColumns, moveInList, orderUpdates, MANUAL_ORDER_BASE, isManualOrder, contractForAgendaJob, expectedMinutes, agendaChecklistItems,
  checklistProgress, checklistUpdate, timeState, awaitingAfterPhoto, aiPending, progressBucket, storeName,
  DEFAULT_AGENDA_SETTINGS,
} from '../lib/agenda'
import { loadAgendaSettings, saveAgendaSettings, adminCompleteJob, adminReopenJob, adjustJobTime, saveOrder, loadJobLog } from '../lib/jobAdminOps'
import { gradeJobPhoto, aiIssueRows } from '../lib/photoAi'
import { askConfirm, confirmAndRun } from './ConfirmDialog'
import ProgressChart from './ProgressChart'
import JobPhotos from './JobPhotos'
import PhotoLightbox from './PhotoLightbox'

const STATUS_COLOR = { assigned: '#60a5fa', in_progress: '#f59e0b', completed: '#22c55e', cancelled: '#ef4444' }

function shiftDate(d, n) {
  const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10)
}
const toLocalInput = iso => iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 16).replace(' ', 'T') : ''
const fromLocalInput = v => v ? new Date(`${v}:00+09:00`).toISOString() : null
const hm = iso => iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }) : ''
export function fmtMin(min) {
  if (min == null) return '—'
  const h = Math.floor(min / 60), m = Math.round(min % 60)
  return h ? (m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`) : `${m} min`
}

export default function DayAgenda({ onChanged, onEditJob }) {
  const { lang, tr } = useLang()
  const [date, setDate] = useState(tokyoToday())
  const [jobs, setJobs] = useState([])
  const [employees, setEmployees] = useState([])
  const [contracts, setContracts] = useState([])
  const [places, setPlaces] = useState([])
  const [clients, setClients] = useState([])
  const [people, setPeople] = useState(() => new Set())
  const [settings, setSettings] = useState(DEFAULT_AGENDA_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [now, setNow] = useState(() => new Date())
  const [refreshKey, setRefreshKey] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [onlyFlag, setOnlyFlag] = useState('')
  const loadSeq = useRef(0)

  const loadDay = useCallback(async (d = date) => {
    const seq = ++loadSeq.current
    const { data, error } = await supabase.from('jobs').select('*').eq('scheduled_date', d)
    if (seq !== loadSeq.current) return
    if (error) setLoadError(error.message)
    else { setLoadError(null); setJobs(data || []) }
    setLoading(false)
  }, [date])

  useEffect(() => {
    Promise.all([
      supabase.from('employees').select('*').eq('is_active', true).order('full_name'),
      supabase.from('service_contracts').select('*'),
      supabase.from('locations').select('*').eq('is_active', true),
      supabase.from('clients').select('id,company_name').eq('is_active', true),
    ]).then(([e, sc, l, c]) => {
      setEmployees(e.data || []); setContracts(sc.data || []); setPlaces(l.data || []); setClients(c.data || [])
    })
    loadAgendaSettings().then(setSettings)
  }, [])
  useEffect(() => { setLoading(true); loadDay(date) }, [date])
  // Fresh data: every minute, when the tab comes back, and right after any write (refresh()).
  useEffect(() => {
    const tick = setInterval(() => { setNow(new Date()); loadDay() }, 60000)
    const onFocus = () => { setNow(new Date()); loadDay() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => { clearInterval(tick); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [loadDay])

  const refresh = async () => {
    await loadDay()
    setNow(new Date())
    setRefreshKey(k => k + 1)
    onChanged?.()
  }

  const info = useMemo(() => {
    const map = {}
    for (const j of jobs) {
      const contract = contractForAgendaJob(j, contracts)
      const place = places.find(p => (j.location_id && p.id === j.location_id) || p.name?.toLowerCase() === storeName(locationNameFromTitle(j.title)).toLowerCase())
      const expected = expectedMinutes(j, contract)
      const items = agendaChecklistItems(j, { place, contract })
      const clientId = j.client_id || contract?.client_id || place?.client_id
      map[j.id] = {
        contract, place, expected, items,
        progress: checklistProgress(j, items),
        time: timeState(j, expected, settings, now),
        bucket: progressBucket(j, { expected, settings, now }),
        client: clients.find(c => c.id === clientId)?.company_name || j.client_name || '',
      }
    }
    return map
  }, [jobs, contracts, places, clients, settings, now])

  const flagOf = j => {
    const t = info[j.id]?.time?.state
    if (t === 'cap' || t === 'overrun') return 'overtime'
    if (awaitingAfterPhoto(j)) return 'after'
    if (info[j.id]?.bucket === 'late') return 'late'
    return ''
  }
  const visibleJobs = onlyFlag ? jobs.filter(j => flagOf(j) === onlyFlag) : jobs
  const columns = useMemo(() => agendaColumns(visibleJobs, employees, people.size ? people : null), [visibleJobs, employees, people])
  const jobsById = useMemo(() => Object.fromEntries(jobs.map(j => [j.id, j])), [jobs])
  const personChips = useMemo(() => {
    const ids = new Set(jobs.map(j => j.employee_id || ''))
    return [...employees.filter(e => ids.has(e.id)).map(e => ({ id: e.id, name: e.full_name })), ...(ids.has('') ? [{ id: '', name: tr('No one', '未割当', 'Sem pessoa') }] : [])]
  }, [jobs, employees, lang])

  const counts = useMemo(() => {
    const live = jobs.filter(j => j.status !== 'cancelled')
    return {
      total: live.length,
      done: live.filter(j => j.status === 'completed').length,
      running: live.filter(j => j.status === 'in_progress').length,
      late: live.filter(j => info[j.id]?.bucket === 'late').length,
      overtime: live.filter(j => flagOf(j) === 'overtime').length,
      after: live.filter(awaitingAfterPhoto).length,
    }
  }, [jobs, info])

  // ── Ordering ────────────────────────────────────────────
  const [drag, setDrag] = useState(null)
  const dragRef = useRef(null)
  const commitMove = async (jobId, toCol, toIndex) => {
    const job = jobsById[jobId]
    if (!job) return
    const fromCol = job.employee_id || ''
    const targetIds = columns.find(c => c.id === toCol)?.jobs.map(j => j.id) || []
    const ids = moveInList(targetIds, jobId, toIndex)
    const ups = orderUpdates(ids, jobsById)
    if (fromCol !== toCol) {
      if (job.status !== 'assigned') { toast.error(tr('Only jobs not started can go to another person.', '開始前の作業のみ担当変更できます。', 'Só job não iniciado pode ir para outra pessoa.')); return }
      const emp = employees.find(e => e.id === toCol)
      const mine = ups.find(u => u.id === jobId) || { id: jobId, sequence_order: MANUAL_ORDER_BASE + ids.indexOf(jobId) + 1 }
      Object.assign(mine, { employee_id: toCol || null, employee_name: emp?.full_name || null })
      if (!ups.includes(mine)) ups.push(mine)
    }
    if (!ups.length) return
    // Show the new order immediately, then save and reload.
    setJobs(list => list.map(j => { const u = ups.find(x => x.id === j.id); return u ? { ...j, ...u } : j }))
    try {
      await saveOrder(ups)
      toast.success(tr('Order saved', '順番を保存しました', 'Ordem salva'))
    } catch (err) {
      toast.error(err.message)
    }
    refresh()
  }

  // Back to the clock: plain 1..n in time order, so the column follows scheduled_time again.
  const resetToClock = async col => {
    const byTime = [...col.jobs].sort((a, b) => (a.scheduled_time || '99:99').localeCompare(b.scheduled_time || '99:99'))
    const ups = byTime.map((j, i) => ({ id: j.id, sequence_order: i + 1 }))
    try {
      await saveOrder(ups)
      toast.success(tr('Back to clock order', '時刻順に戻しました', 'Voltou para a ordem do horário'))
    } catch (err) { toast.error(err.message) }
    refresh()
  }

  const onHandleDown = (e, job, colId) => {
    if (e.button !== undefined && e.button !== 0) return
    const card = e.currentTarget.closest('[data-ag-card]')
    const rect = card?.getBoundingClientRect()
    dragRef.current = { id: job.id, colId, startX: e.clientX, startY: e.clientY, offX: e.clientX - (rect?.left || 0), offY: e.clientY - (rect?.top || 0), active: false, html: card?.outerHTML }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onHandleMove = e => {
    const d = dragRef.current
    if (!d) return
    if (!d.active && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return
    d.active = true
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const colEl = el?.closest?.('[data-ag-col]')
    let overCol = colEl ? colEl.getAttribute('data-ag-col') : null
    let overIdx = 0
    if (colEl) {
      const cards = [...colEl.querySelectorAll('[data-ag-card]')].filter(c => c.getAttribute('data-ag-card') !== d.id)
      overIdx = cards.findIndex(c => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2 })
      if (overIdx < 0) overIdx = cards.length
    }
    setDrag({ id: d.id, x: e.clientX - d.offX, y: e.clientY - d.offY, overCol, overIdx })
  }
  const onHandleUp = () => {
    const d = dragRef.current
    dragRef.current = null
    const cur = drag
    setDrag(null)
    if (d?.active && cur?.overCol != null) commitMove(d.id, cur.overCol, cur.overIdx)
  }
  const nudge = (job, colId, dir) => {
    const ids = columns.find(c => c.id === colId)?.jobs.map(j => j.id) || []
    const pos = ids.indexOf(job.id)
    commitMove(job.id, colId, Math.max(0, pos + dir))
  }

  // ── Job actions ─────────────────────────────────────────
  const setStatus = async (job, status) => {
    if (status === job.status) return
    try {
      if (status === 'completed') {
        let reason = null
        if (!job.photo_end_url) {
          reason = await askConfirm({
            title: tr('Finish without After photo?', 'After写真なしで完了しますか？', 'Concluir sem foto After?'),
            message: tr('The job is finished and counts for salary and billing. It stays "waiting for After photo" until the photo is sent.',
              '作業は完了扱いで給与・請求に入ります。写真が届くまで「After写真待ち」になります。',
              'O job fica concluído (conta no salário e no faturamento) e aparece como "aguardando foto After" até a foto chegar.'),
            reason: tr('Reason (saved in the log)', '理由（ログに保存）', 'Motivo (fica no log)'), reasonRequired: false,
            confirmLabel: tr('Finish', '完了', 'Concluir'),
          })
          if (!reason) return
        }
        await adminCompleteJob(job, { reason: typeof reason === 'string' ? reason : null })
        toast.success(tr('Job finished · report created', '完了・報告書を作成', 'Job concluído · report criado'))
      } else if (job.status === 'completed') {
        const reason = await askConfirm({
          title: tr('Reopen this job?', 'この作業を戻しますか？', 'Reabrir este job?'),
          message: tr('Its service report is removed and it leaves salary and billing until finished again.', '報告書は削除され、再完了まで給与・請求から外れます。', 'O service report sai e o job deixa de contar no salário e no faturamento até ser concluído de novo.'),
          reason: true, confirmLabel: tr('Reopen', '戻す', 'Reabrir'),
        })
        if (!reason) return
        await adminReopenJob(job, { reason })
        if (status !== 'assigned' && status !== 'in_progress') {
          const { error } = await supabase.from('jobs').update({ status }).eq('id', job.id)
          if (error) throw error
        }
        toast.success(tr('Saved', '保存しました', 'Salvo'))
      } else {
        const { error } = await supabase.from('jobs').update({ status }).eq('id', job.id)
        if (error) throw error
        toast.success(tr('Saved', '保存しました', 'Salvo'))
      }
    } catch (err) { toast.error(err.message) }
    refresh()
  }

  const saveChecklist = async (job, rows) => {
    const { error } = await supabase.from('jobs').update(checklistUpdate(rows)).eq('id', job.id)
    if (error) return toast.error(error.message)
    refresh()
  }

  const setTime = async (job, time) => {
    const { error } = await supabase.from('jobs').update({ scheduled_time: time || null }).eq('id', job.id)
    if (error) toast.error(error.message)
    refresh()
  }

  const deleteJob = job => confirmAndRun({
    title: tr('Delete job?', '作業を削除しますか？', 'Excluir job?'),
    message: `${locationNameFromTitle(job.title)} · ${job.scheduled_date} ${job.scheduled_time || ''}`,
    success: tr('Job deleted', '削除しました', 'Job excluído'),
    run: () => supabase.from('jobs').delete().eq('id', job.id),
  }).then(ok => ok && refresh())

  const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString(localeOf(lang), { weekday: 'long', day: 'numeric', month: 'long' })
  const today = tokyoToday()
  const togglePerson = id => setPeople(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div>
      <div className="ag-top">
        <div className="ag-date-label">{dateLabel}{date === today && <span className="badge badge-blue" style={{ marginLeft: 8 }}>{tr('Today', '今日', 'Hoje')}</span>}</div>
        <button type="button" className="btn btn-sm" onClick={() => setDate(shiftDate(date, -1))} aria-label={tr('Previous day', '前日', 'Dia anterior')}>◀</button>
        <input type="date" className="ag-input" value={date} onChange={e => e.target.value && setDate(e.target.value)} aria-label={tr('Day', '日付', 'Dia')} />
        <button type="button" className="btn btn-sm" onClick={() => setDate(shiftDate(date, 1))} aria-label={tr('Next day', '翌日', 'Próximo dia')}>▶</button>
        {date !== today && <button type="button" className="btn btn-sm btn-primary" onClick={() => setDate(today)}>{tr('Today', '今日', 'Hoje')}</button>}
        <button type="button" className="btn btn-sm" onClick={() => setShowSettings(s => !s)} title={tr('Alert settings', 'アラート設定', 'Configurar alertas')}>⚙️</button>
      </div>

      {showSettings && <SettingsPanel settings={settings} onSaved={s => { setSettings(s); setShowSettings(false) }} />}

      {personChips.length > 0 && (
        <div className="ag-people" role="group" aria-label={tr('Filter by person', '担当者で絞り込み', 'Filtrar por pessoa')}>
          <button type="button" className={people.size === 0 ? 'on' : ''} onClick={() => setPeople(new Set())}>{tr('Everyone', '全員', 'Todos')}</button>
          {personChips.map(p => <button key={p.id || 'none'} type="button" className={people.has(p.id) ? 'on' : ''} onClick={() => togglePerson(p.id)}>{p.name}</button>)}
        </div>
      )}

      <div className="ag-summary">
        <div><b>{counts.done}/{counts.total}</b><span>{tr('done', '完了', 'feitos')}</span></div>
        <div><b>{counts.running}</b><span>{tr('in progress', '作業中', 'em andamento')}</span></div>
        <FlagTile n={counts.late} on={onlyFlag === 'late'} color="#ef4444" label={tr('late', '遅れ', 'atrasados')} onClick={() => setOnlyFlag(f => f === 'late' ? '' : 'late')} />
        <FlagTile n={counts.overtime} on={onlyFlag === 'overtime'} color="#f97316" label={tr('over planned time', '予定時間超過', 'passaram do tempo')} onClick={() => setOnlyFlag(f => f === 'overtime' ? '' : 'overtime')} />
        <FlagTile n={counts.after} on={onlyFlag === 'after'} color="#a855f7" label={tr('waiting After photo', 'After写真待ち', 'aguardando foto After')} onClick={() => setOnlyFlag(f => f === 'after' ? '' : 'after')} />
      </div>

      <AiQueue date={date} refreshKey={refreshKey} onGraded={refresh} />

      {loadError && <div className="card" style={{ color: 'var(--red)', marginBottom: 12 }}>{loadError} <button type="button" className="btn btn-sm" onClick={() => loadDay()}>{tr('Try again', '再試行', 'Tentar de novo')}</button></div>}
      {loading && !jobs.length && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{tr('Loading…', '読み込み中…', 'Carregando…')}</div>}
      {!loading && !columns.length && <div className="card"><div className="ag-empty">{onlyFlag ? tr('Nothing here.', '該当なし', 'Nada aqui.') : tr('No jobs on this day.', 'この日の作業はありません。', 'Nenhum job neste dia.')}</div></div>}

      <div className="ag-board" onPointerMove={onHandleMove} onPointerUp={onHandleUp} onPointerCancel={onHandleUp}>
        {columns.map(col => {
          const done = col.jobs.filter(j => j.status === 'completed').length
          const planned = col.jobs.reduce((s, j) => s + (info[j.id]?.expected || 0), 0)
          return (
            <div key={col.id || 'none'} className={`ag-col${drag?.overCol === col.id ? ' ag-drop' : ''}`} data-ag-col={col.id}>
              <div className="ag-col-head">
                <b>{col.name || tr('No one assigned', '未割当', 'Sem pessoa')}</b>
                <span>{done}/{col.jobs.length} · ⏱ {fmtMin(planned)}</span>
              </div>
              {isManualOrder(col.jobs) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text3)', margin: '-4px 4px 8px' }}>
                  <span>✋ {tr('Manual order', '手動の順番', 'Ordem manual')}</span>
                  <button type="button" className="btn btn-sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => resetToClock(col)}>↺ {tr('Clock order', '時刻順', 'Pelo horário')}</button>
                </div>
              )}
              {col.jobs.map((job, idx) => (
                <div key={job.id}>
                  {drag && drag.overCol === col.id && drag.overIdx === idx && drag.id !== job.id && <div className="ag-slot on" />}
                  <AgendaCard
                    job={job} idx={idx} count={col.jobs.length} colId={col.id} info={info[job.id] || {}} lang={lang} tr={tr}
                    dragging={drag?.id === job.id} employees={employees}
                    onHandleDown={onHandleDown} onNudge={nudge}
                    onStatus={setStatus} onChecklist={saveChecklist} onTime={setTime} onDelete={deleteJob}
                    onEdit={onEditJob} onPhoto={setLightbox} onSaved={refresh} settings={settings}
                  />
                </div>
              ))}
              {drag && drag.overCol === col.id && drag.overIdx >= col.jobs.filter(j => j.id !== drag.id).length && <div className="ag-slot on" />}
              {!col.jobs.length && <div className="ag-empty">{tr('Drop a job here', 'ここにドロップ', 'Solte um job aqui')}</div>}
            </div>
          )
        })}
      </div>
      {drag && jobsById[drag.id] && (
        <div className="ag-card ag-ghost" style={{ left: drag.x, top: drag.y }}>
          <div className="ag-title">{locationNameFromTitle(jobsById[drag.id].title)}</div>
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <ProgressChart anchorDate={date} settings={settings} refreshKey={refreshKey} />
      </div>
      <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} closeLabel={tr('Close', '閉じる', 'Fechar')} />
    </div>
  )
}

function FlagTile({ n, on, color, label, onClick }) {
  return (
    <button type="button" onClick={onClick} disabled={!n && !on}
      style={{ textAlign: 'left', cursor: n || on ? 'pointer' : 'default', background: on ? `${color}18` : 'var(--surface)', border: `1px solid ${on ? color : 'var(--border)'}`, borderRadius: 12, padding: '10px 12px', color: 'var(--text)', font: 'inherit' }}>
      <b style={{ display: 'block', fontSize: 20, color: n ? color : 'var(--text)' }}>{n}</b>
      <span style={{ fontSize: 12, color: 'var(--text3)' }}>{label}</span>
    </button>
  )
}

function deepTasksText(title, lang) {
  return (parseDeepTaskList(title) || []).map(l => {
    const t = DEEP_TASKS.find(x => x.label.toLowerCase() === l.toLowerCase())
    return t ? deepTaskName(t, lang) : l
  }).join(', ')
}

function AgendaCard({ job, idx, count, colId, info, lang, tr, dragging, onHandleDown, onNudge, onStatus, onChecklist, onTime, onDelete, onEdit, onPhoto, onSaved, settings }) {
  const [open, setOpen] = useState(false)
  const [adjust, setAdjust] = useState(false)
  const [log, setLog] = useState(null)
  const deep = getCleaningType(job) === 'deep'
  const loc = locationNameFromTitle(job.title)
  const t = info.time || {}
  const p = info.progress || { total: 0, done: 0, items: [] }
  const alert = t.state === 'overrun' || t.state === 'cap'
  const missed = isMissedJob(job)
  const after = awaitingAfterPhoto(job)
  const keyBox = info.place?.key_box || (job.description || '').split('\n')[0]
  const statusLabel = {
    assigned: tr('To do', '未着手', 'A fazer'), in_progress: tr('In progress', '作業中', 'Em andamento'),
    completed: tr('Done', '完了', 'Concluído'), cancelled: tr('Cancelled', 'キャンセル', 'Cancelado'),
  }
  const issues = aiIssueRows(job.photo_ai_issues)
  const toggleItem = i => onChecklist(job, p.items.map((r, k) => k === i ? { ...r, done: !r.done } : r))
  const showLog = async () => { setLog(await loadJobLog(job.id) ?? 'missing') }

  return (
    <div className={`ag-card${dragging ? ' ag-dragging' : ''}${alert ? ' ag-alert' : ''}`} data-ag-card={job.id}
      style={{ '--ag-c': deep ? '#b7791f' : STATUS_COLOR[job.status] || '#60a5fa' }}>
      <div className="ag-row">
        <button type="button" className="ag-handle" title={tr('Drag to change the order', 'ドラッグで順番を変更', 'Arraste para mudar a ordem')}
          aria-label={`${idx + 1}`} onPointerDown={e => onHandleDown(e, job, colId)}>{idx + 1}</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ag-title">{loc}</div>
          <div className="ag-meta">
            {info.client && <>🏢 {info.client} · </>}
            🕐 <input type="time" value={job.scheduled_time || ''} onChange={e => onTime(job, e.target.value)}
              style={{ border: 'none', background: 'transparent', color: 'inherit', font: 'inherit', padding: 0, width: 96 }} aria-label={tr('Time', '時刻', 'Horário')} />
            · ⏱ {fmtMin(info.expected)} {tr('planned', '予定', 'previsto')}
          </div>
          {job.started_at && (
            <div className="ag-meta" style={{ fontWeight: 700, color: alert ? '#ef4444' : 'var(--text)' }}>
              ▶ {hm(job.started_at)}{job.completed_at ? ` → ${hm(job.completed_at)}` : ''} · {fmtMin(t.elapsed)}
              {t.state === 'overrun' && ` · ⚠️ +${fmtMin(t.over)} ${tr('over', '超過', 'acima')}`}
              {t.state === 'cap' && ` · ⛔ ${tr('ceiling reached — count paused', '上限到達 — 計測停止', 'teto atingido — contagem pausada')}`}
            </div>
          )}
          <div className="ag-badges">
            <span className="ag-badge" style={{ color: STATUS_COLOR[job.status] }}>{missed ? tr('Not done', '未実施', 'Não feito') : statusLabel[job.status] || job.status}</span>
            <span className="ag-badge" style={{ color: deep ? '#b7791f' : '#64748b' }}>{deep ? 'Deep Cleaning' : 'Basic'}</span>
            {info.bucket === 'late' && !missed && <span className="ag-badge" style={{ color: '#ef4444' }}>{tr('Late', '遅れ', 'Atrasado')}</span>}
            {after && <span className="ag-badge" style={{ color: '#a855f7' }}>📷 {tr('Waiting After photo', 'After写真待ち', 'Aguardando foto After')}</span>}
            {job.photo_ai_score != null && <span className="ag-badge" style={{ color: job.photo_ai_approved ? '#16a34a' : '#ef4444' }}>IA {job.photo_ai_score}/10</span>}
            {aiPending(job) && <span className="ag-badge" style={{ color: '#64748b' }}>IA …</span>}
          </div>
          {deep && deepTasksText(job.title, lang) && <div className="ag-meta" style={{ color: '#b7791f', fontWeight: 700 }}>✨ {deepTasksText(job.title, lang)}</div>}
          {keyBox && <div className="ag-key">🔑 {keyBox}</div>}
        </div>
        <div className="ag-move">
          <button type="button" disabled={idx === 0} onClick={() => onNudge(job, colId, -1)} aria-label={tr('Move up', '上へ', 'Subir')}>▲</button>
          <button type="button" disabled={idx === count - 1} onClick={() => onNudge(job, colId, 1)} aria-label={tr('Move down', '下へ', 'Descer')}>▼</button>
        </div>
      </div>

      {p.total > 0 && (
        <div className="ag-progress">
          <div className="ag-progress-line">
            <span>✅ {tr(`${p.done} of ${p.total}`, `${p.total}中${p.done}`, `${p.done} de ${p.total}`)}</span>
            <button type="button" onClick={() => setOpen(o => !o)}>{open ? tr('Hide checklist', 'チェックリストを閉じる', 'Fechar checklist') : tr('Checklist', 'チェックリスト', 'Checklist')}</button>
          </div>
          <div className="ag-progress-bar"><i style={{ width: `${Math.round((p.done / p.total) * 100)}%` }} /></div>
          {open && (
            <div style={{ marginTop: 6 }}>
              {p.items.map((r, i) => (
                <label key={i} className="ag-check">
                  <input type="checkbox" checked={r.done} onChange={() => toggleItem(i)} />
                  <span style={{ textDecoration: r.done ? 'line-through' : 'none', color: r.done ? 'var(--text3)' : 'var(--text)' }}>{checklistDisplayLabel(r.label, lang)}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      {p.total === 0 && <div className="ag-meta" style={{ marginTop: 6 }}>{tr('No checklist in the contract for this place.', 'この場所の契約にチェックリストがありません。', 'Sem checklist no contrato deste local.')}</div>}

      {(job.photo_ai_score != null && (issues.length || !job.photo_ai_approved)) && (
        <div className="ag-ai" style={{ background: job.photo_ai_approved ? 'rgba(34,197,94,.08)' : 'rgba(239,68,68,.08)' }}>
          <b>IA {job.photo_ai_score}/10 {job.photo_ai_approved ? '✅' : '⚠️'}</b>
          {issues.length > 0 && <ul>{issues.map((r, i) => <li key={i}>{r.issue}{r.fix && <> — <b>{tr('fix', '直す', 'corrigir')}:</b> {r.fix}</>}</li>)}</ul>}
        </div>
      )}

      {(job.photo_start_url || job.photo_end_url) && (
        <div style={{ marginTop: 8 }}>
          <JobPhotos photoStartUrl={job.photo_start_url} photoEndUrl={job.photo_end_url} beforeLabel="Before" afterLabel="After" variant="compact" onPhotoClick={onPhoto} />
        </div>
      )}

      <div className="ag-actions">
        <select className="ag-select" style={{ minHeight: 30, padding: '4px 8px', fontSize: 12 }} value={job.status} onChange={e => onStatus(job, e.target.value)} aria-label={tr('Status', 'ステータス', 'Status')}>
          {['assigned', 'in_progress', 'completed', 'cancelled'].map(s => <option key={s} value={s}>{statusLabel[s]}</option>)}
        </select>
        {(job.started_at || job.status === 'completed') && <button type="button" className="btn btn-sm" onClick={() => setAdjust(a => !a)}>⏱ {tr('Adjust time', '時間を調整', 'Ajustar tempo')}</button>}
        {onEdit && <button type="button" className="btn btn-sm" onClick={() => onEdit(job)}>✏️</button>}
        <button type="button" className="btn btn-sm" onClick={showLog} title={tr('Change log', '変更履歴', 'Histórico')}>🕘</button>
        <button type="button" className="btn btn-sm btn-danger" onClick={() => onDelete(job)} aria-label={tr('Delete', '削除', 'Excluir')}>🗑</button>
      </div>
      {adjust && <AdjustTime job={job} tr={tr} onDone={() => { setAdjust(false); onSaved() }} expected={info.expected} settings={settings} />}
      {log && (
        <div className="ag-meta" style={{ marginTop: 8, background: 'var(--surface2)', borderRadius: 8, padding: 8 }}>
          {log === 'missing'
            ? tr('The change log starts after the database update (SQL) is applied.', 'DB更新（SQL）適用後に履歴が保存されます。', 'O histórico começa depois que o SQL do banco for aplicado.')
            : log.length === 0 ? tr('No changes yet.', '変更なし', 'Sem alterações ainda.')
              : log.map(l => <div key={l.id}>• {new Date(l.created_at).toLocaleString(localeOf(lang), { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' })} · {l.admin_name} · {l.action}{l.reason ? ` — “${l.reason}”` : ''}</div>)}
          <button type="button" className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => setLog(null)}>✕</button>
        </div>
      )}
    </div>
  )
}

function AdjustTime({ job, tr, onDone, expected, settings }) {
  const [start, setStart] = useState(toLocalInput(job.started_at))
  const [end, setEnd] = useState(toLocalInput(job.completed_at))
  const [reason, setReason] = useState('')
  const [err, setErr] = useState({})
  const [saving, setSaving] = useState(false)
  const capMin = Math.round((expected || 0) * Number(settings?.cap_factor || 2))
  const save = async () => {
    const e = {}
    if (!reason.trim()) e.reason = tr('Write the reason.', '理由を入力してください。', 'Escreva o motivo.')
    if (start && end && new Date(fromLocalInput(end)) <= new Date(fromLocalInput(start))) e.end = tr('Finish must be after start.', '終了は開始より後にしてください。', 'O fim precisa ser depois do início.')
    setErr(e)
    if (Object.keys(e).length) return
    setSaving(true)
    try {
      await adjustJobTime(job, { startedAt: fromLocalInput(start), completedAt: job.completed_at || end ? fromLocalInput(end) : undefined, reason })
      toast.success(tr('Time adjusted · saved in the log', '時間を調整し、履歴に保存しました', 'Tempo ajustado · registrado no log'))
      onDone()
    } catch (ex) {
      if (ex.message === 'nolog') toast.error(tr('Adjusting needs the log table (database update pending).', '調整には履歴テーブルが必要です（DB更新待ち）。', 'Ajustar precisa da tabela de log (SQL do banco pendente).'))
      else toast.error(ex.message)
    }
    setSaving(false)
  }
  const useCap = () => {
    if (!job.started_at || !capMin) return
    setEnd(toLocalInput(new Date(new Date(job.started_at).getTime() + capMin * 60000).toISOString()))
    if (!reason) setReason(tr('Automatic ceiling', '自動上限', 'Teto automático'))
  }
  return (
    <div style={{ marginTop: 8, background: 'var(--surface2)', borderRadius: 10, padding: 10 }}>
      <div className="ag-form-grid">
        <label className="ag-meta">{tr('Start', '開始', 'Início')}<input type="datetime-local" className="ag-input" style={{ width: '100%' }} value={start} onChange={e => setStart(e.target.value)} /></label>
        <label className="ag-meta">{tr('Finish', '終了', 'Fim')}<input type="datetime-local" className={`ag-input${err.end ? ' ag-invalid' : ''}`} style={{ width: '100%' }} value={end} onChange={e => setEnd(e.target.value)} />
          {err.end && <div className="ag-field-error">{err.end}</div>}</label>
      </div>
      <label className="ag-meta" style={{ display: 'block', marginTop: 8 }}>{tr('Reason', '理由', 'Motivo')} *
        <input className={`ag-input${err.reason ? ' ag-invalid' : ''}`} style={{ width: '100%' }} value={reason} onChange={e => setReason(e.target.value)} />
        {err.reason && <div className="ag-field-error">{err.reason}</div>}
      </label>
      <div className="ag-actions">
        <button type="button" className="btn btn-sm btn-primary" disabled={saving} onClick={save}>{tr('Save', '保存', 'Salvar')}</button>
        {capMin > 0 && job.started_at && <button type="button" className="btn btn-sm" onClick={useCap}>{tr(`End at ceiling (${fmtMin(capMin)})`, `上限で終了（${fmtMin(capMin)}）`, `Fim no teto (${fmtMin(capMin)})`)}</button>}
      </div>
    </div>
  )
}

function SettingsPanel({ settings, onSaved }) {
  const { tr } = useLang()
  const [tol, setTol] = useState(settings.tolerance_min)
  const [cap, setCap] = useState(settings.cap_factor)
  const save = async () => {
    const { value, savedInDb } = await saveAgendaSettings({ tolerance_min: tol, cap_factor: cap })
    toast.success(savedInDb ? tr('Saved', '保存しました', 'Salvo') : tr('Saved on this device (database update pending)', 'この端末に保存（DB更新待ち）', 'Salvo neste aparelho (SQL do banco pendente)'))
    onSaved({ ...settings, ...value })
  }
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>{tr('Time alerts', '時間アラート', 'Alertas de tempo')}</div>
      <div className="ag-form-grid">
        <label className="ag-meta">{tr('Tolerance after planned time (min)', '予定時間後の許容（分）', 'Tolerância depois do previsto (min)')}
          <input type="number" min="0" className="ag-input" style={{ width: '100%' }} value={tol} onChange={e => setTol(e.target.value)} /></label>
        <label className="ag-meta">{tr('Automatic ceiling (× planned)', '自動上限（予定の×倍）', 'Teto automático (× o previsto)')}
          <input type="number" min="1" step="0.5" className="ag-input" style={{ width: '100%' }} value={cap} onChange={e => setCap(e.target.value)} /></label>
      </div>
      <div className="ag-actions"><button type="button" className="btn btn-sm btn-primary" onClick={save}>{tr('Save', '保存', 'Salvar')}</button></div>
    </div>
  )
}

/** Visible queue of After photos still waiting for the AI grade (last 7 days), with retry. */
function AiQueue({ date, refreshKey, onGraded }) {
  const { tr } = useLang()
  const [list, setList] = useState([])
  const [state, setState] = useState({})
  const [open, setOpen] = useState(false)
  useEffect(() => {
    supabase.from('jobs').select('id,title,employee_name,scheduled_date,status,photo_end_url,photo_ai_score')
      .eq('status', 'completed').not('photo_end_url', 'is', null).is('photo_ai_score', null)
      .gte('scheduled_date', shiftDate(date, -7)).lte('scheduled_date', date)
      .order('scheduled_date', { ascending: false })
      .then(({ data }) => setList(data || []))
  }, [date, refreshKey])
  if (!list.length) return null
  const run = async job => {
    setState(s => ({ ...s, [job.id]: 'running' }))
    try {
      await gradeJobPhoto(job)
      setState(s => ({ ...s, [job.id]: 'ok' }))
      setList(l => l.filter(j => j.id !== job.id))
      onGraded?.()
    } catch (err) {
      setState(s => ({ ...s, [job.id]: err.message === 'timeout' ? 'timeout' : `error:${err.message}` }))
    }
  }
  const runAll = async () => { for (const j of list) await run(j) }
  const label = st => !st ? '' : st === 'running' ? tr('analysing…', '分析中…', 'analisando…') : st === 'timeout' ? tr('took too long — try again', '時間切れ — 再試行', 'demorou demais — tente de novo') : st.startsWith('error:') ? st.slice(6) : ''
  return (
    <div className="ag-queue">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 13 }}>🤖 {tr(`${list.length} photo(s) waiting for the AI grade`, `AI評価待ちの写真 ${list.length}件`, `${list.length} foto(s) aguardando análise da IA`)}</b>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn btn-sm" onClick={() => setOpen(o => !o)}>{open ? '▲' : '▼'}</button>
          <button type="button" className="btn btn-sm btn-primary" onClick={runAll}>{tr('Analyse all', 'すべて分析', 'Analisar todas')}</button>
        </div>
      </div>
      {open && list.map(j => (
        <div key={j.id} className="ag-queue-row">
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{locationNameFromTitle(j.title)} · {j.employee_name} · {j.scheduled_date.slice(5)}</span>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            <small style={{ color: state[j.id]?.startsWith?.('error') || state[j.id] === 'timeout' ? 'var(--red)' : 'var(--text3)' }}>{label(state[j.id])}</small>
            <button type="button" className="btn btn-sm" disabled={state[j.id] === 'running'} onClick={() => run(j)}>{state[j.id] && state[j.id] !== 'running' ? '↻' : tr('Analyse', '分析', 'Analisar')}</button>
          </span>
        </div>
      ))}
    </div>
  )
}
