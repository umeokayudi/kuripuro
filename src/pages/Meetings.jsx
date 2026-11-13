// v1.0.231 · Reuniões (admin). Meetings happen on Google Meet: the admin imports the notes document
// Meet writes (with who spoke), or uploads an audio file as a fallback. The AI splits the content
// into topics, proposes decisions and next steps; the admin confirms. Rules: src/lib/meetings.js.
//   /meetings        list, searchable history, new meeting
//   /meetings/:id    Preparação (pauta, convidados) · Reunião (presença, conteúdo, anotações) · Resultado
import MeetingRecorder from '../components/MeetingRecorder'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import {
  audioPending, fmtClock, groupByTopic, linesOf, matchPerson, newId, openTasks, searchRows, speakersOf,
} from '../lib/meetings'
import {
  analyzeMeeting, audioUrl, clearContent, createMeeting, deleteMeeting, getMeeting, importMeetFile, importMeetText,
  listMeetings, listPeople, saveMeeting, transcribePart, updateTask, uploadAndTranscribe,
} from '../lib/meetingsApi'
import './meetings.css'

const TZ = 'Asia/Tokyo'
const ROLE_GROUP = { admin: 0, employee: 1, salesperson: 2 }

function useT() {
  const { tr, lang } = useLang()
  return { T: (pt, en, ja) => tr(en, ja ?? en, pt), lang }
}

const locale = lang => (lang === 'ja' ? 'ja-JP' : lang === 'en' ? 'en-GB' : 'pt-BR')
const fmtDay = (iso, lang) => iso ? new Date(iso).toLocaleDateString(locale(lang), { timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : ''
const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString('ja-JP', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : ''
const fmtDue = (d, lang) => d ? new Date(`${d}T00:00:00+09:00`).toLocaleDateString(locale(lang), { timeZone: TZ, day: '2-digit', month: 'short' }) : ''
const todayTokyo = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)
/** ISO → value for <input type="datetime-local"> in Tokyo time */
const toLocalInput = iso => iso ? new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 16) : ''
const fromLocalInput = v => v ? new Date(`${v}:00+09:00`).toISOString() : ''

export default function Meetings() {
  const { id } = useParams()
  return id ? <MeetingDetail id={id} /> : <MeetingList />
}

/* ─────────────────────────────── List ─────────────────────────────── */

function MeetingList() {
  const { T, lang } = useT()
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [when, setWhen] = useState('all')
  const [series, setSeries] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    listMeetings().then(setRows).catch(e => { setError(e.message); setRows([]) })
  }, [])

  const seriesList = useMemo(() => [...new Set((rows || []).map(r => r.series).filter(Boolean))].sort(), [rows])
  const now = Date.now()
  const shown = useMemo(() => {
    let list = searchRows(rows || [], q)
    if (series) list = list.filter(r => r.series === series)
    const up = list.filter(r => Date.parse(r.starts_at) >= now - 3 * 3600e3 && r.status !== 'done').sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    const past = list.filter(r => !up.includes(r)).sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at))
    return { up: when === 'past' ? [] : up, past: when === 'up' ? [] : past }
  }, [rows, q, series, when]) // eslint-disable-line react-hooks/exhaustive-deps

  const openTotal = (rows || []).reduce((s, r) => s + (r.open_tasks || 0), 0)

  return (
    <div className="mt-page">
      <div className="mt-head">
        <div>
          <h2>{T('Reuniões', 'Meetings', '会議')}</h2>
          <p>{T('Pauta, presença, anotações do Google Meet, decisões e próximos passos.', 'Agenda, attendance, Google Meet notes, decisions and next steps.', '議題・出欠・Google Meetのメモ・決定事項・次のアクション')}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>{T('Nova reunião', 'New meeting', '新しい会議')}</button>
      </div>

      <div className="mt-toolbar">
        <input className="mt-input mt-search" type="search" value={q} onChange={e => setQ(e.target.value)}
          placeholder={T('Buscar em títulos, pautas, falas, decisões e tarefas', 'Search titles, agendas, transcripts, decisions, tasks', 'タイトル・議題・発言・決定事項を検索')} />
        <div className="mt-seg" role="tablist">
          {[['all', T('Todas', 'All', 'すべて')], ['up', T('Próximas', 'Upcoming', '予定')], ['past', T('Realizadas', 'Past', '過去')]].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={when === k} className={when === k ? 'on' : ''} onClick={() => setWhen(k)}>{label}</button>
          ))}
        </div>
        {seriesList.length > 0 && (
          <select className="mt-input mt-select" value={series} onChange={e => setSeries(e.target.value)}>
            <option value="">{T('Todos os grupos', 'All groups', 'すべてのグループ')}</option>
            {seriesList.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>

      {openTotal > 0 && !q && (
        <div className="mt-strip">{T(`${openTotal} próximos passos em aberto no histórico`, `${openTotal} open next steps across meetings`, `未完了のアクション ${openTotal}件`)}</div>
      )}

      {error && <div className="mt-error">{error}</div>}
      {rows === null ? <div className="mt-empty">{T('Carregando…', 'Loading…', '読み込み中…')}</div> : (
        <>
          {shown.up.length > 0 && <MeetingRows title={T('Próximas', 'Upcoming', '予定')} rows={shown.up} lang={lang} T={T} />}
          {shown.past.length > 0 && <MeetingRows title={T('Realizadas', 'Past', '過去')} rows={shown.past} lang={lang} T={T} />}
          {!shown.up.length && !shown.past.length && (
            <div className="mt-empty">
              <strong>{q ? T('Nada encontrado', 'Nothing found', '見つかりません') : T('Nenhuma reunião ainda', 'No meetings yet', '会議はまだありません')}</strong>
              {!q && T('Crie a primeira reunião com pauta e convidados. Depois do Meet, importe as anotações aqui.', 'Create the first meeting. After the Meet call, import its notes here.', '最初の会議を作成し、Meet後にメモを取り込みます。')}
            </div>
          )}
        </>
      )}

      {creating && <NewMeetingSheet T={T} seriesList={seriesList} onClose={() => setCreating(false)}
        onCreated={m => { setCreating(false); navigate(`/meetings/${m.id}`) }} />}
    </div>
  )
}

function MeetingRows({ title, rows, lang, T }) {
  return (
    <section className="mt-section">
      <div className="mt-section-title">{title} <span>{rows.length}</span></div>
      <div className="mt-list">
        {rows.map(r => {
          const d = r.starts_at ? new Date(r.starts_at) : null
          return (
            <Link key={r.id} to={`/meetings/${r.id}`} className="mt-row">
              <div className="mt-date">
                <b>{d ? d.toLocaleDateString('ja-JP', { timeZone: TZ, day: 'numeric' }).replace(/日$/, '') : '—'}</b>
                <span>{d ? d.toLocaleDateString(locale(lang), { timeZone: TZ, month: 'short' }) : ''}</span>
              </div>
              <div className="mt-row-main">
                <div className="mt-row-title">{r.title || T('Sem título', 'Untitled', '無題')}</div>
                <div className="mt-row-meta">
                  <span>{fmtDay(r.starts_at, lang)} · {fmtTime(r.starts_at)}</span>
                  {r.series && <span className="mt-tag">{r.series}</span>}
                </div>
                <div className="mt-row-facts">
                  <span>{r.status === 'done' || r.present ? T(`${r.present}/${r.invited} presentes`, `${r.present}/${r.invited} present`, `出席 ${r.present}/${r.invited}`) : T(`${r.invited} convidados`, `${r.invited} invited`, `招待 ${r.invited}`)}</span>
                  {r.has_content && <span>{r.source === 'audio' ? T('Transcrição de áudio', 'Audio transcript', '音声文字起こし') : T('Anotações do Meet', 'Meet notes', 'Meetメモ')}</span>}
                  {r.tasks > 0 && <span className={r.open_tasks ? 'warn' : ''}>{r.open_tasks ? T(`${r.open_tasks} de ${r.tasks} tarefas em aberto`, `${r.open_tasks} of ${r.tasks} tasks open`, `未完了 ${r.open_tasks}/${r.tasks}`) : T('Tarefas concluídas', 'Tasks done', 'タスク完了')}</span>}
                </div>
              </div>
              <span className={`mt-status ${r.status === 'done' ? 'done' : ''}`}>{r.status === 'done' ? T('Concluída', 'Done', '完了') : T('Planejada', 'Planned', '予定')}</span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

/* ─────────────────────── People picker (invited) ─────────────────────── */

function PeoplePicker({ T, people, value, onChange }) {
  const [q, setQ] = useState('')
  const picked = new Set(value.map(p => p.key))
  const groups = [
    ['admin', T('Escritório', 'Office', '事務所')],
    ['employee', T('Equipe de limpeza', 'Cleaning team', '清掃チーム')],
    ['salesperson', T('Vendas', 'Sales', '営業')],
  ]
  const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const list = people.filter(p => !q || fold(p.name).includes(fold(q)))
  const toggle = p => onChange(picked.has(p.key) ? value.filter(x => x.key !== p.key) : [...value, { key: p.key, name: p.name, role: p.role }])
  const addGroup = role => {
    const add = people.filter(p => p.role === role && !picked.has(p.key)).map(p => ({ key: p.key, name: p.name, role: p.role }))
    onChange([...value, ...add])
  }
  return (
    <div className="mt-picker">
      <div className="mt-picker-top">
        <input className="mt-input" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={T('Buscar pessoa', 'Search person', '人を検索')} />
        <span className="mt-muted">{T(`${value.length} convidados`, `${value.length} invited`, `${value.length}人`)}</span>
      </div>
      <div className="mt-picker-quick">
        {groups.map(([role, label]) => people.some(p => p.role === role) && (
          <button key={role} type="button" className="btn btn-sm" onClick={() => addGroup(role)}>{T('Todos', 'All', '全員')}: {label}</button>
        ))}
        {value.length > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange([])}>{T('Limpar', 'Clear', 'クリア')}</button>}
      </div>
      <div className="mt-picker-list">
        {groups.map(([role, label]) => {
          const items = list.filter(p => p.role === role)
          if (!items.length) return null
          return (
            <div key={role}>
              <div className="mt-picker-group">{label}</div>
              {items.map(p => (
                <label key={p.key} className={`mt-person ${picked.has(p.key) ? 'on' : ''}`}>
                  <input type="checkbox" checked={picked.has(p.key)} onChange={() => toggle(p)} />
                  <span className="mt-avatar">{initials(p.name)}</span>
                  <span className="mt-person-name">{p.name}{p.job_role ? <small>{p.job_role}</small> : null}</span>
                </label>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Text that grows with its content (decisions and tasks read whole, on the phone too). */
function AutoText({ value, onChange }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [value])
  return <textarea ref={ref} className="mt-inline" rows={1} value={value} onChange={onChange} />
}
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()

/* ─────────────────────────── New meeting ─────────────────────────── */

function NewMeetingSheet({ T, seriesList, onClose, onCreated }) {
  const [people, setPeople] = useState([])
  const [busy, setBusy] = useState(false)
  const nextHour = () => { const d = new Date(Date.now() + 9 * 3600e3 + 3600e3); d.setUTCMinutes(0, 0, 0); return d.toISOString().slice(0, 16) }
  const [f, setF] = useState({ title: '', series: '', starts_at: nextHour(), meet_url: '', agenda: '', invited: [] })
  useEffect(() => { listPeople().then(setPeople).catch(e => toast.error(e.message)) }, [])
  const set = patch => setF(x => ({ ...x, ...patch }))
  const submit = async e => {
    e.preventDefault()
    if (!f.title.trim()) return toast.error(T('Dê um título para a reunião.', 'Give the meeting a title.', 'タイトルを入力してください'))
    setBusy(true)
    try {
      const r = await createMeeting({ ...f, starts_at: fromLocalInput(f.starts_at) })
      onCreated(r.meeting)
    } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  return (
    <Sheet onClose={onClose} title={T('Nova reunião', 'New meeting', '新しい会議')}>
      <form onSubmit={submit} className="mt-form">
        <Field label={T('Título', 'Title', 'タイトル')}>
          <input className="mt-input" value={f.title} onChange={e => set({ title: e.target.value })} autoFocus placeholder={T('Ex.: Reunião semanal da limpeza', 'e.g. Weekly cleaning meeting', '例：清掃週次ミーティング')} />
        </Field>
        <div className="mt-form-row">
          <Field label={T('Data e hora (Tóquio)', 'Date and time (Tokyo)', '日時（東京）')}>
            <input className="mt-input" type="datetime-local" value={f.starts_at} onChange={e => set({ starts_at: e.target.value })} />
          </Field>
          <Field label={T('Grupo', 'Group', 'グループ')} hint={T('Reuniões do mesmo grupo puxam as pendências da anterior.', 'Meetings in the same group carry over open tasks.', '同じグループの前回の未完了を引き継ぎます')}>
            <input className="mt-input" list="mt-series" value={f.series} onChange={e => set({ series: e.target.value })} placeholder={T('Ex.: Semanal limpeza', 'e.g. Weekly cleaning', '例：清掃週次')} />
            <datalist id="mt-series">{seriesList.map(s => <option key={s} value={s} />)}</datalist>
          </Field>
        </div>
        <Field label={T('Link do Google Meet (opcional)', 'Google Meet link (optional)', 'Google Meetリンク（任意）')}>
          <input className="mt-input" value={f.meet_url} onChange={e => set({ meet_url: e.target.value })} placeholder="https://meet.google.com/…" inputMode="url" />
        </Field>
        <Field label={T('Pauta', 'Agenda', '議題')}>
          <textarea className="mt-input" rows={4} value={f.agenda} onChange={e => set({ agenda: e.target.value })} placeholder={T('Um assunto por linha', 'One item per line', '1行に1項目')} />
        </Field>
        <Field label={T('Convidados', 'Invited', '招待者')}>
          <PeoplePicker T={T} people={people} value={f.invited} onChange={invited => set({ invited })} />
        </Field>
        <div className="mt-sheet-actions">
          <button type="button" className="btn" onClick={onClose}>{T('Cancelar', 'Cancel', 'キャンセル')}</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? T('Criando…', 'Creating…', '作成中…') : T('Criar reunião', 'Create meeting', '作成')}</button>
        </div>
      </form>
    </Sheet>
  )
}

function Field({ label, hint, children }) {
  return (
    <label className="mt-field">
      <span className="mt-label">{label}</span>
      {children}
      {hint && <span className="mt-hint">{hint}</span>}
    </label>
  )
}

function Sheet({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="mt-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`mt-sheet ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="mt-sheet-head">
          <h3>{title}</h3>
          <button className="mt-x" onClick={onClose} aria-label="Fechar">×</button>
        </div>
        <div className="mt-sheet-body">{children}</div>
      </div>
    </div>
  )
}

/* ─────────────────────────── Detail ─────────────────────────── */

function MeetingDetail({ id }) {
  const { T, lang } = useT()
  const navigate = useNavigate()
  const [m, setM] = useState(null)
  const [previous, setPrevious] = useState(null)
  const [people, setPeople] = useState([])
  const [tab, setTab] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const pending = useRef({})
  const timer = useRef(null)

  const load = useCallback(() => getMeeting(id).then(r => {
    setM(r.meeting); setPrevious(r.previous)
    setTab(t => t || (r.meeting.status === 'done' || r.meeting.topics?.length ? 'result' : linesOf(r.meeting).length || Date.parse(r.meeting.starts_at) <= Date.now() + 3600e3 ? 'meeting' : 'prep'))
  }).catch(e => setError(e.message)), [id])

  useEffect(() => { load(); listPeople().then(setPeople).catch(() => {}) }, [load])

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const patch = pending.current
    pending.current = {}
    if (!Object.keys(patch).length) return
    setSaving(true)
    try {
      const saved = await saveMeeting(id, patch)
      setM(cur => cur ? { ...cur, rev: saved.rev, updated_at: saved.updated_at } : saved)
    } catch (e) { toast.error(e.message) }
    setSaving(false)
  }, [id])

  useEffect(() => () => { clearTimeout(timer.current); if (Object.keys(pending.current).length) saveMeeting(id, pending.current).catch(() => {}) }, [id])

  /** Change some fields now on screen; saved to the server a moment later. */
  const update = useCallback((patch, { now = false } = {}) => {
    setM(cur => ({ ...cur, ...patch }))
    pending.current = { ...pending.current, ...patch }
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, now ? 0 : 700)
  }, [flush])

  /** Server result (import, transcription, AI) → screen, keeping what is still waiting to be saved. */
  const fromServer = useCallback(next => setM({ ...next, ...pending.current }), [])

  if (error) return <div className="mt-page"><Link to="/meetings" className="mt-back">‹ {T('Reuniões', 'Meetings', '会議')}</Link><div className="mt-error">{error}</div></div>
  if (!m) return <div className="mt-page"><div className="mt-empty">{T('Carregando…', 'Loading…', '読み込み中…')}</div></div>

  const present = Object.values(m.attendance || {}).filter(v => v === 'present').length
  const remove = async () => {
    if (!window.confirm(T('Excluir esta reunião, as anotações e os arquivos? Não dá para desfazer.', 'Delete this meeting and its files? This cannot be undone.', 'この会議とファイルを削除しますか？元に戻せません。'))) return
    try { await deleteMeeting(id); toast.success(T('Reunião excluída', 'Meeting deleted', '削除しました')); navigate('/meetings') } catch (e) { toast.error(e.message) }
  }

  return (
    <div className="mt-page">
      <Link to="/meetings" className="mt-back">‹ {T('Reuniões', 'Meetings', '会議')}</Link>
      <div className="mt-detail-head">
        <div className="mt-detail-title">
          <h2>{m.title}</h2>
          <div className="mt-row-meta">
            <span>{fmtDay(m.starts_at, lang)} · {fmtTime(m.starts_at)}</span>
            {m.series && <span className="mt-tag">{m.series}</span>}
            <span className={`mt-status ${m.status === 'done' ? 'done' : ''}`}>{m.status === 'done' ? T('Concluída', 'Done', '完了') : T('Planejada', 'Planned', '予定')}</span>
            <span className="mt-muted">{saving ? T('Salvando…', 'Saving…', '保存中…') : T('Salvo', 'Saved', '保存済み')}</span>
          </div>
        </div>
        <div className="mt-detail-actions">
          {m.meet_url && <a className="btn" href={m.meet_url} target="_blank" rel="noopener noreferrer">{T('Abrir no Meet', 'Open in Meet', 'Meetを開く')}</a>}
          <button className="btn" onClick={() => setEditing(true)}>{T('Editar', 'Edit', '編集')}</button>
          {m.status === 'done'
            ? <button className="btn" onClick={() => update({ status: 'planned' }, { now: true })}>{T('Reabrir', 'Reopen', '再開')}</button>
            : <button className="btn btn-primary" onClick={() => { update({ status: 'done' }, { now: true }); setTab('result') }}>{T('Concluir reunião', 'Finish meeting', '会議を完了')}</button>}
        </div>
      </div>

      <div className="mt-tabs" role="tablist">
        {[
          ['prep', T('Preparação', 'Preparation', '準備'), `${(m.invited || []).length}`],
          ['meeting', T('Reunião', 'Meeting', '会議'), linesOf(m).length ? T('conteúdo', 'content', '内容') : `${present}/${(m.invited || []).length}`],
          ['result', T('Resultado', 'Outcome', '結果'), `${openTasks(m).length + (previous?.open_tasks?.length || 0)}`],
        ].map(([k, label, badge]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { flush(); setTab(k) }}>
            {label}<span>{badge}</span>
          </button>
        ))}
      </div>

      {tab === 'prep' && <PrepTab T={T} lang={lang} m={m} people={people} update={update} previous={previous} setPrevious={setPrevious} />}
      {tab === 'meeting' && <MeetingTab T={T} m={m} update={update} fromServer={fromServer} flush={flush} />}
      {tab === 'result' && <ResultTab T={T} lang={lang} m={m} people={people} update={update} fromServer={fromServer} flush={flush} previous={previous} setPrevious={setPrevious} />}

      <div className="mt-danger-zone">
        <button className="btn btn-ghost btn-sm" onClick={remove}>{T('Excluir reunião', 'Delete meeting', '会議を削除')}</button>
      </div>

      {editing && <EditSheet T={T} m={m} onClose={() => setEditing(false)} onSave={patch => { update(patch, { now: true }); setEditing(false); if ('series' in patch || 'starts_at' in patch) setTimeout(load, 900) }} />}
    </div>
  )
}

function EditSheet({ T, m, onClose, onSave }) {
  const [f, setF] = useState({ title: m.title, series: m.series || '', starts_at: toLocalInput(m.starts_at), meet_url: m.meet_url || '' })
  return (
    <Sheet title={T('Editar reunião', 'Edit meeting', '会議を編集')} onClose={onClose}>
      <form className="mt-form" onSubmit={e => { e.preventDefault(); onSave({ ...f, starts_at: fromLocalInput(f.starts_at) }) }}>
        <Field label={T('Título', 'Title', 'タイトル')}><input className="mt-input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></Field>
        <div className="mt-form-row">
          <Field label={T('Data e hora (Tóquio)', 'Date and time (Tokyo)', '日時（東京）')}><input className="mt-input" type="datetime-local" value={f.starts_at} onChange={e => setF({ ...f, starts_at: e.target.value })} /></Field>
          <Field label={T('Grupo', 'Group', 'グループ')}><input className="mt-input" value={f.series} onChange={e => setF({ ...f, series: e.target.value })} /></Field>
        </div>
        <Field label={T('Link do Google Meet', 'Google Meet link', 'Google Meetリンク')}><input className="mt-input" value={f.meet_url} onChange={e => setF({ ...f, meet_url: e.target.value })} placeholder="https://meet.google.com/…" /></Field>
        <div className="mt-sheet-actions">
          <button type="button" className="btn" onClick={onClose}>{T('Cancelar', 'Cancel', 'キャンセル')}</button>
          <button type="submit" className="btn btn-primary">{T('Salvar', 'Save', '保存')}</button>
        </div>
      </form>
    </Sheet>
  )
}

/* ── Preparação ── */

function PrepTab({ T, lang, m, people, update, previous, setPrevious }) {
  return (
    <div className="mt-grid">
      <div className="card mt-card">
        <div className="mt-card-title">{T('Pauta', 'Agenda', '議題')}</div>
        <textarea className="mt-input mt-agenda" rows={8} value={m.agenda || ''} onChange={e => update({ agenda: e.target.value })}
          placeholder={T('Um assunto por linha', 'One item per line', '1行に1項目')} />
      </div>
      <div className="card mt-card">
        <div className="mt-card-title">{T('Convidados', 'Invited', '招待者')}</div>
        <PeoplePicker T={T} people={people} value={m.invited || []} onChange={invited => update({ invited })} />
      </div>
      <div className="mt-span">
        <PreviousCard T={T} lang={lang} m={m} update={update} previous={previous} setPrevious={setPrevious} />
      </div>
    </div>
  )
}

/* ── Reunião: presença + conteúdo do Meet (ou áudio) + anotações do admin ── */

function MeetingTab({ T, m, update, fromServer, flush }) {
  const invited = [...(m.invited || [])].sort((a, b) => (ROLE_GROUP[a.role] ?? 9) - (ROLE_GROUP[b.role] ?? 9) || a.name.localeCompare(b.name))
  const att = m.attendance || {}
  const setAtt = (key, v) => { const next = { ...att }; if (next[key] === v) delete next[key]; else next[key] = v; update({ attendance: next }) }
  const present = invited.filter(p => att[p.key] === 'present').length
  const absent = invited.filter(p => att[p.key] === 'absent').length
  const speakers = speakersOf(linesOf(m))
  const spokeKeys = new Set(speakers.map(s => matchPerson(invited, s.name)?.key).filter(Boolean))

  const markSpeakers = () => {
    const next = { ...att }
    invited.forEach(p => { if (spokeKeys.has(p.key)) next[p.key] = 'present'; else if (!next[p.key]) next[p.key] = 'absent' })
    update({ attendance: next }, { now: true })
  }

  return (
    <div className="mt-grid mt-grid-meeting">
      <div className="mt-col">
        <ContentCard T={T} m={m} fromServer={fromServer} flush={flush} />
        <NotesCard T={T} m={m} update={update} />
      </div>
      <div className="card mt-card">
        <div className="mt-card-title">
          {T('Presença', 'Attendance', '出欠')}
          <span className="mt-muted">{T(`${present} foram · ${absent} não foram`, `${present} present · ${absent} absent`, `出席${present}・欠席${absent}`)}</span>
        </div>
        {!invited.length && <div className="mt-empty sm">{T('Nenhum convidado. Adicione em Preparação.', 'No one invited yet. Add people in Preparation.', '招待者がいません')}</div>}
        {spokeKeys.size > 0 && (
          <button className="btn btn-sm mt-wide" onClick={markSpeakers}>{T(`Marcar presença por quem falou no Meet (${spokeKeys.size})`, `Mark present whoever spoke in Meet (${spokeKeys.size})`, `Meetで発言した人を出席に (${spokeKeys.size})`)}</button>
        )}
        <div className="mt-att">
          {invited.map(p => (
            <div key={p.key} className="mt-att-row">
              <span className="mt-avatar">{initials(p.name)}</span>
              <span className="mt-att-name">{p.name}{spokeKeys.has(p.key) && <small>{T('falou no Meet', 'spoke in Meet', 'Meetで発言')}</small>}</span>
              <div className="mt-att-btns">
                <button className={att[p.key] === 'present' ? 'on yes' : ''} onClick={() => setAtt(p.key, 'present')}>{T('Foi', 'Present', '出席')}</button>
                <button className={att[p.key] === 'absent' ? 'on no' : ''} onClick={() => setAtt(p.key, 'absent')}>{T('Não foi', 'Absent', '欠席')}</button>
              </div>
            </div>
          ))}
        </div>
        {invited.length > 0 && (
          <div className="mt-att-foot">
            <button className="btn btn-sm btn-ghost" onClick={() => update({ attendance: Object.fromEntries(invited.map(p => [p.key, 'present'])) })}>{T('Todos foram', 'Everyone present', '全員出席')}</button>
          </div>
        )}
      </div>
    </div>
  )
}

function ContentCard({ T, m, fromServer, flush }) {
  const [mode, setMode] = useState(null) // 'paste' | null
  const [text, setText] = useState('')
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState(false)
  const fileRef = useRef(null)
  const audioRef = useRef(null)
  const lines = linesOf(m)
  const src = m.content?.source
  const pendingAudio = audioPending(m)

  const run = async (label, fn) => {
    setBusy(label)
    try { await flush(); const next = await fn(); if (next) fromServer(next) } catch (e) { toast.error(e.message) }
    setBusy('')
  }
  const importText = () => run('import', async () => {
    const r = await importMeetText(m.id, text, T('Texto colado', 'Pasted text', '貼り付け'))
    setText(''); setMode(null)
    toast.success(T(`${linesOf(r).length} linhas importadas`, `${linesOf(r).length} lines imported`, `${linesOf(r).length}行を取り込みました`))
    return r
  })
  const importFile = file => run('import', async () => {
    const r = await importMeetFile(m.id, file)
    toast.success(T(`${linesOf(r).length} linhas importadas`, `${linesOf(r).length} lines imported`, `${linesOf(r).length}行を取り込みました`))
    return r
  })
  const uploadAudio = file => run('audio', () => uploadAndTranscribe(m.id, file, {
    name: file.name,
    onStage: (st, from) => setBusy(st === 'upload' ? 'audio-up' : `audio-tr:${from || 0}`),
  }))
  const retryAudio = a => run('audio', () => transcribePart(m.id, a.n, { from: Math.max(0, ...(a.parts || []).map(p => p.to || 0)), onStage: (st, from) => setBusy(`audio-tr:${from || 0}`) }))
  const playAudio = async a => { try { window.open(await audioUrl(m.id, a.n), '_blank', 'noopener') } catch (e) { toast.error(e.message) } }

  const busyLabel = busy === 'import' ? T('Importando…', 'Importing…', '取り込み中…')
    : busy === 'audio-up' ? T('Enviando o áudio…', 'Uploading audio…', '音声を送信中…')
      : busy.startsWith('audio-tr') ? T(`Transcrevendo a partir de ${fmtClock(Number(busy.split(':')[1]))}…`, `Transcribing from ${fmtClock(Number(busy.split(':')[1]))}…`, `${fmtClock(Number(busy.split(':')[1]))}から文字起こし中…`)
        : ''

  return (
    <div className="card mt-card">
      <div className="mt-card-title">
        {T('Conteúdo da reunião', 'Meeting content', '会議の内容')}
        {lines.length > 0 && <span className="mt-muted">{src === 'audio' ? T('transcrição do áudio', 'audio transcript', '音声文字起こし') : T('anotações do Meet', 'Meet notes', 'Meetメモ')} · {T(`${lines.length} linhas`, `${lines.length} lines`, `${lines.length}行`)}</span>}
      </div>

      {!lines.length && !busy && (
        <div className="mt-import">
          <p className="mt-help">{T(
            'Depois da chamada, o Google Meet salva as anotações (com quem falou) no Google Docs do organizador. Importe aqui: cole o texto ou envie o arquivo baixado (Arquivo → Fazer download → .docx ou .pdf).',
            'After the call Google Meet saves the notes (with who spoke) in the organiser’s Google Docs. Import them: paste the text or upload the downloaded file (File → Download → .docx or .pdf).',
            '通話後、Google Meetがメモ（発言者付き）をGoogleドキュメントに保存します。テキストを貼り付けるか、ダウンロードしたファイル（.docx / .pdf）を送ってください。',
          )}</p>
          <div className="mt-import-btns">
            <button className="btn btn-primary" onClick={() => setMode(mode === 'paste' ? null : 'paste')}>{T('Colar anotações do Meet', 'Paste Meet notes', 'Meetメモを貼り付け')}</button>
            <button className="btn" onClick={() => fileRef.current?.click()}>{T('Enviar arquivo (.docx, .pdf, .txt)', 'Upload file (.docx, .pdf, .txt)', 'ファイルを送る')}</button>
          </div>
          <div className="mt-import-alt">
            {T('Sem anotações do Meet?', 'No Meet notes?', 'Meetメモがない場合')}{' '}
            <button className="mt-link" onClick={() => audioRef.current?.click()}>{T('Enviar o áudio da reunião para transcrever', 'Upload the meeting audio to transcribe', '会議の音声を送って文字起こし')}</button>
          </div>
        </div>
      )}

      {mode === 'paste' && !busy && (
        <div className="mt-paste">
          <textarea className="mt-input" rows={10} value={text} onChange={e => setText(e.target.value)} autoFocus
            placeholder={T('Cole aqui todo o documento de anotações do Meet (resumo, detalhes, próximos passos e transcrição)', 'Paste the whole Meet notes document here', 'Meetのメモ全体を貼り付け')} />
          <div className="mt-row-btns">
            <button className="btn" onClick={() => { setMode(null); setText('') }}>{T('Cancelar', 'Cancel', 'キャンセル')}</button>
            <button className="btn btn-primary" disabled={!text.trim()} onClick={importText}>{T('Importar', 'Import', '取り込む')}</button>
          </div>
        </div>
      )}

      {busy && <div className="mt-progress"><span className="mt-spinner" />{busyLabel}</div>}

      <MeetingRecorder meetingId={m.id} T={T} flush={flush} onMeeting={fromServer} disabled={!!busy} />
      {(m.audio || []).length > 0 && (
        <div className="mt-audio-list">
          {m.audio.map(a => (
            <div key={a.n} className="mt-audio">
              <span className="mt-audio-name">{a.name || T(`Áudio ${a.n}`, `Audio ${a.n}`, `音声 ${a.n}`)}</span>
              <span className="mt-muted">{fmtClock(a.duration)}</span>
              <span className={`mt-pill ${a.status === 'done' ? 'ok' : a.status === 'error' ? 'bad' : ''}`}>{a.status === 'done' ? T('transcrito', 'transcribed', '完了') : a.status === 'error' ? T('falhou', 'failed', '失敗') : T('pendente', 'pending', '未完了')}</span>
              <button className="btn btn-sm btn-ghost" onClick={() => playAudio(a)}>{T('Ouvir', 'Play', '再生')}</button>
              {a.status !== 'done' && !busy && <button className="btn btn-sm" onClick={() => retryAudio(a)}>{T('Continuar', 'Continue', '続ける')}</button>}
            </div>
          ))}
        </div>
      )}

      {lines.length > 0 && (
        <>
          <div className="mt-content-info">
            {m.content?.file_name && <span>{m.content.file_name}</span>}
            {speakersOf(lines).length > 0 && <span>{T('Falaram', 'Speakers', '発言者')}: {speakersOf(lines).slice(0, 8).map(s => s.name).join(', ')}</span>}
          </div>
          <div className={`mt-lines ${open ? 'open' : ''}`}>
            {lines.slice(0, open ? lines.length : 8).map((l, i) => <Line key={i} l={l} />)}
          </div>
          <div className="mt-row-btns">
            {lines.length > 8 && <button className="btn btn-sm btn-ghost" onClick={() => setOpen(!open)}>{open ? T('Mostrar menos', 'Show less', '閉じる') : T(`Ver tudo (${lines.length} linhas)`, `Show all (${lines.length})`, `すべて表示 (${lines.length})`)}</button>}
            <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={!!busy}>{T('Importar outro documento', 'Import another document', '別の文書を取り込む')}</button>
            <button className="btn btn-sm btn-ghost" disabled={!!busy} onClick={() => { if (window.confirm(T('Tirar o conteúdo importado desta reunião? As suas anotações ficam.', 'Remove the imported content? Your notes stay.', '取り込んだ内容を外しますか？'))) run('clear', () => clearContent(m.id)) }}>{T('Remover conteúdo', 'Remove content', '内容を外す')}</button>
          </div>
          {pendingAudio.length > 0 && src === 'audio' && <p className="mt-hint">{T('Ainda há áudio sem transcrever.', 'Some audio is not transcribed yet.', '未完了の音声があります')}</p>}
        </>
      )}

      <input ref={fileRef} type="file" hidden accept=".docx,.pdf,.txt,.md,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importFile(f) }} />
      <input ref={audioRef} type="file" hidden accept="audio/*,.m4a,.mp3,.webm,.ogg,.wav"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadAudio(f) }} />
    </div>
  )
}

function Line({ l }) {
  return (
    <div className="mt-line">
      <span className="mt-line-t">{l.t != null ? fmtClock(l.t) : ''}</span>
      <span className="mt-line-x">{l.speaker && <b>{l.speaker}</b>}{l.text}</span>
    </div>
  )
}

function NotesCard({ T, m, update }) {
  const [text, setText] = useState('')
  const notes = m.notes || []
  const add = () => {
    if (!text.trim()) return
    update({ notes: [...notes, { id: newId(8), text: text.trim(), at: new Date().toISOString(), topic_id: null }] }, { now: true })
    setText('')
  }
  return (
    <div className="card mt-card">
      <div className="mt-card-title">{T('Minhas anotações', 'My notes', '自分のメモ')}<span className="mt-muted">{notes.length || ''}</span></div>
      <div className="mt-note-add">
        <textarea className="mt-input" rows={3} value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add() }}
          placeholder={T('Escreva durante ou depois da reunião. A IA liga cada anotação ao tópico certo.', 'Write during or after the meeting. The AI links each note to its topic.', '会議中・後に記入。AIが各メモを議題に紐づけます')} />
        <button className="btn btn-primary" disabled={!text.trim()} onClick={add}>{T('Adicionar', 'Add', '追加')}</button>
      </div>
      {notes.length > 0 && (
        <div className="mt-notes">
          {notes.map(n => (
            <div key={n.id} className="mt-note">
              <span className="mt-note-time">{fmtTime(n.at)}</span>
              <span className="mt-note-text">{n.text}</span>
              <button className="mt-x sm" aria-label={T('Apagar', 'Delete', '削除')} onClick={() => update({ notes: notes.filter(x => x.id !== n.id) }, { now: true })}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Resultado ── */

function ResultTab({ T, lang, m, people, update, fromServer, flush, previous, setPrevious }) {
  const [busy, setBusy] = useState(false)
  const lines = linesOf(m)
  const topics = groupByTopic(m)
  const hasInput = lines.length > 0 || (m.notes || []).length > 0

  const organise = async () => {
    setBusy(true)
    try { await flush(); fromServer(await analyzeMeeting(m.id, lang)); toast.success(T('Reunião organizada por tópicos', 'Meeting organised by topics', '議題ごとに整理しました')) } catch (e) { toast.error(e.message) }
    setBusy(false)
  }

  return (
    <div className="mt-result">
      <div className="card mt-card mt-ai-bar">
        <div>
          <strong>{m.topics?.length ? T(`${m.topics.length} tópicos`, `${m.topics.length} topics`, `${m.topics.length}件の議題`) : T('Organizar a reunião', 'Organise the meeting', '会議を整理')}</strong>
          <span className="mt-muted">{!hasInput ? T('Importe as anotações do Meet na aba Reunião.', 'Import the Meet notes in the Meeting tab first.', '先に会議タブでMeetメモを取り込んでください')
            : m.ai?.at ? T(`Organizado em ${fmtDay(m.ai.at, lang)} ${fmtTime(m.ai.at)}. Decisões e tarefas sugeridas só entram quando você confirma.`, 'Suggested decisions and tasks only count once you confirm them.', '提案は確認後に追加されます')
              : T('A IA separa por tópicos, liga suas anotações e sugere decisões e próximos passos.', 'The AI splits by topic, links your notes and suggests decisions and next steps.', 'AIが議題に分け、決定事項と次のアクションを提案します')}</span>
        </div>
        <button className="btn btn-primary" disabled={!hasInput || busy} onClick={organise}>{busy ? T('Organizando…', 'Organising…', '整理中…') : m.topics?.length ? T('Organizar de novo', 'Organise again', '再整理') : T('Organizar por tópicos', 'Organise by topics', '議題ごとに整理')}</button>
      </div>

      <div className="mt-grid">
        <div className="mt-col">
          <div className="card mt-card">
            <div className="mt-card-title">{T('Resumo', 'Summary', '要約')}</div>
            <textarea className="mt-input" rows={4} value={m.summary || ''} onChange={e => update({ summary: e.target.value })} placeholder={T('Resumo da reunião', 'Meeting summary', '会議の要約')} />
          </div>
          <DecisionsCard T={T} m={m} update={update} />
          <TasksCard T={T} lang={lang} m={m} people={people} update={update} />
          <PreviousCard T={T} lang={lang} m={m} update={update} previous={previous} setPrevious={setPrevious} />
        </div>
        <div className="mt-col mt-col-topics">
          <div className="card mt-card">
            <div className="mt-card-title">{T('Por tópico', 'By topic', '議題別')}</div>
            {!topics.length && <div className="mt-empty sm">{hasInput ? T('Toque em "Organizar por tópicos".', 'Tap "Organise by topics".', '「議題ごとに整理」を押してください') : T('Sem conteúdo ainda.', 'No content yet.', '内容がありません')}</div>}
            {topics.map((tp, i) => <TopicBlock key={tp.id} T={T} tp={tp} i={i} m={m} update={update} />)}
            {topics.length > 0 && <UnlinkedNotes T={T} m={m} update={update} />}
          </div>
        </div>
      </div>
    </div>
  )
}

function TopicBlock({ T, tp, i, m, update }) {
  const [open, setOpen] = useState(false)
  const setTitle = title => update({ topics: m.topics.map(x => x.id === tp.id ? { ...x, title } : x) })
  return (
    <div className="mt-topic">
      <div className="mt-topic-head">
        <span className="mt-topic-n">{i + 1}</span>
        <input className="mt-topic-title" value={tp.title} onChange={e => setTitle(e.target.value)} />
        {tp.start_t != null && <span className="mt-topic-t">{fmtClock(tp.start_t)}</span>}
      </div>
      {tp.summary && <p className="mt-topic-sum">{tp.summary}</p>}
      {tp.notes.length > 0 && (
        <div className="mt-topic-notes">
          {tp.notes.map(n => <div key={n.id} className="mt-topic-note"><span>{T('Anotação', 'Note', 'メモ')}</span>{n.text}</div>)}
        </div>
      )}
      {tp.lines.length > 0 && (
        <>
          <button className="mt-link" onClick={() => setOpen(!open)}>{open ? T('Esconder falas', 'Hide lines', '発言を隠す') : T(`Ver falas (${tp.lines.length})`, `Show lines (${tp.lines.length})`, `発言を見る (${tp.lines.length})`)}</button>
          {open && <div className="mt-lines open">{tp.lines.map(l => <Line key={l.n} l={l} />)}</div>}
        </>
      )}
    </div>
  )
}

function UnlinkedNotes({ T, m, update }) {
  const free = (m.notes || []).filter(n => !n.topic_id || !m.topics.some(tp => tp.id === n.topic_id))
  const all = m.notes || []
  if (!all.length) return null
  const move = (id, topic_id) => update({ notes: all.map(n => n.id === id ? { ...n, topic_id: topic_id || null } : n) }, { now: true })
  return (
    <div className="mt-unlinked">
      <div className="mt-label">{T('Ligar anotações aos tópicos', 'Link notes to topics', 'メモを議題に紐づけ')}</div>
      {all.map(n => (
        <div key={n.id} className={`mt-unlinked-row ${free.includes(n) ? 'free' : ''}`}>
          <span>{n.text}</span>
          <select className="mt-input mt-select" value={n.topic_id || ''} onChange={e => move(n.id, e.target.value)}>
            <option value="">{T('Sem tópico', 'No topic', '議題なし')}</option>
            {m.topics.map((tp, i) => <option key={tp.id} value={tp.id}>{i + 1}. {tp.title}</option>)}
          </select>
        </div>
      ))}
    </div>
  )
}

function DecisionsCard({ T, m, update }) {
  const [text, setText] = useState('')
  const list = m.decisions || []
  const have = new Set(list.map(d => d.text.trim().toLowerCase()))
  const suggestions = (m.ai?.decisions || []).filter(d => !have.has(d.trim().toLowerCase()) && !(m.ai?.dismissed_decisions || []).includes(d))
  const add = t => update({ decisions: [...list, { id: newId(8), text: t }] }, { now: true })
  return (
    <div className="card mt-card">
      <div className="mt-card-title">{T('Decisões', 'Decisions', '決定事項')}<span className="mt-muted">{list.length || ''}</span></div>
      {list.length > 0 && (
        <ol className="mt-decisions">
          {list.map(d => (
            <li key={d.id}>
              <AutoText value={d.text} onChange={e => update({ decisions: list.map(x => x.id === d.id ? { ...x, text: e.target.value } : x) })} />
              <button className="mt-x sm" aria-label="Remover" onClick={() => update({ decisions: list.filter(x => x.id !== d.id) }, { now: true })}>×</button>
            </li>
          ))}
        </ol>
      )}
      {suggestions.length > 0 && (
        <div className="mt-suggest">
          <div className="mt-suggest-head">
            <span>{T('Sugeridas pela IA', 'Suggested by AI', 'AIの提案')}</span>
            <button className="btn btn-sm" onClick={() => update({ decisions: [...list, ...suggestions.map(t => ({ id: newId(8), text: t }))] }, { now: true })}>{T('Adicionar todas', 'Add all', 'すべて追加')}</button>
          </div>
          {suggestions.map(s => (
            <div key={s} className="mt-suggest-row"><span>{s}</span><button className="btn btn-sm" onClick={() => add(s)}>{T('Adicionar', 'Add', '追加')}</button></div>
          ))}
        </div>
      )}
      <div className="mt-add-row">
        <input className="mt-input" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && text.trim()) { add(text.trim()); setText('') } }} placeholder={T('Nova decisão', 'New decision', '新しい決定事項')} />
        <button className="btn" disabled={!text.trim()} onClick={() => { add(text.trim()); setText('') }}>{T('Adicionar', 'Add', '追加')}</button>
      </div>
    </div>
  )
}

function OwnerSelect({ T, value, invited, people, onChange }) {
  const opts = [...invited, ...people.filter(p => !invited.some(i => i.key === p.key))]
  return (
    <select className="mt-input mt-select" value={value?.key || ''} onChange={e => { const p = opts.find(x => x.key === e.target.value); onChange(p ? { key: p.key, name: p.name } : null) }}>
      <option value="">{T('Responsável', 'Owner', '担当')}</option>
      {invited.length > 0 && <optgroup label={T('Convidados', 'Invited', '招待者')}>{invited.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}</optgroup>}
      <optgroup label={T('Equipe', 'Team', 'チーム')}>{people.filter(p => !invited.some(i => i.key === p.key)).map(p => <option key={p.key} value={p.key}>{p.name}</option>)}</optgroup>
    </select>
  )
}

function TasksCard({ T, lang, m, people, update }) {
  const [draft, setDraft] = useState({ text: '', owner: null, due: '' })
  const tasks = m.tasks || []
  const invited = m.invited || []
  const have = new Set(tasks.map(t => t.text.trim().toLowerCase()))
  const suggestions = (m.ai?.tasks || []).filter(s => !have.has(s.text.trim().toLowerCase()))
  const setTask = (id, patch) => update({ tasks: tasks.map(t => t.id === id ? { ...t, ...patch, ...(patch.status === 'done' ? { done_at: new Date().toISOString() } : {}) } : t) })
  const addTask = tk => update({ tasks: [...tasks, { id: newId(8), status: 'open', text: tk.text, owner: tk.owner || null, due: tk.due || '' }] }, { now: true })
  const today = todayTokyo()
  return (
    <div className="card mt-card">
      <div className="mt-card-title">{T('Próximos passos', 'Next steps', '次のアクション')}<span className="mt-muted">{openTasks(m).length ? T(`${openTasks(m).length} em aberto`, `${openTasks(m).length} open`, `未完了 ${openTasks(m).length}`) : ''}</span></div>
      {tasks.length > 0 && (
        <div className="mt-tasks">
          {tasks.map(t => (
            <div key={t.id} className={`mt-task ${t.status !== 'open' ? 'closed' : ''}`}>
              <input type="checkbox" className="mt-check" checked={t.status !== 'open'} disabled={t.status === 'carried'}
                onChange={e => setTask(t.id, { status: e.target.checked ? 'done' : 'open' })} aria-label={T('Concluída', 'Done', '完了')} />
              <div className="mt-task-main">
                <AutoText value={t.text} onChange={e => setTask(t.id, { text: e.target.value })} />
                <div className="mt-task-meta">
                  <OwnerSelect T={T} value={t.owner} invited={invited} people={people} onChange={owner => setTask(t.id, { owner })} />
                  <input type="date" className={`mt-input mt-date-in ${t.status === 'open' && t.due && t.due < today ? 'late' : ''}`} value={t.due || ''} onChange={e => setTask(t.id, { due: e.target.value })} />
                  {t.status === 'carried' && <span className="mt-pill">{T('levada para a próxima', 'carried over', '次回へ')}</span>}
                  {t.from && <span className="mt-pill">{T('da reunião anterior', 'from previous meeting', '前回から')}</span>}
                </div>
              </div>
              <button className="mt-x sm" aria-label="Remover" onClick={() => update({ tasks: tasks.filter(x => x.id !== t.id) }, { now: true })}>×</button>
            </div>
          ))}
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="mt-suggest">
          <div className="mt-suggest-head">
            <span>{T('Sugeridos pela IA', 'Suggested by AI', 'AIの提案')}</span>
            <button className="btn btn-sm" onClick={() => update({ tasks: [...tasks, ...suggestions.map(s => ({ id: newId(8), status: 'open', text: s.text, owner: s.owner || null, due: s.due || '' }))] }, { now: true })}>{T('Adicionar todos', 'Add all', 'すべて追加')}</button>
          </div>
          {suggestions.map(s => (
            <div key={s.text} className="mt-suggest-row">
              <span>{s.text}<small>{[s.owner?.name || s.owner_name, fmtDue(s.due, lang)].filter(Boolean).join(' · ')}</small></span>
              <button className="btn btn-sm" onClick={() => addTask(s)}>{T('Adicionar', 'Add', '追加')}</button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-task-add">
        <input className="mt-input" value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} placeholder={T('Nova tarefa', 'New task', '新しいタスク')} />
        <OwnerSelect T={T} value={draft.owner} invited={invited} people={people} onChange={owner => setDraft({ ...draft, owner })} />
        <input type="date" className="mt-input mt-date-in" value={draft.due} onChange={e => setDraft({ ...draft, due: e.target.value })} />
        <button className="btn" disabled={!draft.text.trim()} onClick={() => { addTask({ ...draft, text: draft.text.trim() }); setDraft({ text: '', owner: null, due: '' }) }}>{T('Adicionar', 'Add', '追加')}</button>
      </div>
    </div>
  )
}

function PreviousCard({ T, lang, m, update, previous, setPrevious }) {
  if (!m.series) {
    return (
      <div className="card mt-card">
        <div className="mt-card-title">{T('Pendências da reunião anterior', 'Open items from the previous meeting', '前回の未完了')}</div>
        <div className="mt-empty sm">{T('Defina um grupo em Editar para puxar o que ficou aberto na última reunião do mesmo grupo.', 'Set a group (Edit) to pull what was left open in the last meeting of that group.', '「編集」でグループを設定すると前回の未完了を表示します')}</div>
      </div>
    )
  }
  const list = previous?.open_tasks || []
  const close = async (tk, status) => {
    try {
      await updateTask(previous.id, tk.id, { status })
      setPrevious(p => ({ ...p, open_tasks: p.open_tasks.filter(x => x.id !== tk.id) }))
      if (status === 'carried') {
        update({ tasks: [...(m.tasks || []), { id: newId(8), status: 'open', text: tk.text, owner: tk.owner, due: tk.due, from: { meeting_id: previous.id, task_id: tk.id, title: previous.title } }] }, { now: true })
        toast.success(T('Trazida para esta reunião', 'Moved to this meeting', 'この会議に移しました'))
      } else toast.success(T('Marcada como concluída', 'Marked done', '完了にしました'))
    } catch (e) { toast.error(e.message) }
  }
  return (
    <div className="card mt-card">
      <div className="mt-card-title">
        {T('Pendências da reunião anterior', 'Open items from the previous meeting', '前回の未完了')}
        {previous && <Link className="mt-muted mt-link" to={`/meetings/${previous.id}`}>{fmtDay(previous.starts_at, lang)}</Link>}
      </div>
      {!previous && <div className="mt-empty sm">{T(`Esta é a primeira reunião do grupo "${m.series}".`, `First meeting of group "${m.series}".`, `グループ「${m.series}」の最初の会議です`)}</div>}
      {previous && !list.length && <div className="mt-empty sm">{T('Tudo o que foi combinado na reunião anterior está concluído.', 'Everything from the previous meeting is done.', '前回のタスクはすべて完了')}</div>}
      {list.length > 0 && (
        <div className="mt-tasks">
          {list.map(tk => (
            <div key={tk.id} className="mt-task">
              <div className="mt-task-main">
                <div className="mt-task-text">{tk.text}</div>
                <div className="mt-task-meta mt-muted">{[tk.owner?.name, tk.due && T(`prazo ${fmtDue(tk.due, lang)}`, `due ${fmtDue(tk.due, lang)}`, `期限 ${fmtDue(tk.due, lang)}`)].filter(Boolean).join(' · ') || T('sem responsável', 'no owner', '担当なし')}</div>
              </div>
              <div className="mt-prev-btns">
                <button className="btn btn-sm" onClick={() => close(tk, 'done')}>{T('Concluída', 'Done', '完了')}</button>
                <button className="btn btn-sm btn-primary" onClick={() => close(tk, 'carried')}>{T('Trazer para esta', 'Carry over', '引き継ぐ')}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
