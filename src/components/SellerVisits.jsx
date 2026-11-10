// v1.0.206 · "Visita agendada" in the seller portal: book date + time, see the next visits,
// and send them to Google Agenda (one tap per visit, or connect once and they all show up).
import { useState } from 'react'
import toast from 'react-hot-toast'
import { pickLang } from '../hooks/useLang'
import { fetchCalendarFeedUrl, googleCalendarUrl } from '../lib/calendar'
import { DEFAULT_VISIT_MINUTES, missedVisits, upcomingVisits, visitAsCalendarJob } from '../lib/sellerVisits'

const GCAL_FLAG = 'kp_seller_gcal_connected'
const readFlag = () => { try { return localStorage.getItem(GCAL_FLAG) === '1' } catch { return false } }
const writeFlag = () => { try { localStorage.setItem(GCAL_FLAG, '1') } catch { /* private mode: just not remembered */ } }

const addDays = (ymd, n) => { const [y, m, d] = String(ymd).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10) }
const weekdayOf = ymd => { const [y, m, d] = String(ymd).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay() }

export function visitCopy(lang) {
  const p = (en, ja, pt) => pickLang(lang, en, ja, pt)
  return {
    title: p('Scheduled visit', '訪問予定', 'Visita agendada'),
    toggle: p('I booked a visit with this client', 'この顧客と訪問を約束した', 'Agendei visita com este cliente'),
    schedule: p('Schedule visit', '訪問を予約', 'Agendar visita'),
    date: p('Day', '日付', 'Dia'), time: p('Time', '時間', 'Horário'), length: p('Length', '所要時間', 'Duração'),
    note: p('Note for the visit (optional)', '訪問メモ（任意）', 'Anotação da visita (opcional)'),
    today: p('Today', '今日', 'Hoje'), tomorrow: p('Tomorrow', '明日', 'Amanhã'),
    week: p(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], ['日', '月', '火', '水', '木', '金', '土'], ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']),
    mins: n => n < 60 ? `${n} min` : `${n / 60} h`,
    save: p('Save visit', '訪問を保存', 'Salvar visita'), saving: p('Saving…', '保存中…', 'Salvando…'),
    saved: p('Visit scheduled', '訪問を予約しました', 'Visita agendada'),
    next: p('Next visits', '次の訪問', 'Próximas visitas'),
    none: p('No visit scheduled. Book one from a client page or when you add a lead.', '訪問予定はありません。顧客ページかリード登録で予約できます。', 'Nenhuma visita agendada. Agende pela página do cliente ou ao cadastrar um lead.'),
    missed: p('Visit day passed — did it happen?', '訪問日が過ぎました。実施しましたか？', 'O dia da visita passou — aconteceu?'),
    done: p('Done', '実施済み', 'Feita'), cancel: p('Cancel', 'キャンセル', 'Cancelar'), edit: p('Change', '変更', 'Mudar'),
    cancelled: p('Visit cancelled', '訪問をキャンセルしました', 'Visita cancelada'),
    cancelAsk: p('Cancel this visit?', 'この訪問をキャンセルしますか？', 'Cancelar esta visita?'),
    addGoogle: p('Add to Google Calendar', 'Googleカレンダーに追加', 'Pôr no Google Agenda'),
    google: 'Google',
    connect: p('Connect Google Calendar', 'Googleカレンダーと連携', 'Conectar Google Agenda'),
    connectHint: p('Connect once: every visit you book shows up in your Google Calendar by itself (Google refreshes it every few hours; "Add to Google Calendar" puts one in right now).',
      '一度連携すると、予約した訪問がすべて自動でGoogleカレンダーに表示されます（数時間ごとに更新。「Googleカレンダーに追加」ですぐ反映）。',
      'Conecte uma vez: toda visita que você agendar aparece sozinha no seu Google Agenda (o Google atualiza a cada poucas horas; "Pôr no Google Agenda" coloca na hora).'),
    connected: p('Google Calendar connected', 'Googleカレンダー連携済み', 'Google Agenda conectado'),
    copy: p('Copy link', 'リンクをコピー', 'Copiar link'), copied: p('Link copied', 'コピーしました', 'Link copiado'),
    reconnect: p('Connect again', '再連携', 'Conectar de novo'),
    openLead: p('Open client', '顧客を開く', 'Abrir cliente'),
  }
}

export const blankVisit = (today, extra = {}) => ({ date: '', time: '', duration_min: DEFAULT_VISIT_MINUTES, note: '', ...extra, _today: today })

/** Day / time / length pickers with one-tap chips. */
export function VisitFields({ visit, onChange, lang, today }) {
  const v = visitCopy(lang)
  const set = patch => onChange({ ...visit, ...patch })
  const days = [0, 1, 2, 3, 4, 5, 6].map(n => addDays(today, n))
  return <div className="sp-visit-fields">
    <div className="form-group"><span>{v.date}</span>
      <div className="sp-chip-row sp-visit-days">{days.map((d, i) => <button type="button" key={d} aria-pressed={visit.date === d} className={`fa-chip${visit.date === d ? ' is-active' : ''}`} onClick={() => set({ date: d })}>
        {i === 0 ? v.today : i === 1 ? v.tomorrow : `${v.week[weekdayOf(d)]} ${Number(d.slice(8))}`}</button>)}</div>
      <input type="date" min={today} value={visit.date || ''} onChange={e => set({ date: e.target.value })} />
    </div>
    <div className="form-group"><span>{v.time}</span>
      <div className="sp-chip-row">{['10:00', '11:00', '14:00', '15:00', '16:00', '17:00'].map(h => <button type="button" key={h} aria-pressed={visit.time === h} className={`fa-chip${visit.time === h ? ' is-active' : ''}`} onClick={() => set({ time: h })}>{h}</button>)}</div>
      <input type="time" step="300" value={visit.time || ''} onChange={e => set({ time: e.target.value })} />
    </div>
    <div className="form-group"><span>{v.length}</span>
      <div className="sp-chip-row">{[30, 60, 90, 120].map(n => <button type="button" key={n} aria-pressed={Number(visit.duration_min) === n} className={`fa-chip${Number(visit.duration_min) === n ? ' is-active' : ''}`} onClick={() => set({ duration_min: n })}>{v.mins(n)}</button>)}</div>
    </div>
    <label className="form-group"><span>{v.note}</span><textarea rows="2" value={visit.note || ''} onChange={e => set({ note: e.target.value })} /></label>
  </div>
}

export function visitGoogleUrl(visit, lead, sellerName) {
  return googleCalendarUrl(visitAsCalendarJob(visit, lead, { sellerName }), { appUrl: typeof window !== 'undefined' ? window.location.origin : '' })
}

const fmtDay = (ymd, lang, today) => {
  const v = visitCopy(lang)
  if (ymd === today) return v.today
  if (ymd === addDays(today, 1)) return v.tomorrow
  return `${v.week[weekdayOf(ymd)]} ${ymd.slice(8)}/${ymd.slice(5, 7)}`
}

/** One visit row: day, time, place, Google, done / change / cancel. */
export function VisitRow({ visit, lead, lang, today, sellerName, onOpenLead, onDone, onEdit, onCancel, busy }) {
  const v = visitCopy(lang)
  const missed = visit.date < today
  return <div className={`sp-visit-row${missed ? ' is-missed' : ''}${visit.date === today ? ' is-today' : ''}`}>
    <button type="button" className="sp-visit-when" onClick={() => lead && onOpenLead?.(lead)} disabled={!lead || !onOpenLead}>
      <strong>{fmtDay(visit.date, lang, today)}</strong><small>{visit.time || '—'}</small>
    </button>
    <div className="sp-visit-what">
      <strong>{(lead && (lead.site_name || lead.company_name)) || visit.place}</strong>
      <small>{[lead?.site_name && lead.company_name !== lead.site_name ? lead.company_name : '', visit.address || lead?.address, visit.note].filter(Boolean).join(' · ')}</small>
      {missed && <small className="sp-visit-missed">⚠ {v.missed}</small>}
      <div className="sp-visit-actions">
        <a className="fa-btn fa-btn-sm" href={visitGoogleUrl(visit, lead, sellerName)} target="_blank" rel="noreferrer">📅 {v.google}</a>
        {onDone && <button type="button" className="fa-btn fa-btn-sm fa-btn-primary" disabled={busy} onClick={() => onDone(visit, lead)}>✓ {v.done}</button>}
        {onEdit && <button type="button" className="fa-btn fa-btn-sm" disabled={busy} onClick={() => onEdit(visit, lead)}>✎ {v.edit}</button>}
        {onCancel && <button type="button" className="fa-btn fa-btn-sm fa-btn-ghost" disabled={busy} onClick={() => onCancel(visit)}>✕ {v.cancel}</button>}
      </div>
    </div>
  </div>
}

/** Home card: visits that passed without an answer + the next ones. */
export function UpcomingVisits({ visits, leads, lang, today, sellerName, onOpenLead, onDone, onEdit, onCancel, busy, limit = 5, children }) {
  const v = visitCopy(lang)
  const byId = new Map((leads || []).map(l => [l.id, l]))
  const rows = [...missedVisits(visits, today).slice(0, 3), ...upcomingVisits(visits, today)].slice(0, limit + 3)
  return <section className="fa-card sp-visits">
    <div className="fa-card-head"><h2>📅 {v.next}</h2></div>
    {rows.length ? rows.map(row => <VisitRow key={row.id} visit={row} lead={byId.get(row.lead_id)} lang={lang} today={today} sellerName={sellerName}
      onOpenLead={onOpenLead} onDone={onDone} onEdit={onEdit} onCancel={onCancel} busy={busy} />) : <p className="fa-muted">{v.none}</p>}
    {children}
  </section>
}

/** Connect once: subscribes the seller's Google Calendar to their private visits feed. */
export function GoogleAgendaConnect({ lang, compact = false }) {
  const v = visitCopy(lang)
  const [connected, setConnected] = useState(readFlag)
  const [busy, setBusy] = useState(false)
  const getUrl = async () => {
    setBusy(true)
    try { return await fetchCalendarFeedUrl() } catch (error) { toast.error(error.message); return '' } finally { setBusy(false) }
  }
  const connect = async () => {
    // Open the tab first (iPhone blocks pop-ups opened after an await), then point it to Google.
    const tab = window.open('', '_blank')
    const url = await getUrl()
    if (!url) { tab?.close(); return }
    const target = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(url.replace(/^https?:/, 'webcal:'))}`
    if (tab) tab.location.href = target
    else window.location.href = target
    writeFlag(); setConnected(true)
  }
  const copy = async () => {
    const url = await getUrl()
    if (!url) return
    try { await navigator.clipboard.writeText(url); toast.success(v.copied) } catch { window.prompt(v.copy, url) }
  }
  return <div className={`sp-gcal${connected ? ' is-on' : ''}${compact ? ' is-compact' : ''}`}>
    <div className="sp-gcal-text"><strong>{connected ? `✓ ${v.connected}` : `📅 ${v.connect}`}</strong>{!compact && <small>{v.connectHint}</small>}</div>
    <div className="sp-gcal-actions">
      <button type="button" className={`fa-btn fa-btn-sm${connected ? '' : ' fa-btn-primary'}`} disabled={busy} onClick={connect}>{connected ? v.reconnect : v.connect}</button>
      <button type="button" className="fa-btn fa-btn-sm fa-btn-ghost" disabled={busy} onClick={copy}>{v.copy}</button>
    </div>
  </div>
}
