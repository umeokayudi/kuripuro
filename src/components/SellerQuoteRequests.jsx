import { useState } from 'react'
import toast from 'react-hot-toast'
import { salesPost } from '../lib/salesApi'
import { quoteCommissionState } from '../lib/contractCommission'
import { yen } from '../lib/salesPhases'

// v1.0.56 · Quote requests from the seller's clients (client portal → "ask for a quote").
// v1.0.77 · The seller can also create a quote and send it at once, priced from the AI minimum.
// The company sets its price; the seller adds an extra on top (their commission) and sends
// it to the client. Shared by the seller portal tab and the home alert card.

const COPY = {
  en: {
    title: 'Quote requests', toSend: 'Ready for you to send', waitingPrice: 'Waiting for the company price', sent: 'Sent, client deciding', accepted: 'Accepted', declined: 'Declined',
    none: 'No quote requests from your clients yet.', companyPrice: 'Company price', yourExtra: 'Your extra (¥)', clientPays: 'Client pays', yourCommission: 'Your commission',
    note: 'Note for the client (optional)', send: 'Send to the client', sentOk: 'Quote sent to the client', preferred: 'Preferred', paid: 'Paid', toReceive: 'To receive', ifAccepted: 'If accepted',
    hint: 'The company price is the minimum. Whatever you add on top is your commission when the client accepts.',
    alert: n => `${n} quote${n > 1 ? 's' : ''} ready for you to send`, alertNew: n => `${n} new quote request${n > 1 ? 's' : ''} from your clients`, open: 'Open',
    direct: '⚡ Create and send now', newQuote: '+ New quote', newTitle: 'New quote for a client', client: 'Client', pickClient: '— Choose the client —', store: 'Store', allStores: 'Whole client / no store',
    service: 'Service', servicePh: 'e.g. Grease trap, Range hood, Air conditioner', details: 'Details (size, how dirty, units…)', wanted: 'Preferred date (optional)',
    calc: '🤖 AI: calculate the company minimum', calcAgain: 'Calculate again', calculating: 'AI is calculating…', minimum: 'Company minimum (AI)', aiFrom: 'Based on', aiHistory: 'price history',
    yourPrice: 'Price for the client (¥)', belowMin: 'Below the company minimum', directHint: 'The AI sets the minimum the company accepts. Send at or above it: the difference is your extra commission.',
    sendDirect: 'Send to the client', created: 'Quote created and sent to the client', cancel: 'Cancel', noClients: 'You have no clients assigned yet. Ask the admin to put you on a client or store.',
  },
  ja: {
    title: '見積もり依頼', toSend: '送信待ち（あなた）', waitingPrice: '会社の価格待ち', sent: '送信済み・お客様検討中', accepted: '承認', declined: '見送り',
    none: 'お客様からの見積もり依頼はまだありません。', companyPrice: '会社の価格', yourExtra: '上乗せ額 (¥)', clientPays: 'お客様の支払額', yourCommission: 'あなたのコミッション',
    note: 'お客様へのメモ（任意）', send: 'お客様に送る', sentOk: 'お客様に見積もりを送りました', preferred: '希望日', paid: '支払い済み', toReceive: '受取予定', ifAccepted: '承認されたら',
    hint: '会社の価格が最低額です。上乗せした分が、お客様の承認後にあなたのコミッションになります。',
    alert: n => `送信待ちの見積もり ${n}件`, alertNew: n => `お客様からの新しい見積もり依頼 ${n}件`, open: '開く',
    direct: '⚡ 今すぐ作成して送る', newQuote: '＋ 新しい見積もり', newTitle: 'お客様への新しい見積もり', client: 'お客様', pickClient: '— お客様を選択 —', store: '店舗', allStores: '店舗指定なし',
    service: 'サービス', servicePh: '例：グリストラップ、レンジフード、エアコン', details: '詳細（広さ・汚れ具合・台数など）', wanted: '希望日（任意）',
    calc: '🤖 AIで会社の最低額を計算', calcAgain: '再計算', calculating: 'AIが計算中…', minimum: '会社の最低額（AI）', aiFrom: '根拠', aiHistory: '価格履歴',
    yourPrice: 'お客様への金額 (¥)', belowMin: '会社の最低額を下回っています', directHint: 'AIが会社の最低額を決めます。それ以上で送ると、差額があなたの追加コミッションになります。',
    sendDirect: 'お客様に送る', created: '見積もりを作成してお客様に送りました', cancel: 'キャンセル', noClients: '担当のお客様がまだいません。管理者に設定を依頼してください。',
  },
  pt: {
    title: 'Pedidos de orçamento', toSend: 'Prontos para você enviar', waitingPrice: 'Esperando o preço da empresa', sent: 'Enviados, cliente decidindo', accepted: 'Aceitos', declined: 'Recusados',
    none: 'Nenhum pedido de orçamento dos seus clientes ainda.', companyPrice: 'Preço da empresa', yourExtra: 'Seu valor a mais (¥)', clientPays: 'Cliente paga', yourCommission: 'Sua comissão',
    note: 'Nota para o cliente (opcional)', send: 'Enviar ao cliente', sentOk: 'Orçamento enviado ao cliente', preferred: 'Quer em', paid: 'Pago', toReceive: 'A receber', ifAccepted: 'Se aceitar',
    hint: 'O preço da empresa é o mínimo. O que você colocar a mais vira sua comissão quando o cliente aceitar.',
    alert: n => `${n} orçamento${n > 1 ? 's' : ''} pronto${n > 1 ? 's' : ''} para enviar`, alertNew: n => `${n} pedido${n > 1 ? 's' : ''} novo${n > 1 ? 's' : ''} de orçamento dos seus clientes`, open: 'Abrir',
    direct: '⚡ Criar e mandar agora', newQuote: '+ Novo orçamento', newTitle: 'Novo orçamento para um cliente', client: 'Cliente', pickClient: '— Escolha o cliente —', store: 'Loja', allStores: 'Cliente todo / sem loja',
    service: 'Serviço', servicePh: 'ex.: Grease trap, Coifa, Ar-condicionado', details: 'Detalhes (tamanho, sujeira, quantidade…)', wanted: 'Data desejada (opcional)',
    calc: '🤖 IA: calcular o mínimo da empresa', calcAgain: 'Calcular de novo', calculating: 'A IA está calculando…', minimum: 'Mínimo da empresa (IA)', aiFrom: 'Base', aiHistory: 'histórico de preços',
    yourPrice: 'Preço para o cliente (¥)', belowMin: 'Abaixo do mínimo da empresa', directHint: 'A IA define o mínimo que a empresa aceita. Mande com esse valor ou mais: a diferença é a sua comissão extra.',
    sendDirect: 'Enviar ao cliente', created: 'Orçamento criado e enviado ao cliente', cancel: 'Cancelar', noClients: 'Você ainda não tem clientes. Peça ao admin para colocar você num cliente ou loja.',
  },
}

const copyOf = lang => COPY[lang === 'ja' ? 'ja' : lang === 'pt' ? 'pt' : 'en']
const SERVICES = ['Grease trap', 'Range hood', 'Air conditioner', 'Deep clean', 'Floor wax', 'Windows']
const PCT = [0, 10, 20, 30]

const QUICK = [0, 5, 10, 15, 20]

export const quoteRequestsToSend = data => (data?.quoteRequests || []).filter(r => r.quote_status === 'priced')
export const quoteRequestsWaiting = data => (data?.quoteRequests || []).filter(r => !r.quote_status || r.quote_status === 'requested')

/** Home alert: shown only when something is waiting. */
export function QuoteRequestsAlert({ data, lang, onOpen }) {
  const c = copyOf(lang)
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
  const c = copyOf(lang)
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

/**
 * v1.0.77 · Price the quote without waiting for the company: the AI gives the company minimum,
 * the seller picks the client price (at or above it), the difference is their commission.
 * job = { id } for a client request, or { client_id, location_name, category, description, preferred_date } for a new one.
 */
function DirectForm({ job, lang, onDone, onCancel }) {
  const c = copyOf(lang)
  const [details, setDetails] = useState('')
  const [est, setEst] = useState(null)
  const [busy, setBusy] = useState('')
  const [price, setPrice] = useState('')
  const [note, setNote] = useState('')
  const min = Number(est?.min || 0)
  const clientPrice = Math.round(Number(price || 0))
  const extra = clientPrice - min
  const calc = async () => {
    setBusy('calc')
    try {
      const r = await salesPost('/api/sales-data', job.id ? { action: 'quote-ai-minimum', id: job.id, details } : { action: 'quote-ai-minimum', ...job, description: [job.description, details].filter(Boolean).join(' · ') }, lang)
      setEst(r)
      setPrice(String(Math.round(r.min * 1.1 / 100) * 100))
    } catch (e) { toast.error(e.message) }
    setBusy('')
  }
  const send = async () => {
    if (extra < 0) return toast.error(c.belowMin)
    setBusy('send')
    try {
      if (job.id) await salesPost('/api/sales-data', { action: 'send-client-quote', id: job.id, markup: extra, note, min_token: est.token }, lang)
      else await salesPost('/api/sales-data', { action: 'create-client-quote', ...job, description: [job.description, details].filter(Boolean).join(' · '), markup: extra, note, min_token: est.token }, lang)
      toast.success(job.id ? c.sentOk : c.created)
      await onDone?.()
    } catch (e) {
      toast.error(e.message)
      if (/expir|mudou|changed/i.test(e.message)) setEst(null)
    }
    setBusy('')
  }
  return <div className="sqr-form">
    {!est && <label className="form-group"><span>{c.details}</span><textarea rows="2" maxLength={600} value={details} onChange={e => setDetails(e.target.value)} /></label>}
    {!est ? <div className="sqr-actions">
      {onCancel && <button type="button" className="fa-btn" onClick={onCancel}>{c.cancel}</button>}
      <button type="button" className="fa-btn fa-btn-primary" disabled={busy === 'calc'} onClick={calc}>{busy === 'calc' ? c.calculating : c.calc}</button>
    </div> : <>
      <div className="sqr-ai">
        <div className="sqr-base"><span>{c.minimum}</span><strong>{yen(min)}</strong></div>
        <small>{c.aiFrom}: {est.basis === 'ai' ? est.reason : `${c.aiHistory} · ${est.reason}`}</small>
        <button type="button" className="sqr-link" disabled={busy === 'calc'} onClick={calc}>{busy === 'calc' ? c.calculating : c.calcAgain}</button>
      </div>
      <label className="form-group"><span>{c.yourPrice}</span>
        <input type="number" inputMode="numeric" min={min} step="100" value={price} onChange={e => setPrice(e.target.value)} />
      </label>
      <div className="sp-chip-row">{PCT.map(p => {
        const v = Math.round(min * (1 + p / 100) / 100) * 100
        return <button type="button" key={p} className={`fa-chip${clientPrice === v ? ' is-active' : ''}`} onClick={() => setPrice(String(v))}>+{p}%</button>
      })}</div>
      <div className="sqr-split">
        <div><span>{c.clientPays}</span><strong>{yen(clientPrice)}</strong></div>
        <div className={extra < 0 ? 'is-low' : 'is-mine'}><span>{extra < 0 ? c.belowMin : c.yourCommission}</span><strong>{yen(extra)}</strong></div>
      </div>
      <label className="form-group"><span>{c.note}</span><textarea rows="2" maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></label>
      <div className="sqr-actions">
        {onCancel && <button type="button" className="fa-btn" onClick={onCancel}>{c.cancel}</button>}
        <button type="button" className="fa-btn fa-btn-primary" disabled={busy === 'send' || extra < 0 || !clientPrice} onClick={send}>{busy === 'send' ? '…' : c.sendDirect}</button>
      </div>
    </>}
  </div>
}

function NewQuote({ data, lang, onDone, onCancel }) {
  const c = copyOf(lang)
  const clients = data?.quoteClients || []
  const [clientId, setClientId] = useState(clients.length === 1 ? clients[0].id : '')
  const [store, setStore] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState('')
  const client = clients.find(x => x.id === clientId)
  const ready = clientId && category.trim()
  if (!clients.length) return <section className="fa-card"><p className="fa-muted">{c.noClients}</p><button type="button" className="fa-btn" onClick={onCancel}>{c.cancel}</button></section>
  return <section className="fa-card sqr-new">
    <div className="fa-card-head"><h2>{c.newTitle}</h2></div>
    <div className="sqr-form">
      <label className="form-group"><span>{c.client}</span>
        <select value={clientId} onChange={e => { setClientId(e.target.value); setStore('') }}>
          <option value="">{c.pickClient}</option>
          {clients.map(x => <option key={x.id} value={x.id}>{x.company_name}</option>)}
        </select>
      </label>
      {client?.stores?.length > 0 && <label className="form-group"><span>{c.store}</span>
        <select value={store} onChange={e => setStore(e.target.value)}>
          <option value="">{c.allStores}</option>
          {client.stores.map(x => <option key={x} value={x}>{x}</option>)}
        </select>
      </label>}
      <label className="form-group"><span>{c.service}</span>
        <input value={category} maxLength={120} placeholder={c.servicePh} onChange={e => setCategory(e.target.value)} />
      </label>
      <div className="sp-chip-row">{SERVICES.map(x => <button type="button" key={x} className={`fa-chip${category === x ? ' is-active' : ''}`} onClick={() => setCategory(x)}>{x}</button>)}</div>
      <label className="form-group"><span>{c.details}</span><textarea rows="2" maxLength={600} value={description} onChange={e => setDescription(e.target.value)} /></label>
      <label className="form-group"><span>{c.wanted}</span><input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
    </div>
    {ready ? <DirectForm key={`${clientId}|${store}|${category}`} lang={lang} onDone={onDone} onCancel={onCancel}
      job={{ client_id: clientId, location_name: store || null, category: category.trim(), description: description.trim(), preferred_date: date || null }} />
      : <div className="sqr-actions"><button type="button" className="fa-btn" onClick={onCancel}>{c.cancel}</button></div>}
  </section>
}

// The client portal fills the description with "<service> — <store>" when the client types nothing;
// that only repeats the title and the service line, so it is not shown again.
const ownText = row => {
  let rest = String(row.description || '')
  for (const part of [row.category, row.location_name]) if (part) rest = rest.split(part).join('')
  return rest.replace(/[\s—–\-·:,/]+/g, '') ? row.description : ''
}

function Row({ row, lang, children, right }) {
  const c = copyOf(lang)
  return <article className="sqr-row">
    <div className="sqr-row-top">
      <div className="sqr-row-text">
        <strong>{[row.client_name, row.location_name].filter(Boolean).join(' · ') || '—'}</strong>
        <small>{[row.category, String(row.created_at || '').slice(0, 10), row.preferred_date && `${c.preferred} ${row.preferred_date}`].filter(Boolean).join(' · ')}</small>
      </div>
      {right}
    </div>
    {ownText(row) && <p className="sqr-desc">{row.description}</p>}
    {children}
  </article>
}

export default function SellerQuoteRequests({ data, lang, onChanged }) {
  const c = copyOf(lang)
  const [creating, setCreating] = useState(false)
  const [directId, setDirectId] = useState('')
  const top = !creating && <div className="sqr-top">
    <p className="fa-muted">{c.directHint}</p>
    <button type="button" className="fa-btn fa-btn-primary" onClick={() => setCreating(true)}>{c.newQuote}</button>
  </div>
  const newForm = creating && <NewQuote data={data} lang={lang} onCancel={() => setCreating(false)} onDone={async () => { setCreating(false); await onChanged?.() }} />
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
  if (!rows.length) return <>{top}{newForm}{!creating && <section className="fa-card"><p className="fa-muted">{c.none}</p></section>}</>
  return <>
    {top}
    {newForm}
    {toSend.length > 0 && <section className="fa-card">
      <div className="fa-card-head"><h2>{c.toSend}</h2><span className="fa-pill is-alert">{toSend.length}</span></div>
      <p className="fa-muted">{c.hint}</p>
      {toSend.map(r => <Row key={r.id} row={r} lang={lang}><SendForm row={r} lang={lang} onSent={onChanged} /></Row>)}
    </section>}
    {waiting.length > 0 && <section className="fa-card">
      <div className="fa-card-head"><h2>{c.waitingPrice}</h2><span className="fa-pill">{waiting.length}</span></div>
      {waiting.map(r => <Row key={r.id} row={r} lang={lang}>
        {directId === r.id
          ? <DirectForm job={{ id: r.id }} lang={lang} onCancel={() => setDirectId('')} onDone={async () => { setDirectId(''); await onChanged?.() }} />
          : <button type="button" className="fa-btn sqr-direct" onClick={() => setDirectId(r.id)}>{c.direct}</button>}
      </Row>)}
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
