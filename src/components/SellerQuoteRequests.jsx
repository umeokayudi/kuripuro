import { useState } from 'react'
import toast from 'react-hot-toast'
import { salesPost } from '../lib/salesApi'
import { quoteCommissionState } from '../lib/contractCommission'
import { yen } from '../lib/salesPhases'

// v1.0.56 · Quote requests from the seller's clients (client portal → "ask for a quote").
// The company sets its price; the seller adds an extra on top (their commission) and sends
// it to the client. Shared by the seller portal tab and the home alert card.

const COPY = {
  en: {
    title: 'Quote requests', toSend: 'Ready for you to send', waitingPrice: 'Waiting for the company price', sent: 'Sent, client deciding', accepted: 'Accepted', declined: 'Declined',
    none: 'No quote requests from your clients yet.', companyPrice: 'Company price', yourExtra: 'Your extra (¥)', clientPays: 'Client pays', yourCommission: 'Your commission',
    note: 'Note for the client (optional)', send: 'Send to the client', sentOk: 'Quote sent to the client', preferred: 'Preferred', paid: 'Paid', toReceive: 'To receive', ifAccepted: 'If accepted',
    hint: 'The company price is the minimum. Whatever you add on top is your commission when the client accepts.',
    alert: n => `${n} quote${n > 1 ? 's' : ''} ready for you to send`, alertNew: n => `${n} new quote request${n > 1 ? 's' : ''} from your clients`, open: 'Open',
  },
  ja: {
    title: '見積もり依頼', toSend: '送信待ち（あなた）', waitingPrice: '会社の価格待ち', sent: '送信済み・お客様検討中', accepted: '承認', declined: '見送り',
    none: 'お客様からの見積もり依頼はまだありません。', companyPrice: '会社の価格', yourExtra: '上乗せ額 (¥)', clientPays: 'お客様の支払額', yourCommission: 'あなたのコミッション',
    note: 'お客様へのメモ（任意）', send: 'お客様に送る', sentOk: 'お客様に見積もりを送りました', preferred: '希望日', paid: '支払い済み', toReceive: '受取予定', ifAccepted: '承認されたら',
    hint: '会社の価格が最低額です。上乗せした分が、お客様の承認後にあなたのコミッションになります。',
    alert: n => `送信待ちの見積もり ${n}件`, alertNew: n => `お客様からの新しい見積もり依頼 ${n}件`, open: '開く',
  },
}

const QUICK = [0, 5, 10, 15, 20]

export const quoteRequestsToSend = data => (data?.quoteRequests || []).filter(r => r.quote_status === 'priced')
export const quoteRequestsWaiting = data => (data?.quoteRequests || []).filter(r => !r.quote_status || r.quote_status === 'requested')

/** Home alert: shown only when something is waiting. */
export function QuoteRequestsAlert({ data, lang, onOpen }) {
  const c = COPY[lang === 'ja' ? 'ja' : 'en']
  const toSend = quoteRequestsToSend(data).length
  const waiting = quoteRequestsWaiting(data).length
  if (!toSend && !waiting) return null
  return <button type="button" className={`sp-bell-item sqr-alert${toSend ? ' is-alert' : ''}`} onClick={onOpen}>
    <span aria-hidden="true">📝</span>
    <div><strong>{toSend ? c.alert(toSend) : c.alertNew(waiting)}</strong><small>{toSend && waiting ? c.alertNew(waiting) : c.hint}</small></div>
    <b>›</b>
  </button>
}

function SendForm({ row, lang, onSent }) {
  const c = COPY[lang === 'ja' ? 'ja' : 'en']
  const base = Number(row.base_amount || 0)
  const [extra, setExtra] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const markup = Math.max(0, Math.round(Number(extra || 0)))
  const send = async () => {
    setBusy(true)
    try {
      await salesPost('/api/sales-data', { action: 'send-client-quote', id: row.id, markup, note }, lang)
      toast.success(c.sentOk)
      await onSent?.()
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }
  return <div className="sqr-form">
    <div className="sqr-base"><span>{c.companyPrice}</span><strong>{yen(base)}</strong></div>
    <label className="form-group"><span>{c.yourExtra}</span>
      <input type="number" inputMode="numeric" min="0" step="100" value={extra} placeholder="0" onChange={e => setExtra(e.target.value)} />
    </label>
    <div className="sp-chip-row">{QUICK.map(p => <button type="button" key={p} className={`fa-chip${markup === Math.round(base * p / 100) && (p || extra !== '') ? ' is-active' : ''}`} onClick={() => setExtra(String(Math.round(base * p / 100)))}>+{p}%</button>)}</div>
    <div className="sqr-split">
      <div><span>{c.clientPays}</span><strong>{yen(base + markup)}</strong></div>
      <div className="is-mine"><span>{c.yourCommission}</span><strong>{yen(markup)}</strong></div>
    </div>
    <label className="form-group"><span>{c.note}</span><textarea rows="2" maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></label>
    <button type="button" className="fa-btn fa-btn-primary fa-btn-block" disabled={busy} onClick={send}>{busy ? '…' : c.send}</button>
  </div>
}

function Row({ row, lang, children, right }) {
  const c = COPY[lang === 'ja' ? 'ja' : 'en']
  return <article className="sqr-row">
    <div className="sqr-row-top">
      <div className="sqr-row-text">
        <strong>{[row.client_name, row.location_name].filter(Boolean).join(' · ') || '—'}</strong>
        <small>{[row.category, String(row.created_at || '').slice(0, 10), row.preferred_date && `${c.preferred} ${row.preferred_date}`].filter(Boolean).join(' · ')}</small>
      </div>
      {right}
    </div>
    {row.description && row.description !== row.category && <p className="sqr-desc">{row.description}</p>}
    {children}
  </article>
}

export default function SellerQuoteRequests({ data, lang, onChanged }) {
  const c = COPY[lang === 'ja' ? 'ja' : 'en']
  const rows = data?.quoteRequests || []
  const toSend = quoteRequestsToSend(data)
  const waiting = quoteRequestsWaiting(data)
  const sent = rows.filter(r => r.quote_status === 'quoted')
  const done = rows.filter(r => r.quote_status === 'accepted' || r.quote_status === 'declined')
  const commission = r => {
    const state = quoteCommissionState(r)
    if (state === 'none' || state === 'void') return null
    return <span className={`fa-pill${state === 'paid' ? ' is-active' : state === 'earned' ? ' is-pending_review' : ''}`}>{state === 'paid' ? c.paid : state === 'earned' ? c.toReceive : c.ifAccepted} {yen(r.seller_markup)}</span>
  }
  if (!rows.length) return <section className="fa-card"><div className="fa-card-head"><h2>{c.title}</h2></div><p className="fa-muted">{c.none}</p></section>
  return <>
    {toSend.length > 0 && <section className="fa-card">
      <div className="fa-card-head"><h2>{c.toSend}</h2><span className="fa-pill is-alert">{toSend.length}</span></div>
      <p className="fa-muted">{c.hint}</p>
      {toSend.map(r => <Row key={r.id} row={r} lang={lang}><SendForm row={r} lang={lang} onSent={onChanged} /></Row>)}
    </section>}
    {waiting.length > 0 && <section className="fa-card">
      <div className="fa-card-head"><h2>{c.waitingPrice}</h2><span className="fa-pill">{waiting.length}</span></div>
      {waiting.map(r => <Row key={r.id} row={r} lang={lang} />)}
    </section>}
    {sent.length > 0 && <section className="fa-card">
      <div className="fa-card-head"><h2>{c.sent}</h2><span className="fa-pill">{sent.length}</span></div>
      {sent.map(r => <Row key={r.id} row={r} lang={lang} right={<b className="sqr-amount">{yen(r.quote_amount)}</b>}>{commission(r)}</Row>)}
    </section>}
    {done.length > 0 && <section className="fa-card">
      <div className="fa-card-head"><h2>{c.accepted} / {c.declined}</h2></div>
      {done.map(r => <Row key={r.id} row={r} lang={lang} right={<span className={`fa-pill${r.quote_status === 'accepted' ? ' is-active' : ''}`}>{r.quote_status === 'accepted' ? c.accepted : c.declined}</span>}>
        <div className="sqr-done"><b>{yen(r.quote_amount)}</b>{commission(r)}</div>
      </Row>)}
    </section>}
  </>
}
