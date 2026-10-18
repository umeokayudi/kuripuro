import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useLang, pickLang } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { fetchPendingTimeOff, decideTimeOff, TIME_OFF_CHANGED } from '../lib/timeOff'
import { fetchAutoClosedPeriods, PAYROLL_CHANGED } from '../lib/payrollAlerts'
import { fetchPendingQuoteRequests, QUOTE_REQUESTS_CHANGED } from '../lib/quoteRequests'
import { fmtPeriod } from '../lib/salaryPeriod'
import { fmtDay } from './AvailabilityPlanner'
import { fetchDayContext } from '../lib/dayContext'
import DayContext from './DayContext'

const SEEN_KEY = 'kp_timeoff_seen_v1'
const readSeen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')) } catch { return new Set() } }
const writeSeen = (ids) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...ids].slice(-500))) } catch { /* private mode */ } }

// Admin topbar: bell with the number of pending day-off requests (plus payroll months the
// cron closed automatically and client quote requests waiting for a price), a small alert
// when new ones arrive, and a pop-up to approve / reject each request or open the page.
export default function TimeOffCenter() {
  const { lang } = useLang()
  const L = (en, jaText, pt) => pickLang(lang, en, jaText, pt)
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(false)
  const [newQuotes, setNewQuotes] = useState([])
  const [toastOpen, setToastOpen] = useState(false)
  const [busy, setBusy] = useState(null)
  const [noteFor, setNoteFor] = useState(null)
  const [notes, setNotes] = useState({})
  const [dayCtx, setDayCtx] = useState({})
  const [payroll, setPayroll] = useState([])
  const [quotes, setQuotes] = useState([])
  const seen = useRef(readSeen())

  const load = () => Promise.all([
    fetchPendingTimeOff(tokyoToday()).catch(() => []),
    fetchAutoClosedPeriods().catch(() => []),
    fetchPendingQuoteRequests().catch(() => []),
  ]).then(([list, periods, quoteRows]) => {
    setRows(list)
    setPayroll(periods)
    setQuotes(quoteRows)
    // Alert only once per item, ever: after that the number stays in the side menu until it is resolved
    const fresh = [...list, ...periods, ...quoteRows].filter(r => !seen.current.has(r.id))
    if (fresh.length) {
      setNewQuotes(quoteRows.filter(q => fresh.includes(q)))
      fresh.forEach(r => seen.current.add(r.id))
      writeSeen(seen.current)
      setToastOpen(true)
    }
  })

  useEffect(() => {
    load()
    const id = setInterval(load, 60000)
    window.addEventListener(TIME_OFF_CHANGED, load)
    window.addEventListener(PAYROLL_CHANGED, load)
    window.addEventListener(QUOTE_REQUESTS_CHANGED, load)
    return () => { clearInterval(id); window.removeEventListener(TIME_OFF_CHANGED, load); window.removeEventListener(PAYROLL_CHANGED, load); window.removeEventListener(QUOTE_REQUESTS_CHANGED, load) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // The pop-up alert goes away on its own; the bell and the side-menu numbers stay.
  useEffect(() => {
    if (!toastOpen) return
    const id = setTimeout(() => setToastOpen(false), 12000)
    return () => clearTimeout(id)
  }, [toastOpen])

  const markSeen = () => {
    rows.concat(payroll, quotes).forEach(r => seen.current.add(r.id))
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
  const openQuotes = () => { setOpen(false); markSeen(); navigate('/client-feedback?tab=requests') }
  const n = rows.length + payroll.length + quotes.length

  return (
    <>
      <button type="button" className={`ref-top-action tor-bell${n ? ' has-items' : ''}`} onClick={openPopup}
        title={n ? L(`${n} item(s) waiting`, `確認待ち ${n}件`, `${n} item(ns) aguardando`) : L('No requests waiting', '承認待ちはありません', 'Nenhum pedido aguardando')}
        aria-label={L('Day-off requests', '休み申請', 'Pedidos de folga')}>
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
      {toastOpen && newQuotes.length === 0 && payroll.length > 0 && !open && (
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
      {toastOpen && newQuotes.length === 0 && payroll.length === 0 && rows.length > 0 && !open && (
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
          <section className="tor-modal" role="dialog" aria-modal="true" aria-label={L('Day-off requests', '休み申請', 'Pedidos de folga')} onClick={e => e.stopPropagation()}>
            <header className="tor-head">
              <div>
                <h2>{quotes.length && !rows.length ? L('Waiting for you', '確認待ち', 'Aguardando você') : L('Day-off requests', '休み申請', 'Pedidos de folga')}</h2>
                <p>{n ? L(`${n} waiting for you`, `${n}件が確認待ち`, `${n} aguardando você`) : L('Nothing waiting. All caught up.', '承認待ちはありません。', 'Nada pendente. Tudo em dia.')}</p>
              </div>
              <button type="button" className="tor-close" onClick={() => setOpen(false)} aria-label={L('Close', '閉じる', 'Fechar')}>×</button>
            </header>

            <div className="tor-list">
              {quotes.map(q => (
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
              {payroll.map(pr => (
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
              {rows.map(r => (
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
