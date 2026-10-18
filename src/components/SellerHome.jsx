import { useMemo, useState } from 'react'
import { sellerCommissionSummary } from '../lib/contractCommission'
import { funnelCopy, initials, shortDay, yen } from '../lib/salesPhases'

// Seller home blocks: upcoming follow-ups with dates, the numbers that matter
// (approaches, responses, quotes, won), commissions & payments, and every client.

const COPY = {
  en: {
    next: 'Next follow-ups', none: 'No follow-up scheduled. Set a date on each lead.', noDate: 'No date',
    overdue: d => `${d}d late`, today: 'Today', tomorrow: 'Tomorrow', inDays: d => `in ${d}d`,
    numbers: 'My numbers', week: 'Week', month: 'Month', all: 'All time',
    leads: 'New leads', approaches: 'Approaches', responses: 'Responses', quotes: 'Quotes sent', won: 'Closed', conv: 'Response rate', value: 'Approved value',
    comm: 'Commissions & payments', toReceive: 'To receive', received: 'Received', waiting: 'Awaiting approval', monthly: 'Fixed / month', details: 'Details',
    clients: 'My clients', search: 'Search client', filters: { all: 'All', open: 'In progress', approved: 'Approved', active: 'Active' }, noClients: 'No clients yet.', lastContact: 'Last contact',
  },
  ja: {
    next: '次のフォローアップ', none: '予定されたフォローアップはありません。各リードに日付を設定してください。', noDate: '日付なし',
    overdue: d => `${d}日遅れ`, today: '今日', tomorrow: '明日', inDays: d => `${d}日後`,
    numbers: '自分の数字', week: '週', month: '月', all: '全期間',
    leads: '新規リード', approaches: 'アプローチ', responses: '反応', quotes: '見積送付', won: '成約', conv: '反応率', value: '承認額',
    comm: 'コミッションと支払い', toReceive: '受取予定', received: '受取済み', waiting: '承認待ち', monthly: '定期 / 月', details: '詳細',
    clients: '自分の顧客', search: '顧客を検索', filters: { all: 'すべて', open: '進行中', approved: '承認済み', active: '稼働中' }, noClients: '顧客はまだいません。', lastContact: '最終連絡',
  },
  pt: {
    next: 'Próximos retornos', none: 'Nenhum retorno agendado. Defina uma data em cada lead.', noDate: 'Sem data',
    overdue: d => `${d}d de atraso`, today: 'Hoje', tomorrow: 'Amanhã', inDays: d => `em ${d}d`,
    numbers: 'Meus números', week: 'Semana', month: 'Mês', all: 'Tudo',
    leads: 'Novos leads', approaches: 'Abordagens', responses: 'Respostas', quotes: 'Orçamentos enviados', won: 'Fechados', conv: 'Taxa de resposta', value: 'Valor aprovado',
    comm: 'Comissões e pagamentos', toReceive: 'A receber', received: 'Recebido', waiting: 'Aguardando aprovação', monthly: 'Fixo / mês', details: 'Detalhes',
    clients: 'Meus clientes', search: 'Buscar cliente', filters: { all: 'Todos', open: 'Em andamento', approved: 'Aprovados', active: 'Ativos' }, noClients: 'Nenhum cliente ainda.', lastContact: 'Último contato',
  },
}

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function NextFollowups({ queue, lang, onOpen, onLog, logLabel, limit = 8 }) {
  const c = COPY[lang === 'ja' ? 'ja' : lang === 'pt' ? 'pt' : 'en']
  const rows = queue.filter(r => r.info.next).sort((a, b) => a.info.next.localeCompare(b.info.next)).slice(0, limit)
  const when = info => info.status === 'overdue' ? c.overdue(info.days) : info.days === 0 ? c.today : info.days === 1 ? c.tomorrow : c.inDays(info.days)
  return <section className="fa-card">
    <div className="fa-card-head"><h2>{c.next}</h2>{rows.length > 0 && <span className="fa-pill">{queue.filter(r => r.info.next).length}</span>}</div>
    {rows.map(({ lead, info }) => <div key={lead.id} className={`sh-fu is-${info.status}`}>
      <button type="button" className="sh-fu-date" onClick={() => onOpen(lead)}><b>{shortDay(info.next)}</b><small>{when(info)}</small></button>
      <button type="button" className="sh-fu-main" onClick={() => onOpen(lead)}><strong>{lead.site_name || lead.company_name}</strong><small>{[lead.contact_name, lead.still_needed || lead.needs].filter(Boolean).join(' · ') || '—'}</small></button>
      <button type="button" className="fa-btn fa-btn-sm sh-fu-log" onClick={() => onLog(lead)}>{logLabel}</button>
    </div>)}
    {rows.length === 0 && <p className="fa-muted">{c.none}</p>}
  </section>
}

export function MyNumbers({ data, today, lang }) {
  const c = COPY[lang === 'ja' ? 'ja' : lang === 'pt' ? 'pt' : 'en']
  const [period, setPeriod] = useState('month')
  const from = period === 'week' ? addDays(today, -6) : period === 'month' ? `${today.slice(0, 7)}-01` : '0000'
  const inRange = v => { const d = String(v || '').slice(0, 10); return d && d >= from && d <= today }
  const n = useMemo(() => {
    const leads = (data?.leads || []).filter(r => inRange(r.first_contact_date || r.created_at)).length
    const approaches = (data?.approaches || []).filter(r => inRange(r.work_date)).length
    const tps = (data?.touchpoints || []).filter(r => inRange(r.happened_at))
    const responses = tps.filter(r => String(r.client_response || '').trim() || r.response_tag || r.event_type === 'client_reply').length
    const quotes = (data?.quotes || []).filter(r => inRange(r.sent_at || (r.status !== 'draft' ? r.created_at : ''))).length
    const accepted = (data?.quotes || []).filter(r => r.status === 'accepted' && inRange(r.decided_at || r.created_at))
    const won = accepted.length
    const contacts = approaches + tps.filter(r => !String(r.client_response || '').trim() && !r.response_tag).length
    return { leads, approaches, responses, quotes, won, value: accepted.reduce((s, r) => s + Number(r.total || 0), 0), rate: contacts + responses ? Math.round(responses / Math.max(1, contacts) * 100) : 0 }
  }, [data, from, today]) // eslint-disable-line react-hooks/exhaustive-deps
  const tiles = [['is-blue', n.leads, c.leads], ['is-purple', n.approaches, c.approaches], ['is-teal', n.responses, c.responses], ['is-amber', n.quotes, c.quotes], ['is-green', n.won, c.won], ['is-dark', n.value >= 1e6 ? `¥${(n.value / 1e6).toFixed(n.value >= 1e7 ? 0 : 1)}M` : n.value >= 1e4 ? `¥${Math.round(n.value / 1e3)}k` : yen(n.value), c.value]]
  return <section className="fa-card">
    <div className="fa-card-head"><h2>{c.numbers}</h2>
      <div className="fn-seg sh-seg">{['week', 'month', 'all'].map(p => <button type="button" key={p} className={period === p ? 'is-active' : ''} onClick={() => setPeriod(p)}>{c[p]}</button>)}</div>
    </div>
    <div className="sh-tiles">{tiles.map(([cls, v, label]) => <div key={label} className={`sh-tile ${cls}`}><strong>{v}</strong><span>{label}</span></div>)}</div>
    <div className="sh-rate"><span>{c.conv}</span><div className="sh-bar"><i style={{ width: `${Math.min(100, n.rate)}%` }} /></div><b>{n.rate}%</b></div>
  </section>
}

export function CommissionsCard({ data, metrics, lang, onDetails }) {
  const c = COPY[lang === 'ja' ? 'ja' : lang === 'pt' ? 'pt' : 'en']
  const sum = sellerCommissionSummary(data?.contractCommissions?.spot || [], data?.contractCommissions?.fixed || [])
  const toReceive = sum.earned + Number(metrics?.commission_pending || 0)
  return <section className="fa-card sh-comm">
    <div className="fa-card-head"><h2>{c.comm}</h2>{onDetails && <button type="button" className="fa-link" onClick={onDetails}>{c.details} ›</button>}</div>
    <div className="sh-comm-grid">
      <div className="is-main"><span>{c.toReceive}</span><strong>{yen(toReceive)}</strong></div>
      <div><span>{c.received}</span><strong>{yen(sum.paid)}</strong></div>
      <div><span>{c.waiting}</span><strong>{yen(sum.pending)}</strong></div>
      <div><span>{c.monthly}</span><strong>{yen(sum.monthly)}</strong></div>
    </div>
  </section>
}

export function ClientList({ deals, lang, onOpen, limit = 0, onSeeAll, seeAllLabel, className = '' }) {
  const c = COPY[lang === 'ja' ? 'ja' : lang === 'pt' ? 'pt' : 'en']
  const t = funnelCopy(lang)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const groups = { open: ['lead', 'contact', 'visit', 'proposal', 'negotiation'], approved: ['approved', 'contract'], active: ['active'] }
  const query = q.trim().toLowerCase()
  const rows = deals
    .filter(d => d.phase !== 'lost' && (filter === 'all' || groups[filter].includes(d.phase)))
    .filter(d => !query || [d.lead.company_name, d.lead.site_name, d.lead.contact_name, d.lead.address].some(v => String(v || '').toLowerCase().includes(query)))
    .sort((a, b) => String(b.last).localeCompare(String(a.last)))
  const shown = limit ? rows.slice(0, limit) : rows
  return <section className={`fa-card ${className}`}>
    <div className="fa-card-head"><h2>{c.clients}</h2><span className="fa-pill">{rows.length}</span></div>
    {!limit && <input className="fn-search sh-search" type="search" placeholder={c.search} value={q} onChange={e => setQ(e.target.value)} />}
    <div className="sp-chip-row">{Object.keys(c.filters).map(k => <button type="button" key={k} className={`fa-chip${filter === k ? ' is-active' : ''}`} onClick={() => setFilter(k)}>{c.filters[k]}</button>)}</div>
    <div className="fn-root sh-clients">
      {shown.map(d => <button type="button" key={d.lead.id} className="fn-list-row" onClick={() => onOpen(d.lead)}>
        <span className="fn-avatar" aria-hidden="true">{initials(d.lead.site_name || d.lead.company_name)}</span>
        <span className="fn-card-text"><strong>{d.lead.site_name || d.lead.company_name}</strong><small>{[d.lead.contact_name, `${c.lastContact} ${shortDay(d.last)}`].filter(Boolean).join(' · ')}</small></span>
        <span className={`fn-badge is-${d.phase}`}>{t.phases[d.phase]}</span>
        <b className="fn-list-value">{d.value ? yen(d.value) : '—'}</b>
      </button>)}
    </div>
    {rows.length === 0 && <p className="fa-muted">{c.noClients}</p>}
    {limit > 0 && rows.length > limit && onSeeAll && <button type="button" className="fa-link" onClick={onSeeAll}>{seeAllLabel} ›</button>}
  </section>
}
