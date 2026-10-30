import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useLang, pickLang, fill } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { fetchPendingTimeOff, decideTimeOff, TIME_OFF_CHANGED } from '../lib/timeOff'
import { fetchAutoClosedPeriods, PAYROLL_CHANGED } from '../lib/payrollAlerts'
import { fetchPendingQuoteRequests, QUOTE_REQUESTS_CHANGED } from '../lib/quoteRequests'
import { fetchQuoteFlowAlerts, QUOTE_FLOW_CHANGED } from '../lib/quoteFlow'
import { fmtPeriod } from '../lib/salaryPeriod'
import { fmtDay } from './AvailabilityPlanner'
import { fetchDayContext } from '../lib/dayContext'
import DayContext from './DayContext'
import { fetchFacilityOffers, offerToClient, offerWhen } from './facility/FacilityOffersBell'
import { ELEMENT_KINDS } from '../lib/facilityModel'
import { fetchAssignAlerts } from '../lib/assignNotices'
import { PENDING_CHANGED } from '../lib/adminPending'
import { fetchDayCoverage, needsAction } from '../lib/dayCoverage'

const tokyoMinutes = () => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })); return d.getHours() * 60 + d.getMinutes() }

const SEEN_KEY = 'kp_timeoff_seen_v1'
const readSeen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')) } catch { return new Set() } }
const writeSeen = (ids) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-500))) } catch { /* private mode */ } }

// Admin topbar: bell with the number of pending day-off requests (plus payroll months the
// cron closed automatically and client quote requests waiting for a price), a small alert
// when new ones arrive, and a pop-up to approve / reject each request or open the page.
// Since v1.0.79 it also holds the Smart Facility "services to offer" (was a separate 🧽 button).
export default function TimeOffCenter() {
  const { lang, t: tAll } = useLang()
  const ft = tAll.facility
  const L = (en, jaText, pt) => pickLang(lang, en, jaText, pt)
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState('all')
  const [newQuotes, setNewQuotes] = useState([])
  const [toastOpen, setToastOpen] = useState(false)
  const [busy, setBusy] = useState(null)
  const [noteFor, setNoteFor] = useState(null)
  const [notes, setNotes] = useState({})
  const [dayCtx, setDayCtx] = useState({})
  const [payroll, setPayroll] = useState([])
  const [quotes, setQuotes] = useState([])
  // v1.0.70 · accepted quotes with no date yet + quote jobs just finished (invoice sent)
  const [toBook, setToBook] = useState([])
  const [flowDone, setFlowDone] = useState([])
  const [newFlow, setNewFlow] = useState([])
  const [offers, setOffers] = useState([])
  const [newOffers, setNewOffers] = useState([])
  // v1.0.101 · who accepted an urgent offer + jobs of today / tomorrow with nobody
  const [taken, setTaken] = useState([])
  const [noPerson, setNoPerson] = useState([])
  // v1.0.103 · today's contract places not done (no job / nobody / late)
  const [dayMissing, setDayMissing] = useState([])
  const seen = useRef(readSeen())

  // v1.0.102 · a list that fails to load keeps its last value (it used to drop to 0 and come back,
  // so the count went 3 → empty → 3), and only the newest load is applied.
  const loadSeq = useRef(0)
  const last = useRef({ list: [], periods: [], quoteRows: [], flow: { toBook: [], done: [] }, offerRows: [], assign: { accepted: [], noPerson: [] }, cov: null })
  const keep = (p, k) => p.then(v => { last.current[k] = v; return v }, () => last.current[k])
  const load = () => {
    const seq = ++loadSeq.current
    return Promise.all([
      keep(fetchPendingTimeOff(tokyoToday()), 'list'),
      keep(fetchAutoClosedPeriods(), 'periods'),
      keep(fetchPendingQuoteRequests(), 'quoteRows'),
      keep(fetchQuoteFlowAlerts(), 'flow'),
      keep(fetchFacilityOffers(), 'offerRows'),
      keep(fetchAssignAlerts(), 'assign'),
      keep(fetchDayCoverage(tokyoToday(), { nowMin: tokyoMinutes() }), 'cov'),
    ]).then(([list, periods, quoteRows, flow, offerRows, assign, cov]) => {
    if (seq !== loadSeq.current) return
    setOffers(offerRows)
    const takenUnseen = assign.accepted.filter(a => !seen.current.has(a.id))
    setTaken(takenUnseen)
    setNoPerson(assign.noPerson)
    const act = cov ? cov.missing.filter(needsAction) : []
    const covRows = act.length ? [{ id: `daycov-${tokyoToday()}-${act.length}`, done: cov.done, total: cov.total, missing: cov.missing.length, first: act[0] }] : []
    setDayMissing(covRows)
    setRows(list)
    setPayroll(periods)
    setQuotes(quoteRows)
    setToBook(flow.toBook)
    // a finished job stays in the bell until it has been seen once
    const doneUnseen = flow.done.filter(d => !seen.current.has(d.id))
    setFlowDone(doneUnseen)
    // Alert only once per item, ever: after that the number stays in the side menu until it is resolved
    const fresh = [...list, ...periods, ...quoteRows, ...flow.toBook, ...doneUnseen, ...offerRows, ...takenUnseen, ...assign.noPerson, ...covRows].filter(r => !seen.current.has(r.id))
    if (fresh.length) {
      setNewQuotes(quoteRows.filter(q => fresh.includes(q)))
      setNewFlow([...flow.toBook, ...doneUnseen].filter(q => fresh.includes(q)))
      setNewOffers(offerRows.filter(q => fresh.includes(q)))
      fresh.forEach(r => seen.current.add(r.id))
      writeSeen(seen.current)
      setToastOpen(true)
    }
  })
  }

  useEffect(() => {
    load()
    const id = setInterval(load, 60000)
    window.addEventListener(TIME_OFF_CHANGED, load)
    window.addEventListener(PAYROLL_CHANGED, load)
    window.addEventListener(QUOTE_REQUESTS_CHANGED, load)
    window.addEventListener(QUOTE_FLOW_CHANGED, load)
    window.addEventListener(PENDING_CHANGED, load)
    return () => { clearInterval(id); window.removeEventListener(TIME_OFF_CHANGED, load); window.removeEventListener(PAYROLL_CHANGED, load); window.removeEventListener(QUOTE_REQUESTS_CHANGED, load); window.removeEventListener(QUOTE_FLOW_CHANGED, load); window.removeEventListener(PENDING_CHANGED, load) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // The pop-up alert goes away on its own; the bell and the side-menu numbers stay.
  useEffect(() => {
    if (!toastOpen) return
    const id = setTimeout(() => setToastOpen(false), 12000)
    return () => clearTimeout(id)
  }, [toastOpen])

  const markSeen = () => {
    rows.concat(payroll, quotes, toBook, flowDone, offers, noPerson, dayMissing).forEach(r => seen.current.add(r.id))
    writeSeen(seen.current)
    setToastOpen(false)
  }
  const openPopup = () => {
    markSeen(); setOpen(true)
    fetchDayContext(rows.map(r => r.date)).then(setDayCtx).catch(() => {})
  }

  const decide = async (row, status) => {
    setBusy(row.id + status)
    try {
      await decideTimeOff(row.id, status, notes[row.id])
      toast.success(status === 'approved' ? L('Day off approved', '休みを承認しました', 'Folga aprovada') : L('Request declined', '申請を却下しました', 'Pedido recusado'))
      setRows(r => r.filter(x => x.id !== row.id))
      setNoteFor(null)
    } catch (e) {
      toast.error(e.message)
    }
    setBusy(null)
  }

  const openCalendar = () => { setOpen(false); markSeen(); navigate('/employees?tab=availability') }
  const openPayroll = (period) => { setOpen(false); markSeen(); navigate(`/salary-periods?period=${period}`) }
  const openQuotes = () => { setOpen(false); markSeen(); navigate('/mitsumori?tab=requests') }
  const openTrack = (item) => { setOpen(false); markSeen(); navigate(`/mitsumori?track=${item.ref || `${item.kind === 'mitsumori' ? 'mit' : 'req'}:${item.ref_id}`}`) }
  const openAssign = () => { setOpen(false); markSeen(); navigate('/schedule') }
  const openLive = () => { setOpen(false); markSeen(); navigate('/live') }
  const okTaken = (t) => { seen.current.add(t.id); writeSeen(seen.current); setTaken(list => list.filter(x => x.id !== t.id)) }
  const openStore = (r) => { setOpen(false); markSeen(); navigate(`/facility?model=${r.model_id}`) }
  const offer = async (r) => {
    setBusy(r.id)
    try {
      await offerToClient(r, ft)
      toast.success(ft.offered)
      setOffers(list => list.filter(x => x.id !== r.id))
    } catch (e) {
      toast.error(e.message)
    }
    setBusy(null)
  }
  const n = rows.length + payroll.length + quotes.length + toBook.length + flowDone.length + offers.length + taken.length + noPerson.length + dayMissing.length
  const kinds = [
    { key: 'jobs', label: L('Jobs', '作業', 'Jobs'), n: taken.length + noPerson.length + dayMissing.length },
    { key: 'quotes', label: L('Quotes', '見積もり', 'Orçamentos'), n: quotes.length + toBook.length + flowDone.length },
    { key: 'payroll', label: L('Payroll', '給与', 'Folha'), n: payroll.length },
    { key: 'dayoff', label: L('Day off', '休み', 'Folgas'), n: rows.length },
    { key: 'offers', label: L('Offers', '提案', 'Ofertas'), n: offers.length },
  ]
  const show = key => kind === 'all' || kind === key

  return (
    <>
      <button type="button" className={`ref-top-action tor-bell${n ? ' has-items' : ''}`} onClick={openPopup}
        title={n ? L(`${n} item(s) waiting`, `確認待ち ${n}件`, `${n} item(ns) aguardando`) : L('No requests waiting', '承認待ちはありません', 'Nenhum pedido aguardando')}
        aria-label={L('Waiting for you', '確認待ち', 'Aguardando você')}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {n > 0 && <span className="tor-count">{n > 9 ? '9+' : n}</span>}
      </button>

      {/* Portal: the topbar uses backdrop-filter, which would trap position:fixed inside it */}
      {createPortal(<>
      {toastOpen && newQuotes.length > 0 && !open && (
        <div className="tor-toast" role="status">
          <span className="tor-toast-icon" aria-hidden="true">📝</span>
          <div className="tor-toast-text">
            <strong>{newQuotes.length === 1 ? L('New quote request', '新しい見積もり依頼', 'Novo pedido de orçamento') : L(`${newQuotes.length} new quote requests`, `新しい見積もり依頼 ${newQuotes.length}件`, `${newQuotes.length} novos pedidos de orçamento`)}</strong>
            <span>{[newQuotes[0].client_name, newQuotes[0].location_name, newQuotes[0].category].filter(Boolean).join(' · ') || L('Set the company price', '会社の価格を設定してください', 'Defina o preço da empresa')}</span>
          </div>
          <button type="button" className="tor-btn tor-btn-primary tor-btn-sm" onClick={openQuotes}>{L('Open', '開く', 'Abrir')}</button>
          <button type="button" className="tor-toast-close" onClick={markSeen} aria-label={L('Dismiss', '閉じる', 'Dispensar')}>×</button>
        </div>
      )}
      {toastOpen && newQuotes.length === 0 && newFlow.length > 0 && !open && (
        <div className="tor-toast" role="status">
          <span className="tor-toast-icon" aria-hidden="true">{newFlow[0].id.startsWith('qf-done') ? '🧾' : '📅'}</span>
          <div className="tor-toast-text">
            <strong>{newFlow[0].id.startsWith('qf-done') ? L('Job done · invoice sent', '作業完了・請求書を送付', 'Serviço feito · nota enviada') : L('Quote accepted · book the date', '見積承認・日程を決めてください', 'Orçamento aceito · marque a data')}</strong>
            <span>{[newFlow[0].name, newFlow[0].total ? `¥${Math.round(Number(newFlow[0].total)).toLocaleString()}` : ''].filter(Boolean).join(' · ')}</span>
          </div>
          <button type="button" className="tor-btn tor-btn-primary tor-btn-sm" onClick={() => openTrack(newFlow[0])}>{L('Open', '開く', 'Abrir')}</button>
          <button type="button" className="tor-toast-close" onClick={markSeen} aria-label={L('Dismiss', '閉じる', 'Dispensar')}>×</button>
        </div>
      )}
      {toastOpen && newQuotes.length === 0 && newFlow.length === 0 && payroll.length > 0 && !open && (
        <div className="tor-toast" role="status">
          <span className="tor-toast-icon" aria-hidden="true">💴</span>
          <div className="tor-toast-text">
            <strong>{L(`Payroll ${fmtPeriod(payroll[0].period)} closed automatically`, `${fmtPeriod(payroll[0].period)} の給与を自動で締めました`, `Folha de ${fmtPeriod(payroll[0].period)} fechada automaticamente`)}</strong>
            <span>{L('Check the payslips before staff confirm', '従業員の確認前に明細をチェックしてください', 'Confira os holerites antes da equipe confirmar')}</span>
          </div>
          <button type="button" className="tor-btn tor-btn-primary tor-btn-sm" onClick={() => openPayroll(payroll[0].period)}>{L('Review', '確認', 'Revisar')}</button>
          <button type="button" className="tor-toast-close" onClick={markSeen} aria-label={L('Dismiss', '閉じる', 'Dispensar')}>×</button>
        </div>
      )}
      {toastOpen && newQuotes.length === 0 && newFlow.length === 0 && payroll.length === 0 && rows.length === 0 && newOffers.length > 0 && !open && (
        <div className="tor-toast" role="status">
          <span className="tor-toast-icon" aria-hidden="true">🧽</span>
          <div className="tor-toast-text">
            <strong>{fill(ft.offersCount, { n: newOffers.length })}</strong>
            <span>{fill(ft.offerTo, { task: newOffers[0].task_name, client: newOffers[0].client_name || newOffers[0].location })}</span>
          </div>
          <button type="button" className="tor-btn tor-btn-primary tor-btn-sm" onClick={openPopup}>{L('Open', '開く', 'Abrir')}</button>
          <button type="button" className="tor-toast-close" onClick={markSeen} aria-label={L('Dismiss', '閉じる', 'Dispensar')}>×</button>
        </div>
      )}
      {toastOpen && newQuotes.length === 0 && newFlow.length === 0 && payroll.length === 0 && rows.length > 0 && !open && (
        <div className="tor-toast" role="status">
          <span className="tor-toast-icon" aria-hidden="true">🗓</span>
          <div className="tor-toast-text">
            <strong>{L(`${rows.length} day-off request${rows.length > 1 ? 's' : ''}`, `休み申請 ${rows.length}件`, `${rows.length} pedido${rows.length > 1 ? 's' : ''} de folga`)}</strong>
            <span>{rows.length === 1 ? `${rows[0].employee_name || '—'} · ${fmtDay(rows[0].date, lang, { weekday: 'short', day: 'numeric', month: 'short' })}` : L('Waiting for your decision', '承認待ちです', 'Aguardando sua decisão')}</span>
          </div>
          <button type="button" className="tor-btn tor-btn-primary tor-btn-sm" onClick={openPopup}>{L('Review', '確認', 'Revisar')}</button>
          <button type="button" className="tor-toast-close" onClick={markSeen} aria-label={L('Dismiss', '閉じる', 'Dispensar')}>×</button>
        </div>
      )}

      {open && (
        <div className="tor-backdrop" onClick={() => setOpen(false)}>
          <section className="tor-modal" role="dialog" aria-modal="true" aria-label={L('Waiting for you', '確認待ち', 'Aguardando você')} onClick={e => e.stopPropagation()}>
            <header className="tor-head">
              <div>
                <h2>{L('Waiting for you', '確認待ち', 'Aguardando você')}</h2>
                <p>{n ? L(`${n} waiting for you`, `${n}件が確認待ち`, `${n} aguardando você`) : L('Nothing waiting. All caught up.', '承認待ちはありません。', 'Nada pendente. Tudo em dia.')}</p>
              </div>
              <button type="button" className="tor-close" onClick={() => setOpen(false)} aria-label={L('Close', '閉じる', 'Fechar')}>×</button>
            </header>

            {/* v1.0.96 · split by type */}
            {kinds.filter(k => k.n).length > 1 && <div className="tor-kinds" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 18px 10px' }}>
              {[{ key: 'all', label: L('All', 'すべて', 'Todos'), n }, ...kinds.filter(k => k.n)].map(k => (
                <button key={k.key} type="button" onClick={() => setKind(k.key)}
                  style={{ border: '1px solid var(--border)', borderRadius: 999, padding: '5px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: kind === k.key ? 'var(--navy)' : 'var(--surface)', color: kind === k.key ? '#fff' : 'var(--text2)' }}>
                  {k.label} · {k.n}
                </button>
              ))}
            </div>}
            <div className="tor-list">
              {show('jobs') && (taken.length + noPerson.length + dayMissing.length) > 0 && kind === 'all' && <div className="tor-section">📥 {L('Jobs', '作業', 'Jobs')}</div>}
              {show('jobs') && dayMissing.map(d => (
                <article key={d.id} className="tor-item">
                  <div className="tor-item-top">
                    <div className="tor-avatar" aria-hidden="true">📋</div>
                    <div className="tor-item-main">
                      <strong>{L(`${d.missing} contract place(s) missing today`, `本日の契約 残り${d.missing}店舗`, `${d.missing} local(is) do contrato faltando hoje`)}</strong>
                      <span>{L(`${d.done} of ${d.total} done`, `${d.total}店舗中 ${d.done}完了`, `${d.done} de ${d.total} feitos`)} · {d.first.place}{d.first.personName ? ` · ${d.first.personName}` : ''} · {d.first.state === 'noJob' ? L('no job created', '作業未作成', 'sem job criado') : d.first.state === 'noPerson' ? L('nobody assigned', '担当なし', 'sem pessoa') : L('not started', '未開始', 'não iniciado')}</span>
                    </div>
                    <span className="tor-kind is-off">{L('Check', '確認', 'Conferir')}</span>
                  </div>
                  <div className="tor-actions">
                    <button type="button" className="tor-btn tor-btn-approve" onClick={openLive}>📋 {L('Open Live Track', 'ライブ追跡を開く', 'Abrir o Live Track')}</button>
                  </div>
                </article>
              ))}
              {show('jobs') && noPerson.map(p => (
                <article key={p.id} className="tor-item">
                  <div className="tor-item-top">
                    <div className="tor-avatar" aria-hidden="true">⚠️</div>
                    <div className="tor-item-main">
                      <strong>{L(`${p.count} job(s) today/tomorrow with nobody`, `今日・明日 担当なし ${p.count}件`, `${p.count} job(s) hoje/amanhã sem pessoa`)}</strong>
                      <span>{(p.first.title || '').split(' — ')[0]} · {fmtDay(p.first.scheduled_date, lang, { weekday: 'short', day: 'numeric', month: 'short' })} {String(p.first.scheduled_time || '').slice(0, 5)}</span>
                    </div>
                    <span className="tor-kind is-off">{L('Assign', '割当', 'Atribuir')}</span>
                  </div>
                  <div className="tor-actions">
                    <button type="button" className="tor-btn tor-btn-approve" onClick={openAssign}>📥 {L('Open the Pending box', '未割当ボックスを開く', 'Abrir a Caixa de Pendentes')}</button>
                  </div>
                </article>
              ))}
              {show('jobs') && taken.map(t => (
                <article key={t.id} className="tor-item">
                  <div className="tor-item-top">
                    <div className="tor-avatar" aria-hidden="true">⚡</div>
                    <div className="tor-item-main">
                      <strong>{L(`${t.employee_name || '—'} accepted the offer`, `${t.employee_name || '—'}さんがオファーを承諾`, `${t.employee_name || '—'} aceitou a oferta`)}</strong>
                      <span>{(t.title || '').split(' — ')[0]} · {fmtDay(t.scheduled_date, lang, { weekday: 'short', day: 'numeric', month: 'short' })} {String(t.scheduled_time || '').slice(0, 5)}</span>
                    </div>
                  </div>
                  <div className="tor-actions">
                    <button type="button" className="tor-btn tor-btn-approve" onClick={() => okTaken(t)}>✓ OK</button>
                  </div>
                </article>
              ))}
              {show('quotes') && (quotes.length + toBook.length + flowDone.length) > 0 && kind === 'all' && <div className="tor-section">📝 {L('Quotes', '見積もり', 'Orçamentos')}</div>}
              {show('quotes') && quotes.map(q => (
                <article key={q.id} className="tor-item">
                  <div className="tor-item-top">
                    <div className="tor-avatar" aria-hidden="true">📝</div>
                    <div className="tor-item-main">
                      <strong>{L('Quote request', '見積もり依頼', 'Pedido de orçamento')} · {q.client_name || '—'}</strong>
                      <span>{[q.location_name, q.category || String(q.description || '').slice(0, 60)].filter(Boolean).join(' · ')}</span>
                    </div>
                    <span className="tor-kind is-extra">{L('Set price', '価格設定', 'Definir preço')}</span>
                  </div>
                  <div className="tor-actions">
                    <button type="button" className="tor-btn tor-btn-approve" onClick={openQuotes}>{L('Open quote requests', '見積もり依頼を開く', 'Abrir pedidos de orçamento')}</button>
                  </div>
                </article>
              ))}
              {show('quotes') && toBook.map(q => (
                <article key={q.id} className="tor-item">
                  <div className="tor-item-top">
                    <div className="tor-avatar" aria-hidden="true">📅</div>
                    <div className="tor-item-main">
                      <strong>{L('Quote accepted', '見積承認', 'Orçamento aceito')} · {q.name || '—'}</strong>
                      <span>{[q.what, q.total ? `¥${Math.round(Number(q.total)).toLocaleString()}` : ''].filter(Boolean).join(' · ')}</span>
                    </div>
                    <span className="tor-kind is-extra">{L('Book date', '日程', 'Marcar data')}</span>
                  </div>
                  <div className="tor-actions">
                    <button type="button" className="tor-btn tor-btn-approve" onClick={() => openTrack(q)}>{L('Book and notify the worker', '予約して担当者に通知', 'Marcar e avisar o funcionário')}</button>
                  </div>
                </article>
              ))}
              {show('quotes') && flowDone.map(q => (
                <article key={q.id} className="tor-item">
                  <div className="tor-item-top">
                    <div className="tor-avatar" aria-hidden="true">🧾</div>
                    <div className="tor-item-main">
                      <strong>{L('Job done · invoice sent', '作業完了・請求書を送付', 'Serviço feito · nota enviada')}</strong>
                      <span>{[q.name, q.total ? `¥${Math.round(Number(q.total)).toLocaleString()}` : ''].filter(Boolean).join(' · ')}</span>
                    </div>
                  </div>
                  <div className="tor-actions">
                    <button type="button" className="tor-btn tor-btn-approve" onClick={() => openTrack(q)}>{L('See the follow-up', '進捗を見る', 'Ver acompanhamento')}</button>
                  </div>
                </article>
              ))}
              {show('payroll') && payroll.length > 0 && kind === 'all' && <div className="tor-section">💴 {L('Payroll', '給与', 'Folha')}</div>}
              {show('payroll') && payroll.map(pr => (
                <article key={pr.id} className="tor-item">
                  <div className="tor-item-top">
                    <div className="tor-avatar" aria-hidden="true">💴</div>
                    <div className="tor-item-main">
                      <strong>{L(`Payroll ${fmtPeriod(pr.period)}`, `${fmtPeriod(pr.period)} 給与`, `Folha ${fmtPeriod(pr.period)}`)}</strong>
                      <span>{L(`Closed automatically · staff confirm by ${pr.confirm_deadline} · pay ${pr.pay_date}`, `自動で締めました · 確認期限 ${pr.confirm_deadline} · 支払 ${pr.pay_date}`, `Fechada automaticamente · equipe confirma até ${pr.confirm_deadline} · pagamento ${pr.pay_date}`)}</span>
                    </div>
                    <span className="tor-kind is-extra">{L('Review', '要確認', 'Revisar')}</span>
                  </div>
                  <div className="tor-actions">
                    <button type="button" className="tor-btn tor-btn-approve" onClick={() => openPayroll(pr.period)}>{L('Open payslips', '明細を開く', 'Abrir holerites')}</button>
                  </div>
                </article>
              ))}
              {show('dayoff') && rows.length > 0 && kind === 'all' && <div className="tor-section">🗓 {L('Day-off requests', '休み申請', 'Pedidos de folga')}</div>}
              {show('dayoff') && rows.map(r => (
                <article key={r.id} className="tor-item">
                  <div className="tor-item-top">
                    <div className="tor-avatar" aria-hidden="true">{(r.employee_name || '?').slice(0, 1).toUpperCase()}</div>
                    <div className="tor-item-main">
                      <strong>{r.employee_name || '—'}</strong>
                      <span>{fmtDay(r.date, lang, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                    </div>
                    <span className={`tor-kind is-${r.kind}`}>{r.kind === 'off' ? L('Day off', '休み', 'Folga') : L('Extra work', '追加勤務', 'Trabalho extra')}</span>
                  </div>
                  {r.note && <p className="tor-note">“{r.note}”</p>}
                  <DayContext ctx={dayCtx[r.date]} req={r} L={L} />
                  {noteFor === r.id && (
                    <input className="tor-input" autoFocus value={notes[r.id] || ''} onChange={e => setNotes(x => ({ ...x, [r.id]: e.target.value }))} placeholder={L('Message to the employee (optional)', 'スタッフへのメッセージ（任意）', 'Mensagem para o funcionário (opcional)')} />
                  )}
                  <div className="tor-actions">
                    <button type="button" className="tor-btn tor-btn-reject" disabled={!!busy} onClick={() => decide(r, 'rejected')}>
                      {busy === r.id + 'rejected' ? '…' : <>✕ {L('Decline', '却下', 'Recusar')}</>}
                    </button>
                    <button type="button" className="tor-btn tor-btn-approve" disabled={!!busy} onClick={() => decide(r, 'approved')}>
                      {busy === r.id + 'approved' ? '…' : <>✓ {L('Approve', '承認', 'Aprovar')}</>}
                    </button>
                    {noteFor !== r.id && <button type="button" className="tor-link" onClick={() => setNoteFor(r.id)}>{L('+ Add message', '+ メッセージ', '+ Adicionar mensagem')}</button>}
                  </div>
                </article>
              ))}
              {show('offers') && offers.length > 0 && kind === 'all' && <div className="tor-section">🧽 {ft.offersTitle} · {offers.length}</div>}
              {show('offers') && offers.map(r => {
                const k = ELEMENT_KINDS[r.element_kind] || ELEMENT_KINDS.other
                return (
                  <article key={r.id} className={`tor-item fob-item st-${r.status}`}>
                    <div className="tor-item-top">
                      <div className="tor-avatar fob-avatar" aria-hidden="true">{k.icon}</div>
                      <div className="tor-item-main">
                        <strong>{fill(ft.offerTo, { task: r.task_name, client: r.client_name || r.location })}</strong>
                        <span>{r.location} · {r.element_name}</span>
                      </div>
                      <span className={`tor-kind fob-kind st-${r.status}`}>{r.task_type === 'maintenance' ? '🔧' : '🧽'} {r.status === 'overdue' ? ft.late : ft.soon}</span>
                    </div>
                    <p className="fob-when">🕒 {offerWhen(r, ft)}</p>
                    <div className="tor-actions">
                      <button type="button" className="tor-btn tor-btn-ghost" onClick={() => openStore(r)}>🏢 {ft.openStore}</button>
                      <button type="button" className="tor-btn tor-btn-approve" disabled={!!busy} onClick={() => offer(r)}>
                        {busy === r.id ? '…' : `📨 ${ft.offerClient}`}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>

            <footer className="tor-foot">
              <button type="button" className="tor-btn tor-btn-ghost" onClick={openCalendar}>🗓 {L('Open calendar', 'カレンダーを開く', 'Abrir calendário')}</button>
              <button type="button" className="tor-btn tor-btn-ghost" onClick={() => setOpen(false)}>{L('Later', 'あとで', 'Depois')}</button>
            </footer>
          </section>
        </div>
      )}
      </>, document.body)}
    </>
  )
}
