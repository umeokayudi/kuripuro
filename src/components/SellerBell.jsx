// v1.0.234 · The seller's bell works like the admin's: ONE ordered list "Waiting for you" and the
// badge is its real size. Order: quotes to send → quote requests waiting for the office price →
// clients needing a follow-up → services to offer → messages from the office.
import { pickLang } from '../hooks/useLang'
import { quoteRequestsToSend, quoteRequestsWaiting } from './SellerQuoteRequests'
import SalesInbox from './SalesInbox'

export function sellerBellQueue({ data, alerts = [], offersTodo = [], lang }) {
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const items = []
  for (const r of quoteRequestsToSend(data)) items.push({ id: `qs${r.id}`, tone: 'red', kind: L('Quote ready to send', '送信待ちの見積', 'Orçamento pronto para enviar'), title: r.client_name || r.location_name || '—', sub: [r.location_name, r.description].filter(Boolean).join(' · ').slice(0, 120), go: 'quotes', action: L('Add my extra and send', '上乗せして送信', 'Pôr meu extra e enviar') })
  for (const r of quoteRequestsWaiting(data)) items.push({ id: `qw${r.id}`, tone: 'amber', kind: L('Quote request', '見積依頼', 'Pedido de orçamento'), title: r.client_name || r.location_name || '—', sub: L('Waiting for the office price', '事務所の価格待ち', 'Aguardando o preço do escritório'), go: 'quotes', action: L('Open', '開く', 'Abrir') })
  for (const a of alerts) {
    const expired = a.reasons.includes('quote_expired')
    items.push({
      id: `f${a.lead.id}`, tone: expired ? 'red' : 'amber', kind: expired ? L('Quote expired', '見積期限切れ', 'Orçamento vencido') : L('No contact', '連絡なし', 'Sem contato'),
      title: a.lead.company_name || '—',
      sub: a.sinceContact != null ? L(`${a.sinceContact} days without contact`, `${a.sinceContact}日間連絡なし`, `${a.sinceContact} dias sem contato`) : L('Never contacted', '未連絡', 'Nunca contatado'),
      go: 'followups', lead: a.lead, action: L('Open client', '顧客を開く', 'Abrir cliente'),
    })
  }
  for (const o of offersTodo) items.push({ id: `o${o.id || `${o.task_name}${o.location}`}`, tone: 'blue', kind: L('Service to offer', '提案するサービス', 'Serviço para oferecer'), title: o.client_name || o.location || '—', sub: o.task_name || '', go: 'offers', action: L('See', '見る', 'Ver') })
  return items
}

export const sellerBellCount = ({ data, alerts, offersTodo }) => quoteRequestsToSend(data).length + quoteRequestsWaiting(data).length + (alerts?.length || 0) + (offersTodo?.length || 0) + (data?.notifications?.length || 0)

export default function SellerBell({ data, alerts, offersTodo, lang, onGo, onOpenLead, onChanged }) {
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const items = sellerBellQueue({ data, alerts, offersTodo, lang })
  const total = items.length + (data?.notifications?.length || 0)
  return (
    <div className="sb-bell">
      <div className="bq-head" style={{ padding: '0 0 8px' }}><h2>{L('Waiting for you', '対応待ち', 'Aguardando você')} <span className="bq-group-n">{total}</span></h2></div>
      {!total && <p className="fa-muted">{L('Nothing waiting. All clear.', '対応待ちはありません。', 'Nada esperando. Tudo em dia.')}</p>}
      {items.slice(0, 30).map((it, i) => (
        <div key={it.id} className={`bq-card tone-${it.tone}`}>
          <span className="bq-kind">{i + 1} · {it.kind}</span>
          <span className="bq-title">{it.title}</span>
          {it.sub && <span className="bq-sub">{it.sub}</span>}
          <div className="bq-actions"><button type="button" className="tor-btn tor-btn-primary tor-btn-sm" onClick={() => (it.lead && onOpenLead ? onOpenLead(it.lead) : onGo(it.go))}>{it.action}</button></div>
        </div>
      ))}
      {items.length > 30 && <p className="fa-muted">{L(`+ ${items.length - 30} more in Follow-ups`, `他 ${items.length - 30}件`, `+ ${items.length - 30} em Follow-ups`)}</p>}
      <SalesInbox lang={lang} notifications={data?.notifications || []} onChanged={onChanged} onOpenLead={id => { const row = (data?.leads || []).find(l => l.id === id); if (row) onOpenLead?.(row) }} />
    </div>
  )
}
