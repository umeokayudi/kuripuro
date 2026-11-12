import { useEffect, useMemo, useState } from 'react'
import { pickLang } from '../hooks/useLang'
import { salesGet } from '../lib/salesApi'
import { portfolioTotal } from '../lib/activePortfolio'

// v1.0.226 · Seller portal → 契約 → "Contratos ativos": every client with an active contract (read only).
// No buttons that change anything: no edit, no cancel, no invoice. Only commercial values.
const yen = v => `¥${Math.round(Number(v || 0)).toLocaleString()}`

function fmtDate(v, lang) {
  if (!v) return '—'
  const [y, m, d] = String(v).slice(0, 10).split('-')
  if (lang === 'ja') return `${y}/${m}/${d}`
  if (lang === 'pt') return `${d}/${m}/${y}`
  return `${y}-${m}-${d}`
}

export default function SellerActivePortfolio({ lang = 'en' }) {
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const [state, setState] = useState({ loading: true, error: '', clients: [] })
  const [query, setQuery] = useState('')

  useEffect(() => {
    let alive = true
    salesGet('/api/sales-data?action=portfolio', lang)
      .then(r => alive && setState({ loading: false, error: '', clients: r.clients || [] }))
      .catch(e => alive && setState({ loading: false, error: e.message, clients: [] }))
    return () => { alive = false }
  }, [lang])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return state.clients
    return state.clients.filter(g => g.company.toLowerCase().includes(q) || g.locations.some(l => l.location.toLowerCase().includes(q)))
  }, [state.clients, query])

  const total = portfolioTotal(state.clients)
  const locCount = state.clients.reduce((n, g) => n + g.locations.length, 0)

  return (
    <section className="fa-card is-list sp-portfolio">
      <div className="fa-card-head"><h2>📋 {L('Active contracts', '有効契約', 'Contratos ativos')}</h2><span className="fa-pill">{L('View only', '閲覧のみ', 'Só leitura')}</span></div>
      <p className="fa-muted sp-portfolio-hint">{L('Every client with an active contract. Values are what the client pays per month.', '有効な契約がある全顧客。金額はお客様の月額です。', 'Todos os clientes com contrato ativo. O valor é o que o cliente paga por mês.')}</p>
      {!state.loading && !state.error && <div className="sp-portfolio-sum">
        <span><b>{state.clients.length}</b>{L('clients', '顧客', 'clientes')}</span>
        <span><b>{locCount}</b>{L('locations / items', '拠点・項目', 'locais / itens')}</span>
        <span><b>{yen(total)}</b>{L('per month', '月額合計', 'por mês')}</span>
      </div>}
      {state.clients.length > 4 && <input className="sp-portfolio-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={L('Search client or location', '顧客・拠点を検索', 'Buscar cliente ou local')} />}
      {state.loading && <p className="fa-muted">{L('Loading…', '読み込み中…', 'Carregando…')}</p>}
      {state.error && <p className="fa-muted">{state.error}</p>}
      {!state.loading && !state.error && !list.length && <p className="fa-muted">{L('No active contracts.', '有効な契約はありません。', 'Nenhum contrato ativo.')}</p>}
      {list.map(g => (
        <details className="sp-portfolio-client" key={g.client_id || g.company}>
          <summary>
            <span className="sp-portfolio-name"><strong>{g.company}</strong><small>{g.stores.slice(0, 4).join(' · ')}{g.stores.length > 4 ? ` +${g.stores.length - 4}` : ''}</small></span>
            <span className="sp-portfolio-value"><strong>{yen(g.monthly)}</strong><small>{L('/month', '/月', '/mês')}</small></span>
          </summary>
          <div className="sp-portfolio-facts">
            <span>🗓 {L('Since', '開始', 'Desde')} {fmtDate(g.start, lang)}{g.termEnd ? ` · ${L('renews yearly, current term until', '自動更新（現契約期間', 'renova todo ano, período atual até')} ${fmtDate(g.termEnd, lang)}${lang === 'ja' ? 'まで）' : ''}` : ''}{!g.started ? ` · ${L('not started yet', '開始前', 'ainda não começou')}` : ''}</span>
            <span>🧾 {L('Next invoice', '次回請求', 'Próxima fatura')} {fmtDate(g.nextInvoice, lang)} · {L('due', '支払期限', 'vencimento')} {fmtDate(g.nextDue, lang)}</span>
          </div>
          {g.locations.map(l => (
            <div className="sp-history-row" key={l.id}>
              <div>
                <strong>{l.location}</strong>
                <small>{l.service}{l.billing === 'fixed' ? ` · ${L('fixed monthly', '月額固定', 'mensal fixo')}` : l.visits ? ` · ${l.visits}× ${yen(l.perVisit)}` : ` · ${L('on request', '依頼時', 'sob demanda')} ${yen(l.perVisit)}/${L('visit', '回', 'vez')}`}{l.discount ? ` · −${l.discount}%` : ''}</small>
              </div>
              <span className="sp-portfolio-line">{l.monthly ? yen(l.monthly) : '—'}</span>
            </div>
          ))}
        </details>
      ))}
    </section>
  )
}
