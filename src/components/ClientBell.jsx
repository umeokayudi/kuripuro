// v1.0.191 · Client portal bell: everything that is new or waiting for the client in one list
// (same notices that also arrive as push). Badge = items not seen yet on this device.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { pickLang } from '../hooks/useLang'
import { invoiceState } from '../lib/clientCare'

const yen = v => `¥${Math.round(Number(v) || 0).toLocaleString('ja-JP')}`
const dm = d => (d && d.length >= 10 ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '')
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }

/** Builds the client's bell items. Each: { id, icon, tone, title, sub, tab }. */
export function clientBellItems({ lang, today, invoices = [], unreadMsgs = 0, lastAdminMsg = null, requests = [], complaints = [], reports = [], jobs = [], placeOf = j => j.title, unratedCount = 0, facilityRecs = [], maintAlerts = [], quoteDocs = [] }) {
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const out = []
  for (const inv of invoices) {
    const st = invoiceState(inv, today)
    if (st === 'overdue') out.push({ id: `inv-over:${inv.id}`, icon: '!', tone: 'bad', tab: 'billing', title: L('Invoice overdue', '支払期限を過ぎた請求書', 'Fatura vencida'), sub: [yen(inv.total), inv.due_date ? L(`due ${dm(inv.due_date)}`, `期限 ${dm(inv.due_date)}`, `venceu ${dm(inv.due_date)}`) : ''].filter(Boolean).join(' · ') })
    else if (st === 'open') out.push({ id: `inv:${inv.id}`, icon: '🧾', tone: 'info', tab: 'billing', title: L('New invoice', '新しい請求書', 'Nova fatura'), sub: [yen(inv.total), inv.due_date ? L(`due ${dm(inv.due_date)}`, `期限 ${dm(inv.due_date)}`, `vence ${dm(inv.due_date)}`) : ''].filter(Boolean).join(' · ') })
  }
  if (unreadMsgs > 0) out.push({ id: `msg:${lastAdminMsg?.id || unreadMsgs}`, icon: '💬', tone: 'info', tab: 'chat', title: L(`${unreadMsgs} new message${unreadMsgs > 1 ? 's' : ''} from KuriPuro`, `KuriPuroから新着メッセージ ${unreadMsgs}件`, unreadMsgs > 1 ? `${unreadMsgs} mensagens novas da KuriPuro` : 'Mensagem nova da KuriPuro'), sub: String(lastAdminMsg?.content || '').replace(/\s+/g, ' ').slice(0, 80) })
  // v1.0.211 · 見積書 sent by the office and still waiting for the client's answer
  for (const q of quoteDocs) {
    if (q.status === 'sent' && !(q.valid_until && String(q.valid_until) < String(today))) out.push({ id: `mit:${q.id}`, icon: '📝', tone: 'info', tab: 'requests', title: L('A quote is waiting for your answer', 'お見積もりのご回答をお願いします', 'Orçamento aguardando sua resposta'), sub: [q.quote_number, q.site_name].filter(Boolean).join(' · ') })
  }
  for (const rq of requests) {
    if (rq.quote_status === 'quoted') out.push({ id: `quote:${rq.id}`, icon: '📝', tone: 'info', tab: 'requests', title: L('Your quote is ready', 'お見積もりが届きました', 'Seu orçamento está pronto'), sub: [rq.location_name, rq.category || String(rq.description || '').slice(0, 50)].filter(Boolean).join(' · ') })
    else if (rq.status === 'completed' && rq.completed_at && rq.completed_at.slice(0, 10) >= addDays(today, -7)) out.push({ id: `req-done:${rq.id}`, icon: '✅', tone: 'good', tab: 'requests', title: L('Request completed', 'ご依頼が完了しました', 'Pedido concluído'), sub: rq.location_name || '' })
  }
  for (const cp of complaints) {
    if (cp.admin_response) out.push({ id: `comp:${cp.id}:${cp.status || ''}`, icon: '💬', tone: 'info', tab: 'complaints', title: L('Answer to your report', 'ご指摘への回答', 'Resposta à sua reclamação'), sub: String(cp.admin_response).replace(/\s+/g, ' ').slice(0, 80), old: (cp.created_at || '').slice(0, 10) < addDays(today, -30) })
  }
  for (const r of reports) out.push({ id: `rep:${r.id}`, icon: '📄', tone: 'info', tab: 'reports', title: L('New service report', '新しい作業報告書', 'Novo relatório de serviço'), sub: [r.title, r.work_date ? dm(r.work_date) : ''].filter(Boolean).join(' · ') })
  const recentDone = jobs.filter(j => j.status === 'completed' && j.scheduled_date >= addDays(today, -2) && j.scheduled_date <= today)
  for (const j of recentDone.slice(0, 6)) out.push({ id: `done:${j.id}`, icon: '✨', tone: 'good', tab: 'visits', title: L('Cleaning finished', '清掃が完了しました', 'Limpeza concluída'), sub: [placeOf(j), dm(j.scheduled_date)].filter(Boolean).join(' · ') })
  if (unratedCount > 0) out.push({ id: `rate:${unratedCount}:${recentDone[0]?.id || ''}`, icon: '★', tone: 'warn', tab: 'visits', title: L('Rate your cleanings', '清掃を評価してください', 'Avalie suas limpezas'), sub: L(`${unratedCount} visit${unratedCount > 1 ? 's' : ''} without a rating`, `未評価 ${unratedCount}件`, `${unratedCount} visita${unratedCount > 1 ? 's' : ''} sem avaliação`) })
  for (const r of facilityRecs) out.push({ id: `fac:${r.id}`, icon: '🧽', tone: 'info', tab: 'facility', title: L('Recommended service', 'おすすめの作業', 'Serviço recomendado'), sub: [r.service, r.location_name].filter(Boolean).join(' · ') })
  for (const a of maintAlerts.slice(0, 5)) out.push({ id: `maint:${a.location}:${a.en}:${a.state}`, icon: '🛠', tone: a.state === 'overdue' ? 'warn' : 'info', tab: 'stores', title: lang === 'ja' ? a.ja : a.en, sub: a.location })
  return out.filter(x => !x.old)
}

const seenKey = uid => `kp_client_bell_seen_${uid || 'x'}`
const readSeen = uid => { try { return new Set(JSON.parse(localStorage.getItem(seenKey(uid)) || '[]')) } catch { return new Set() } }
const writeSeen = (uid, set) => { try { localStorage.setItem(seenKey(uid), JSON.stringify([...set].slice(-400))) } catch { /* private mode */ } }

export default function ClientBell({ items, lang, userId, onOpenTab }) {
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(() => readSeen(userId))
  const btn = useRef(null)
  const unseen = items.filter(x => !seen.has(x.id)).length

  // a push notification may open /?bell=1
  useEffect(() => {
    try {
      const qs = new URLSearchParams(window.location.search)
      if (qs.get('bell') === '1') { qs.delete('bell'); window.history.replaceState(null, '', window.location.pathname + (qs.toString() ? `?${qs}` : '')); setOpen(true) }
    } catch { /* old browser */ }
  }, [])
  useEffect(() => {
    if (!open) return undefined
    const esc = e => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open])

  const close = () => {
    const next = new Set(seen); items.forEach(x => next.add(x.id)); setSeen(next); writeSeen(userId, next); setOpen(false)
  }
  const go = tab => { close(); onOpenTab(tab) }

  return (
    <>
      <button ref={btn} type="button" className={`cpx-icon-btn cpx-bell${unseen ? ' has-new' : ''}`} onClick={() => (open ? close() : setOpen(true))}
        aria-label={L('Notifications', 'お知らせ', 'Notificações')} title={L('Notifications', 'お知らせ', 'Notificações')}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        {unseen > 0 && <span className="cpx-bell-badge">{unseen > 9 ? '9+' : unseen}</span>}
      </button>
      {open && createPortal(
        <div className="cpx-bell-layer" onClick={close}>
          <div className="cpx-bell-pop" role="dialog" aria-label={L('Notifications', 'お知らせ', 'Notificações')} onClick={e => e.stopPropagation()}>
            <header>
              <h2>{L('Notifications', 'お知らせ', 'Notificações')}{items.length > 0 && <span>{items.length}</span>}</h2>
              <button type="button" onClick={close} aria-label={L('Close', '閉じる', 'Fechar')}>×</button>
            </header>
            <div className="cpx-bell-list">
              {items.length === 0 && <div className="cpx-bell-empty">✅ {L('All caught up', '新しいお知らせはありません', 'Tudo em dia, nada novo')}</div>}
              {items.map(x => (
                <button key={x.id} type="button" className={`cpx-bell-item tone-${x.tone}${seen.has(x.id) ? '' : ' is-new'}`} onClick={() => go(x.tab)}>
                  <b aria-hidden="true">{x.icon}</b>
                  <span><strong>{x.title}</strong>{x.sub && <small>{x.sub}</small>}</span>
                  <i aria-hidden="true">›</i>
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
