import { commissionState, sellerCommissionSummary } from '../lib/contractCommission'

// Seller portal: the contracts this seller is linked to and the commission each one pays.
const COPY = {
  en: { title: 'My contract commissions', due: 'To receive', paid: 'Received', pending: 'Awaiting approval', monthly: 'Fixed locations / month', spot: 'Spot', fixed: 'Fixed', perMonth: '/month', none: 'No contract linked to you yet.', states: { pending: 'awaiting approval', earned: 'to receive', paid: 'received', void: 'cancelled' } },
  ja: { title: '契約コミッション', due: '受取予定', paid: '受取済み', pending: '承認待ち', monthly: '定期契約（月額）', spot: 'スポット', fixed: '定期', perMonth: '/月', none: '紐づいた契約はまだありません。', states: { pending: '承認待ち', earned: '受取予定', paid: '受取済み', void: '取消' } },
  pt: { title: 'Comissões dos meus contratos', due: 'A receber', paid: 'Recebido', pending: 'Aguardando aprovação', monthly: 'Locais fixos / mês', spot: 'Avulso', fixed: 'Fixo', perMonth: '/mês', none: 'Nenhum contrato vinculado a você ainda.', states: { pending: 'aguardando aprovação', earned: 'a receber', paid: 'recebido', void: 'cancelado' } },
}
const yen = v => `¥${Math.round(Number(v || 0)).toLocaleString()}`

export default function SellerContractCommissions({ data, lang = 'en' }) {
  const c = COPY[lang === 'ja' ? 'ja' : lang === 'pt' ? 'pt' : 'en']
  const spot = data?.contractCommissions?.spot || []
  const fixed = data?.contractCommissions?.fixed || []
  const sum = sellerCommissionSummary(spot, fixed)
  return (
    <div className="card">
      <div className="card-title">💼 {c.title}</div>
      <div className="sales-manager-mini-metrics" style={{ marginBottom: 8 }}>
        {[[c.due, yen(sum.earned)], [c.pending, yen(sum.pending)], [c.paid, yen(sum.paid)], [c.monthly, yen(sum.monthly)]].map(([label, value]) => <span key={label}><b>{value}</b>{label}</span>)}
      </div>
      {spot.map(row => (
        <div className="sales-row" key={row.id}><div>
          <strong>⚡ {row.location_name}</strong>
          <small>{c.spot} · {row.service_date || '—'} · {row.contract_number} · {yen(row.commission_amount)} · {c.states[commissionState(row)] || ''}</small>
        </div></div>
      ))}
      {fixed.map(row => (
        <div className="sales-row" key={row.id}><div>
          <strong>📋 {row.location_name}</strong>
          <small>{c.fixed} · {row.service_type || ''} · {yen(row.commission_amount)}{c.perMonth}</small>
        </div></div>
      ))}
      {!spot.length && !fixed.length && <p className="sales-muted">{c.none}</p>}
    </div>
  )
}
