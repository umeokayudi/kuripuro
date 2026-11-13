// v1.0.254 · Blocks of the seller home, in the owner's order (redesign + organization only:
// same data, same rules, same permissions as before):
//   Pra hoje (calls · follow-ups · visits) → Meta do mês → Meus leads → Orçamentos → Contratos ativos → Canal Vendas
import { useEffect, useMemo, useState } from 'react'
import { pickLang } from '../hooks/useLang'
import { salesGet } from '../lib/salesApi'
import { STEP_PHASES, funnelCopy, initials, shortDay, yen } from '../lib/salesPhases'
import { GOAL_KEYS, goalProgress, monthElapsedPercent } from '../lib/salesFollowup'
import { channelLabel, inChannel } from '../lib/teamChannel'
import { loadMembers, loadMessages, loadPeople } from '../lib/teamChannelOps'
import { quoteRequestsToSend, quoteRequestsWaiting } from './SellerQuoteRequests'
import TodayList, { IconTile, StatusChip } from './TodayList'

const nowHHMM = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })

/** Card frame used by every block: coloured icon tile + title + optional counter + link. */
export function HomeCard({ icon, tone = 'blue', title, count, link, onLink, className = '', children }) {
  return (
    <section className={`fh-card ${className}`}>
      <div className="fh-card-head">
        <IconTile icon={icon} tone={tone} size={34} />
        <h2>{title}</h2>
        {count != null && count !== '' && <span className="th-count">{count}</span>}
        {onLink && <button type="button" className="fh-link" onClick={onLink}>{link} ›</button>}
      </div>
      {children}
    </section>
  )
}

// ───────────────────────── 3 · Pra hoje ─────────────────────────
export function SellerToday({ data, queue, leads, today, userId, lang, onOpenLead, onLog, onTab }) {
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const [calls, setCalls] = useState(null)
  useEffect(() => {
    let alive = true
    salesGet('/api/sales-data?action=outreach', lang).then(r => alive && setCalls(r)).catch(() => alive && setCalls({ queue: [], queue_total: 0, done_today: 0, failed: true }))
    return () => { alive = false }
  }, [lang, data])
  const leadOf = id => leads.find(l => l.id === id)
  const now = nowHHMM()

  const items = []
  // Ligações (today's call queue from "Ligações"; same list and order)
  const reason = r => ({ late: [L('Call-back late', '折り返し遅れ', 'Retorno atrasado'), 'red'], due: [L('Call back today', '本日折り返し', 'Retornar hoje'), 'amber'], funnel: [L('In conversation', '商談中', 'Em conversa'), 'blue'], new: [L('Never called', '未架電', 'Nunca ligado'), 'blue'], again: [L('Try again', '再架電', 'Tentar de novo'), 'amber'] }[r] || [L('To call', '架電', 'Para ligar'), 'blue'])
  for (const row of (calls?.queue || []).slice(0, 4)) {
    const [status, tone] = reason(row.reason)
    items.push({ id: `c${row.id}`, group: 'calls', time: row.next_followup_date && row.next_followup_date < today ? shortDay(row.next_followup_date) : L('Today', '今日', 'Hoje'), title: row.company_name || '—', sub: [row.contact_name, row.contact_phone || row.phone].filter(Boolean).join(' · '), tone, status, onClick: () => onTab('calls') })
  }
  // Retornos: late / today (and the ones already done today, in green)
  const pending = queue.filter(r => r.info.status === 'overdue' || r.info.status === 'today')
  for (const { lead, info } of pending) {
    const late = info.status === 'overdue'
    items.push({ id: `f${lead.id}`, group: 'followups', time: late ? shortDay(info.next) : L('Today', '今日', 'Hoje'), title: lead.site_name || lead.company_name || '—', sub: [lead.contact_name, lead.still_needed || lead.needs].filter(Boolean).join(' · '), tone: late ? 'red' : 'amber', status: late ? L(`${info.days}d late`, `${info.days}日遅れ`, `Atrasado ${info.days}d`) : L('Follow up today', '本日フォロー', 'Retorno hoje'), onClick: () => onOpenLead(lead), action: { label: L('Log', '記録', 'Registrar'), onClick: () => onLog(lead) } })
  }
  const pendingIds = new Set(pending.map(r => r.lead.id))
  const doneToday = new Map()
  for (const t of data?.touchpoints || []) {
    if (String(t.happened_at || '').slice(0, 10) !== today || (userId && t.salesperson_id && t.salesperson_id !== userId) || !t.lead_id || pendingIds.has(t.lead_id) || t.event_type === 'email_outreach') continue
    doneToday.set(t.lead_id, t)
  }
  for (const [leadId] of doneToday) {
    const lead = leadOf(leadId)
    if (lead) items.push({ id: `d${leadId}`, group: 'followups', time: L('Today', '今日', 'Hoje'), title: lead.site_name || lead.company_name || '—', sub: lead.contact_name || '', tone: 'green', status: L('Contact done', '連絡済み', 'Contato feito'), onClick: () => onOpenLead(lead) })
  }
  // Visitas do dia
  const visits = (data?.scheduledVisits || []).filter(v => v && v.date === today).sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99')))
  for (const v of visits) {
    const lead = leadOf(v.lead_id)
    const st = v.status === 'done' ? [L('Done', '完了', 'Feita'), 'green'] : v.status === 'cancelled' ? [L('Cancelled', 'キャンセル', 'Cancelada'), 'gray'] : v.time && v.time < now ? [L('Check', '確認', 'Conferir'), 'amber'] : [L('Scheduled', '予定', 'Agendada'), 'blue']
    items.push({ id: `v${v.id}`, group: 'visits', time: v.time || L('Today', '今日', 'Hoje'), title: lead?.site_name || lead?.company_name || v.place || '—', sub: [v.place && v.place !== (lead?.site_name || lead?.company_name) ? v.place : '', v.contact_name, v.duration_min ? `${v.duration_min} min` : ''].filter(Boolean).join(' · '), tone: st[1], status: st[0], onClick: lead ? () => onOpenLead(lead) : undefined })
  }

  const groups = [
    { key: 'calls', icon: '📞', tone: 'blue', label: L('Calls', '架電', 'Ligações'), count: calls?.queue_total ?? undefined, onOpen: () => onTab('calls'), openLabel: L('Open', '開く', 'Abrir'), always: true,
      note: calls && !calls.queue_total ? (calls.done_today ? L(`All done · ${calls.done_today} made today`, `完了・本日${calls.done_today}件`, `Tudo feito · ${calls.done_today} hoje`) : L('Nothing to call today.', '本日の架電はありません。', 'Nada para ligar hoje.')) : calls?.done_today ? L(`${calls.done_today} already made today`, `本日${calls.done_today}件済み`, `${calls.done_today} já feitas hoje`) : '' },
    { key: 'followups', icon: '↻', tone: 'amber', label: L('Follow-ups', 'フォローアップ', 'Retornos'), count: pending.length, onOpen: () => onTab('followups'), openLabel: L('All', 'すべて', 'Todos'), always: true, note: !pending.length && !doneToday.size ? L('No follow-up for today.', '本日のフォローはありません。', 'Nenhum retorno para hoje.') : '' },
    { key: 'visits', icon: '📍', tone: 'green', label: L('Visits', '訪問', 'Visitas'), always: true, note: !visits.length ? L('No visit booked for today.', '本日の訪問予定はありません。', 'Nenhuma visita marcada para hoje.') : '' },
  ]
  return (
    <HomeCard icon="☀️" tone="amber" title={L('For today', '今日やること', 'Pra hoje')} className="fh-today">
      <TodayList items={items} groups={groups} loadingGroups={calls ? [] : ['calls']} />
    </HomeCard>
  )
}

// ───────────────────────── 4 · Meta do mês ─────────────────────────
export function SellerGoal({ goal, actual, today, f, lang, onOpen }) {
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const keys = goal ? GOAL_KEYS.filter(k => Number(goal[k] || 0) > 0) : []
  const pace = monthElapsedPercent(today)
  if (!keys.length) {
    return (
      <HomeCard icon="🏁" tone="green" title={L('Goal this month', '今月の目標', 'Meta do mês')} className="fh-goal">
        <div className="fh-goal-empty">
          <strong>{L('Goal not set yet', '目標はまだ設定されていません', 'Meta ainda não definida')}</strong>
          <small>{L('When the office sets this month’s goal, your progress shows here.', '事務所が今月の目標を設定すると、ここに進捗が表示されます。', 'Quando o escritório definir a meta do mês, o seu progresso aparece aqui.')}</small>
        </div>
      </HomeCard>
    )
  }
  const rows = keys.map(k => ({ k, ...goalProgress(actual[k], goal[k]) }))
  const overall = Math.round(rows.reduce((n, r) => n + r.percent, 0) / rows.length)
  const fmt = k => (k === 'revenue' ? yen : v => v)
  return (
    <HomeCard icon="🏁" tone="green" title={L('Goal this month', '今月の目標', 'Meta do mês')} link={L('Details', '詳細', 'Detalhes')} onLink={onOpen} className="fh-goal">
      <div className="fh-goal-top">
        <div className="fh-ring" style={{ '--p': overall }}><b>{overall}%</b></div>
        <div><strong>{overall >= 100 ? L('Goal reached', '目標達成', 'Meta batida') : overall >= pace ? L('On pace', '順調', 'No ritmo') : L('Behind pace', 'ペース遅れ', 'Abaixo do ritmo')}</strong><small>{f.pace(pace)}</small></div>
      </div>
      {rows.map(r => (
        <div className="fh-gbar" key={r.k}>
          <div className="fh-gbar-meta"><span>{f.goalLabels[r.k]}</span><b>{fmt(r.k)(r.value)} / {fmt(r.k)(r.goal)}</b></div>
          <div className={`fh-gbar-track${r.done ? ' is-done' : r.percent < pace ? ' is-behind' : ''}`}><i style={{ width: `${r.percent}%` }} /><em style={{ left: `${pace}%` }} /></div>
        </div>
      ))}
    </HomeCard>
  )
}

// ───────────────────────── 5 · Meus leads / funil ─────────────────────────
const PHASE_TONE = { lead: 'gray', contact: 'blue', visit: 'blue', proposal: 'amber', negotiation: 'amber', approved: 'green', contract: 'green', active: 'green', lost: 'red' }
export function SellerLeads({ deals, lang, onOpen, onSeeAll, limit = 5 }) {
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const t = funnelCopy(lang)
  const open = deals.filter(d => d.phase !== 'lost')
  const byPhase = STEP_PHASES.map(p => ({ p, rows: open.filter(d => d.phase === p) })).filter(x => x.rows.length)
  const max = Math.max(1, ...byPhase.map(x => x.rows.length))
  const list = open.filter(d => d.phase !== 'active').sort((a, b) => String(b.last || '').localeCompare(String(a.last || ''))).slice(0, limit)
  return (
    <HomeCard icon="🎯" tone="blue" title={L('My leads', '自分のリード', 'Meus leads')} count={open.length} link={L('Funnel', 'ファネル', 'Funil')} onLink={onSeeAll} className="fh-leads">
      {byPhase.length > 0 && <div className="fh-funnel">
        {byPhase.map(({ p, rows }) => {
          const value = rows.reduce((n, d) => n + Number(d.value || 0), 0)
          return (
            <div className={`fh-funnel-row is-${PHASE_TONE[p]}`} key={p}>
              <span className="fh-funnel-name">{t.phases[p]}</span>
              <span className="fh-funnel-bar"><i style={{ width: `${Math.max(8, rows.length / max * 100)}%` }} /></span>
              <b>{rows.length}</b>
              <small>{value ? yen(value) : '—'}</small>
            </div>
          )
        })}
      </div>}
      {list.map(d => (
        <button type="button" key={d.lead.id} className="fh-row" onClick={() => onOpen(d.lead)}>
          <span className="fh-row-av" aria-hidden="true">{initials(d.lead.site_name || d.lead.company_name)}</span>
          <span className="fh-row-text"><strong>{d.lead.site_name || d.lead.company_name}</strong><small>{[d.lead.contact_name, d.last ? `${L('last contact', '最終連絡', 'último contato')} ${shortDay(d.last)}` : ''].filter(Boolean).join(' · ')}</small></span>
          <StatusChip tone={PHASE_TONE[d.phase]}>{t.phases[d.phase]}</StatusChip>
          <b className="fh-row-value">{d.value ? yen(d.value) : '—'}</b>
        </button>
      ))}
      {!open.length && <p className="th-empty">{L('No leads yet. Tap + to add the first one.', 'リードはまだありません。＋で追加。', 'Nenhum lead ainda. Toque no + para adicionar.')}</p>}
    </HomeCard>
  )
}

// ───────────────────────── 6 · Orçamentos ─────────────────────────
const QUOTE_STATUS = {
  draft: ['gray', 'Draft', '下書き', 'Rascunho'], sent: ['blue', 'Sent', '送付済み', 'Enviado'], changes_requested: ['amber', 'Changes asked', '修正依頼', 'Pediu ajuste'],
  accepted: ['green', 'Approved', '承認', 'Aprovado'], declined: ['red', 'Declined', '辞退', 'Recusado'],
}
export function SellerQuotes({ data, leads, lang, onOpenLead, onRequests, limit = 4 }) {
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const quotes = useMemo(() => data?.quotes || [], [data?.quotes])
  const n = useMemo(() => {
    const sent = quotes.filter(q => q.sent_at || (q.status && q.status !== 'draft'))
    const answered = quotes.filter(q => ['accepted', 'declined', 'changes_requested'].includes(q.status))
    const approved = quotes.filter(q => q.status === 'accepted')
    return { sent: sent.length, answered: answered.length, approved: approved.length, approvedValue: approved.reduce((s, q) => s + Number(q.total || 0), 0) }
  }, [quotes])
  const toSend = quoteRequestsToSend(data).length
  const waiting = quoteRequestsWaiting(data).length
  const list = quotes.filter(q => q.status !== 'draft').slice(0, limit)
  return (
    <HomeCard icon="📝" tone="amber" title={L('Quotes', '見積もり', 'Orçamentos')} link={L('Requests', '依頼', 'Pedidos')} onLink={onRequests} className="fh-quotes">
      <div className="fh-stats">
        <div className="is-blue"><b>{n.sent}</b><span>{L('Sent', '送付', 'Enviados')}</span></div>
        <div className="is-amber"><b>{n.answered}</b><span>{L('Answered', '回答', 'Respondidos')}</span></div>
        <div className="is-green"><b>{n.approved}</b><span>{L('Approved', '承認', 'Aprovados')}</span>{n.approvedValue > 0 && <small>{yen(n.approvedValue)}</small>}</div>
      </div>
      {(toSend + waiting) > 0 && <button type="button" className="fh-row is-flag" onClick={onRequests}>
        <span className="fh-row-text"><strong>{L('Quote requests from clients', '顧客からの見積依頼', 'Pedidos de orçamento dos clientes')}</strong><small>{[toSend ? L(`${toSend} ready to send`, `送信待ち${toSend}件`, `${toSend} prontos para enviar`) : '', waiting ? L(`${waiting} waiting for the office price`, `事務所の価格待ち${waiting}件`, `${waiting} aguardando o preço do escritório`) : ''].filter(Boolean).join(' · ')}</small></span>
        <StatusChip tone={toSend ? 'red' : 'amber'}>{toSend ? L('Send', '送信', 'Enviar') : L('Waiting', '待ち', 'Aguardando')}</StatusChip>
      </button>}
      {list.map(q => {
        const [tone, en, ja, pt] = QUOTE_STATUS[q.status] || QUOTE_STATUS.draft
        const lead = leads.find(l => l.id === q.lead_id)
        return (
          <button type="button" key={q.id} className="fh-row" onClick={lead ? () => onOpenLead(lead) : undefined} disabled={!lead}>
            <span className="fh-row-text"><strong>{q.company_name || lead?.company_name || '—'}</strong><small>{[q.quote_number, shortDay(q.sent_at || q.created_at)].filter(Boolean).join(' · ')}</small></span>
            <StatusChip tone={tone}>{L(en, ja, pt)}</StatusChip>
            <b className="fh-row-value">{yen(q.total)}</b>
          </button>
        )
      })}
      {!quotes.length && !(toSend + waiting) && <p className="th-empty">{L('No quotes yet.', '見積もりはまだありません。', 'Nenhum orçamento ainda.')}</p>}
    </HomeCard>
  )
}

// ───────────────────────── 8 · Canal da equipe (Vendas) ─────────────────────────
export function SellerChannel({ me, lang, onOpen, channel = 'vendas' }) {
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const [state, setState] = useState({ loading: true, inside: false, msgs: [] })
  useEffect(() => {
    let alive = true
    ;(async () => {
      const [mem, people] = await Promise.all([loadMembers().catch(() => null), loadPeople().catch(() => [])])
      const who = (people || []).find(p => p.role === me.role && p.id === me.id) || { ...me, is_active: true }
      const inside = !!mem && inChannel(who, channel, mem)
      const msgs = inside ? await loadMessages(channel).catch(() => []) : []
      if (alive) setState({ loading: false, inside, msgs: (msgs || []).filter(m => m.kind === 'text' || m.text).slice(-3) })
    })()
    return () => { alive = false }
  }, [me.id, me.role, channel]) // eslint-disable-line react-hooks/exhaustive-deps
  const when = iso => new Date(iso).toLocaleString(lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
  const name = channelLabel(channel, lang)
  return (
    <HomeCard icon="💬" tone="orange" title={L(`Team channel · ${name}`, `チームチャンネル・${name}`, `Canal da Equipe · ${name}`)} className="fh-channel">
      {state.loading && <p className="th-empty is-small">…</p>}
      {!state.loading && !state.inside && <p className="th-empty">{L(`You are not in the ${name} channel yet. The office adds you.`, `まだ${name}チャンネルに入っていません。事務所が追加します。`, `Você ainda não está no canal ${name}. O escritório adiciona você.`)}</p>}
      {!state.loading && state.inside && !state.msgs.length && <p className="th-empty">{L('No messages yet. Say hello to your team.', 'まだメッセージはありません。', 'Nenhuma mensagem ainda. Mande um oi para a equipe.')}</p>}
      {state.msgs.map(m => (
        <div className="fh-msg" key={m.id}>
          <span className="fh-row-av is-small" aria-hidden="true">{initials(m.author?.name)}</span>
          <span className="fh-msg-text"><strong>{m.author?.role === 'admin' ? `${m.author?.name || 'Admin'} · ${L('Office', '事務所', 'Escritório')}` : (m.author?.name || '—')}<small>{when(m.at)}</small></strong><span>{m.text}</span></span>
        </div>
      ))}
      <button type="button" className="fh-btn is-soft" onClick={onOpen}>{L(`Open ${name} channel`, `${name}チャンネルを開く`, `Abrir canal ${name}`)}</button>
    </HomeCard>
  )
}
