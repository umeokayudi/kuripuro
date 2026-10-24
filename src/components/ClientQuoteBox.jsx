import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang, fill, pickLang } from '../hooks/useLang'
import { salesPost } from '../lib/salesApi'
import { quoteCommissionState } from '../lib/contractCommission'
import { QUOTE_REQUESTS_CHANGED } from '../lib/quoteRequests'
import { quoteSellerFor } from '../lib/quoteSeller'

const yen = (n) => `¥${Math.round(Number(n || 0)).toLocaleString()}`

/**
 * Admin box of one client quote request (price → seller → client, commission, follow-up).
 * Used in Client feedback → Requests and in Quotes → Client requests (v1.0.70).
 * contracts: service_contracts rows with salesperson_id, to find the store's seller.
 * presetNote: text for the note field (StoreDossier "use summary").
 */
export default function ClientQuoteBox({ row, clients, contracts, sellers, onChanged, onTrack, presetNote }) {
  const { t, lang } = useLang()
  const f = t.feedback
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const [draft, setDraft] = useState({})
  const [assign, setAssign] = useState({ id: '', whole: true })
  const [busy, setBusy] = useState(false)
  // "use summary" from the store file fills the note
  useEffect(() => { if (presetNote) setDraft(d => ({ ...d, note: presetNote })) }, [presetNote])

  const client = clients.find(c => c.id === row.client_id)
  const qs = row.quote_status || 'requested'
  const accountSeller = quoteSellerFor(row, client, contracts)
  const sellerName = (id) => sellers.find(p => p.id === id)?.full_name || '—'
  const markup = Number(row.seller_markup || 0)
  const commState = quoteCommissionState(row)
  const open = qs === 'requested' || qs === 'priced' || (qs === 'quoted' && !markup)
  const done = () => { window.dispatchEvent(new Event(QUOTE_REQUESTS_CHANGED)); onChanged?.() }

  const sendQuote = async () => {
    const amount = Number(draft.amount ?? row.quote_amount)
    if (!amount) return toast.error(f.quoteAmount)
    const { error } = await supabase.from('client_requests').update({
      quote_amount: amount, quote_note: (draft.note ?? row.quote_note ?? '').trim() || null,
      quote_status: 'quoted', quoted_at: new Date().toISOString(),
    }).eq('id', row.id)
    if (error) return toast.error(error.message)
    toast.success(f.quoteSentAdmin)
    done()
  }

  // v1.0.56 · Company price → seller (adds their extra = commission) → client.
  const priceQuote = async (direct) => {
    const base = Number(draft.amount ?? row.base_amount ?? row.quote_amount)
    if (!base) return toast.error(f.companyPrice)
    try {
      const r = await salesPost('/api/sales-data', { action: 'price-client-quote', id: row.id, base_amount: base, note: draft.note ?? row.quote_note ?? '', direct }, lang)
      toast.success(r.to_seller ? f.sentToSeller : f.quoteSentAdmin)
    } catch (e) {
      // Without the admin server session (or before the v1.0.56 SQL) the client still gets the quote.
      if (!direct && accountSeller) return toast.error(e.message)
      return sendQuote()
    }
    done()
  }

  // v1.0.70 · Pick the seller when the store has none yet (so the seller sees the request).
  const assignSeller = async () => {
    if (!assign.id) return
    setBusy(true)
    try {
      await salesPost('/api/sales-data', { action: 'assign-client-quote', id: row.id, salesperson_id: assign.id, whole_client: assign.whole }, lang)
      toast.success(L(`${sellerName(assign.id)} now sees this request.`, `${sellerName(assign.id)} さんに表示されます。`, `${sellerName(assign.id)} agora vê este pedido.`))
      done()
    } catch (e) {
      toast.error(e.message)
    }
    setBusy(false)
  }

  const markCommissionPaid = async () => {
    const { error } = await supabase.from('client_requests').update({ commission_paid_at: new Date().toISOString() }).eq('id', row.id)
    if (error) return toast.error(error.message)
    toast.success(f.saved)
    done()
  }

  const followLabel = row.status === 'completed' ? L('Done · see invoice', '完了・請求書を見る', 'Feito · ver nota')
    : row.status === 'scheduled' ? L('Scheduled · follow up', '予約済み・進捗を見る', 'Agendado · acompanhar')
      : L('Book the date and follow up', '日程を決めて進める', 'Marcar a data e acompanhar')

  return (
    <div style={{ padding: 12, borderRadius: 10, background: 'var(--blue-bg)', marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8, fontSize: 12, fontWeight: 700 }}>
        <span>{f.quoteRequest}{row.category ? ` · ${row.category}` : ''}</span>
        <span className={`badge ${qs === 'accepted' ? 'badge-green' : qs === 'declined' ? 'badge-red' : qs === 'priced' ? 'badge-amber' : 'badge-blue'}`}>{f[`qs_${qs}`] || qs}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
        {accountSeller ? `${f.accountSeller}: ${sellerName(accountSeller)}` : f.noSeller}
      </div>
      {!accountSeller && open && qs !== 'quoted' && sellers.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8, fontSize: 12 }}>
          <select value={assign.id} onChange={e => setAssign(a => ({ ...a, id: e.target.value }))} style={{ minWidth: 160, flex: '1 1 160px' }}>
            <option value="">{L('Choose the seller…', '営業担当を選ぶ…', 'Escolher o vendedor…')}</option>
            {sellers.filter(p => p.is_active !== false).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11 }}>
            <input type="checkbox" checked={assign.whole} onChange={e => setAssign(a => ({ ...a, whole: e.target.checked }))} />
            {L('for the whole client', 'この顧客全体に', 'para o cliente todo')}
          </label>
          <button type="button" className="btn btn-sm" disabled={!assign.id || busy} onClick={assignSeller}>{L('Assign', '割り当て', 'Atribuir')}</button>
        </div>
      )}
      {qs === 'priced' && <div style={{ fontSize: 12, marginBottom: 8 }}>{fill(f.withSeller, { name: sellerName(row.salesperson_id), base: yen(row.base_amount) })}</div>}
      {row.base_amount != null && ['quoted', 'accepted', 'declined'].includes(qs) && (
        <div style={{ fontSize: 12, marginBottom: 8 }}>{fill(f.priceSplit, { base: yen(row.base_amount), markup: yen(markup), total: yen(row.quote_amount) })}{row.salesperson_id ? ` · ${sellerName(row.salesperson_id)}` : ''}</div>
      )}
      {row.base_amount == null && row.quote_amount != null && ['quoted', 'accepted', 'declined'].includes(qs) && (
        <div style={{ fontSize: 12, marginBottom: 8 }}>{yen(row.quote_amount)}</div>
      )}
      {commState !== 'none' && commState !== 'void' && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, fontSize: 12, marginBottom: 8 }}>
          <span>{f.commission}: <b>{yen(markup)}</b> · {commState === 'paid' ? f.commissionPaid : commState === 'pending' ? f.commissionWaiting : ''}</span>
          {commState === 'earned' && <button className="btn btn-sm" onClick={markCommissionPaid}>{f.markCommissionPaid}</button>}
        </div>
      )}
      {open && (
        <div className="fb-quote-form">
          <label style={{ fontSize: 11 }}>{accountSeller ? f.companyPrice : f.quoteAmount}
            <input type="number" min="0" value={draft.amount ?? row.base_amount ?? row.quote_amount ?? ''} onChange={e => setDraft(d => ({ ...d, amount: e.target.value }))} style={{ width: '100%' }} />
          </label>
          <label style={{ fontSize: 11 }}>{f.quoteNote}
            <input value={draft.note ?? row.quote_note ?? ''} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} style={{ width: '100%' }} />
          </label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {accountSeller && qs === 'requested' && <button className="btn btn-sm btn-primary" title={f.toSellerHint} onClick={() => priceQuote(false)}>{f.toSeller}</button>}
            <button className={`btn btn-sm${accountSeller && qs === 'requested' ? '' : ' btn-primary'}`} onClick={() => priceQuote(true)}>{accountSeller ? f.sendDirect : f.sendQuote}</button>
          </div>
        </div>
      )}
      {accountSeller && qs === 'requested' && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>{f.toSellerHint}</div>}
      {qs === 'accepted' && onTrack && (
        <button type="button" className={`btn btn-sm${row.status === 'scheduled' || row.status === 'completed' ? '' : ' btn-primary'}`} style={{ marginTop: 4 }} onClick={() => onTrack({ ...row, account_seller_id: accountSeller }, client)}>
          📅 {followLabel}
        </button>
      )}
    </div>
  )
}
