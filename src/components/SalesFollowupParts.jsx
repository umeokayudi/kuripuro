import { useState } from 'react'
import {
  CONTACT_CHANNELS, GOAL_KEYS, RESPONSE_TAGS, SENTIMENTS, addDaysIso, contactsForLead, daysBetween, goalProgress, monthElapsedPercent,
} from '../lib/salesFollowup'

export const FOLLOWUP_COPY = {
  en: {
    overdue: d => `Overdue ${d} day${d === 1 ? '' : 's'}`,
    today: () => 'Follow up today',
    soon: d => `In ${d} day${d === 1 ? '' : 's'}`,
    scheduled: d => `In ${d} days`,
    stale: d => `No contact for ${d} days`,
    missing: () => 'No next follow-up set',
    alertTitle: 'Follow-up alerts',
    alertOverdue: 'overdue', alertToday: 'for today', alertStale: 'without contact for 14+ days', alertMissing: 'without a next date',
    allClear: 'All clients are on track.',
    seeAll: 'See follow-ups',
    lastContact: 'Last contact', firstContact: 'First contact', never: 'never', daysAgo: d => (d === 0 ? 'today' : `${d} day${d === 1 ? '' : 's'} ago`),
    logContact: 'Log contact', contactDate: 'Contact date', channel: 'How', nextFollowup: 'Next follow-up',
    noNext: 'No next follow-up', saveContact: 'Save contact', cancel: 'Cancel', saved: 'Contact saved',
    history: 'Contact history', noHistory: 'No contacts logged yet.',
    channels: { visit: 'Visit', phone: 'Phone', line: 'LINE', email: 'Email', meeting: 'Meeting', other: 'Other' },
    note: 'What happened', clientResponse: 'What the client answered', responseTag: 'Type of answer', sentiment: 'Mood',
    responseTags: { interested: 'Interested', asked_quote: 'Asked for a quote', price_high: 'Price too high', has_vendor: 'Already has a vendor', timing: 'Not now / timing', need_approval: 'Needs boss approval', no_need: 'No need', no_answer: 'No answer / absent', other: 'Other' },
    sentiments: { positive: 'Positive', neutral: 'Neutral', negative: 'Negative' },
    quick: [['+3d', 3], ['+1w', 7], ['+2w', 14], ['+1m', 30]],
    goals: 'Goals', goalsMonth: 'Goals this month', noGoals: 'Your manager has not set goals for this month yet.',
    pace: p => `${p}% of the month has passed`, done: 'Reached',
    goalLabels: { approaches: 'Approaches', contacts: 'Contacts', leads: 'New leads', quotes: 'Quotes', contracts: 'Contracts closed', revenue: 'Monthly contract value' },
  },
  ja: {
    overdue: d => `${d}日超過`,
    today: () => '本日フォロー',
    soon: d => `${d}日後`,
    scheduled: d => `${d}日後`,
    stale: d => `${d}日間連絡なし`,
    missing: () => '次回連絡日が未設定',
    alertTitle: 'フォローアップ通知',
    alertOverdue: '件が期限超過', alertToday: '件が本日', alertStale: '件が14日以上連絡なし', alertMissing: '件が次回日未設定',
    allClear: 'すべての顧客が予定どおりです。',
    seeAll: 'フォローアップを見る',
    lastContact: '最終連絡', firstContact: '初回連絡', never: 'なし', daysAgo: d => (d === 0 ? '本日' : `${d}日前`),
    logContact: '連絡を記録', contactDate: '連絡日', channel: '方法', nextFollowup: '次回連絡日',
    noNext: '次回連絡なし', saveContact: '連絡を保存', cancel: 'キャンセル', saved: '連絡を保存しました',
    history: '連絡履歴', noHistory: '連絡記録はまだありません。',
    channels: { visit: '訪問', phone: '電話', line: 'LINE', email: 'メール', meeting: '面談', other: 'その他' },
    note: '何があったか', clientResponse: 'お客様の返答', responseTag: '返答の種類', sentiment: '温度感',
    responseTags: { interested: '前向き', asked_quote: '見積依頼', price_high: '価格が高い', has_vendor: '既存業者あり', timing: '時期が合わない', need_approval: '上司の承認待ち', no_need: '必要なし', no_answer: '不在・返答なし', other: 'その他' },
    sentiments: { positive: '良い', neutral: '普通', negative: '悪い' },
    quick: [['+3日', 3], ['+1週', 7], ['+2週', 14], ['+1月', 30]],
    goals: '目標', goalsMonth: '今月の目標', noGoals: '今月の目標はまだ設定されていません。',
    pace: p => `今月は${p}%経過`, done: '達成',
    goalLabels: { approaches: '営業活動', contacts: '連絡数', leads: '新規リード', quotes: '見積', contracts: '成約', revenue: '月間契約額' },
  },
  pt: {
    overdue: d => `Atrasado ${d} dia${d === 1 ? '' : 's'}`,
    today: () => 'Fazer follow-up hoje',
    soon: d => `Em ${d} dia${d === 1 ? '' : 's'}`,
    scheduled: d => `Em ${d} dias`,
    stale: d => `Sem contato há ${d} dias`,
    missing: () => 'Sem próximo follow-up definido',
    alertTitle: 'Alertas de follow-up',
    alertOverdue: 'atrasados', alertToday: 'para hoje', alertStale: 'sem contato há 14+ dias', alertMissing: 'sem próxima data',
    allClear: 'Todos os clientes estão em dia.',
    seeAll: 'Ver follow-ups',
    lastContact: 'Último contato', firstContact: 'Primeiro contato', never: 'nunca', daysAgo: d => (d === 0 ? 'hoje' : `há ${d} dia${d === 1 ? '' : 's'}`),
    logContact: 'Registrar contato', contactDate: 'Data do contato', channel: 'Como', nextFollowup: 'Próximo follow-up',
    noNext: 'Sem próximo follow-up', saveContact: 'Salvar contato', cancel: 'Cancelar', saved: 'Contato salvo',
    history: 'Histórico de contatos', noHistory: 'Nenhum contato registrado ainda.',
    channels: { visit: 'Visita', phone: 'Telefone', line: 'LINE', email: 'E-mail', meeting: 'Reunião', other: 'Outro' },
    note: 'O que aconteceu', clientResponse: 'O que o cliente respondeu', responseTag: 'Tipo de resposta', sentiment: 'Clima',
    responseTags: { interested: 'Interessado', asked_quote: 'Pediu orçamento', price_high: 'Preço alto demais', has_vendor: 'Já tem fornecedor', timing: 'Agora não / momento', need_approval: 'Precisa de aprovação do chefe', no_need: 'Não precisa', no_answer: 'Sem resposta / ausente', other: 'Outro' },
    sentiments: { positive: 'Positivo', neutral: 'Neutro', negative: 'Negativo' },
    quick: [['+3d', 3], ['+1sem', 7], ['+2sem', 14], ['+1m', 30]],
    goals: 'Metas', goalsMonth: 'Metas deste mês', noGoals: 'Seu gestor ainda não definiu as metas deste mês.',
    pace: p => `${p}% do mês já passou`, done: 'Atingida',
    goalLabels: { approaches: 'Abordagens', contacts: 'Contatos', leads: 'Novos leads', quotes: 'Orçamentos', contracts: 'Contratos fechados', revenue: 'Valor mensal de contratos' },
  },
}

export const followupCopy = lang => FOLLOWUP_COPY[lang === 'ja' ? 'ja' : lang === 'pt' ? 'pt' : 'en']
const yen = value => `¥${Math.round(Number(value || 0)).toLocaleString()}`

export function FollowupChip({ info, f }) {
  if (!info) return null
  return <span className={`sales-chip sales-chip-${info.status}`}>{f[info.status](info.days)}</span>
}

export function LastContactLine({ info, lead, f, today }) {
  const last = info?.last || lead?.last_contact_date || lead?.first_contact_date
  const since = info?.sinceContact ?? (last && today ? daysBetween(last, today) : null)
  return <small>{f.lastContact}: {last ? `${last}${since != null ? ` (${f.daysAgo(since)})` : ''}` : f.never}{info?.next ? ` · ${f.nextFollowup}: ${info.next}` : ''}</small>
}

export function AlertBanner({ counts, f, onOpen }) {
  const parts = [
    ['overdue', counts.overdue, f.alertOverdue],
    ['today', counts.today, f.alertToday],
    ['stale', counts.stale, f.alertStale],
    ['missing', counts.missing, f.alertMissing],
  ].filter(([, n]) => n > 0)
  const urgent = counts.overdue + counts.today > 0
  return (
    <div className={`sales-alert-banner${urgent ? ' urgent' : parts.length ? ' warn' : ' ok'}`} role="status">
      <div>
        <strong>{f.alertTitle}</strong>
        <span>{parts.length ? parts.map(([key, n, label]) => <b key={key} className={`sales-alert-${key}`}>{n} {label}</b>) : f.allClear}</span>
      </div>
      {parts.length > 0 && onOpen && <button type="button" className="btn btn-sm" onClick={onOpen}>{f.seeAll}</button>}
    </div>
  )
}

export function ContactLogForm({ lead, today, f, onSave, onCancel, busy }) {
  const [form, setForm] = useState({ happened_at: today, channel: 'visit', body: '', client_response: '', response_tag: '', sentiment: '', next_followup_date: addDaysIso(today, 7) })
  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }))
  const submit = event => {
    event.preventDefault()
    onSave({ lead_id: lead.id, ...form })
  }
  return (
    <form className="sales-contact-form" onSubmit={submit}>
      <div className="sales-form-grid">
        <label className="form-group"><span>{f.contactDate}</span><input type="date" max={today} required value={form.happened_at} onChange={e => set('happened_at', e.target.value)} /></label>
        <label className="form-group"><span>{f.channel}</span><select value={form.channel} onChange={e => set('channel', e.target.value)}>{CONTACT_CHANNELS.map(key => <option key={key} value={key}>{f.channels[key]}</option>)}</select></label>
      </div>
      <label className="form-group"><span>{f.note}</span><textarea rows="2" value={form.body} onChange={e => set('body', e.target.value)} /></label>
      <label className="form-group"><span>{f.clientResponse}</span><textarea rows="2" value={form.client_response} onChange={e => set('client_response', e.target.value)} /></label>
      <div className="form-group"><span>{f.responseTag}</span><div className="sales-tag-picker">{RESPONSE_TAGS.map(key => <button type="button" key={key} aria-pressed={form.response_tag === key} className={`btn btn-sm${form.response_tag === key ? ' active' : ''}`} onClick={() => set('response_tag', form.response_tag === key ? '' : key)}>{f.responseTags[key]}</button>)}</div></div>
      <div className="form-group"><span>{f.sentiment}</span><div className="sales-tag-picker">{SENTIMENTS.map(key => <button type="button" key={key} aria-pressed={form.sentiment === key} className={`btn btn-sm sales-sentiment-${key}${form.sentiment === key ? ' active' : ''}`} onClick={() => set('sentiment', form.sentiment === key ? '' : key)}>{f.sentiments[key]}</button>)}</div></div>
      <label className="form-group"><span>{f.nextFollowup}</span><input type="date" min={form.happened_at} value={form.next_followup_date} onChange={e => set('next_followup_date', e.target.value)} /></label>
      <div className="sales-quick-dates">
        {f.quick.map(([label, n]) => <button type="button" key={label} className={`btn btn-sm${form.next_followup_date === addDaysIso(form.happened_at, n) ? ' active' : ''}`} onClick={() => set('next_followup_date', addDaysIso(form.happened_at, n))}>{label}</button>)}
        <button type="button" className={`btn btn-sm${!form.next_followup_date ? ' active' : ''}`} onClick={() => set('next_followup_date', '')}>{f.noNext}</button>
      </div>
      <div className="sales-action-row">
        <button type="submit" className="btn btn-primary" disabled={busy}>{f.saveContact}</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>{f.cancel}</button>}
      </div>
    </form>
  )
}

export function ContactHistory({ leadId, touchpoints, f }) {
  const rows = contactsForLead(leadId, touchpoints)
  return (
    <div className="sales-history">
      <div className="card-title">{f.history}</div>
      {rows.length === 0 && <p className="sales-muted">{f.noHistory}</p>}
      {rows.map(row => (
        <div className="sales-history-row" key={row.id}>
          <div className="sales-history-date">{row.happened_at}</div>
          <div>
            <strong>{f.channels[row.channel] || row.channel || '—'}{row.said_by ? ` · ${row.said_by}` : ''}</strong>
            {row.body && <p>{row.body}</p>}
            {(row.client_response || row.response_tag) && <p className="sales-history-response">{row.response_tag && <span className={`sales-chip sales-chip-tag${row.sentiment ? ` sales-sentiment-${row.sentiment}` : ''}`}>{f.responseTags[row.response_tag] || row.response_tag}</span>}{row.client_response && <q>{row.client_response}</q>}</p>}
            {row.next_followup_date && <small>{f.nextFollowup}: {row.next_followup_date}</small>}
          </div>
        </div>
      ))}
    </div>
  )
}

export function GoalBars({ goal, actual, today, f, compact = false }) {
  if (!goal) return <p className="sales-muted">{f.noGoals}</p>
  const keys = GOAL_KEYS.filter(key => Number(goal[key] || 0) > 0)
  if (!keys.length) return <p className="sales-muted">{f.noGoals}</p>
  const pace = monthElapsedPercent(today)
  return (
    <div className={`sales-goal-bars${compact ? ' compact' : ''}`}>
      <small className="sales-muted">{f.pace(pace)}</small>
      {keys.map(key => {
        const p = goalProgress(actual[key], goal[key])
        const behind = !p.done && p.percent < pace
        const fmt = key === 'revenue' ? yen : v => v
        return (
          <div className="sales-gbar-row" key={key}>
            <div className="sales-gbar-meta"><span>{f.goalLabels[key]}</span><b>{fmt(p.value)} / {fmt(p.goal)}{p.done ? ` · ${f.done}` : ''}</b></div>
            <div className={`sales-gbar-track${p.done ? ' done' : behind ? ' behind' : ''}`}><i style={{ width: `${p.percent}%` }} /><em style={{ left: `${pace}%` }} /></div>
          </div>
        )
      })}
    </div>
  )
}

// v1.0.116 · why a client is in the follow-up ALERT (rule: expired quote OR 14+ days without contact)
const REASON_COPY = {
  en: { quote_expired: 'Quote expired', no_contact: d => `No contact for ${d} days`, hint: 'Alert = quote expired OR 14+ days without contact.' },
  ja: { quote_expired: '見積の期限切れ', no_contact: d => `${d}日間連絡なし`, hint: '通知の条件：見積の期限切れ、または14日以上連絡なし。' },
  pt: { quote_expired: 'Orçamento vencido', no_contact: d => `Sem contato há ${d} dias`, hint: 'Alerta = orçamento vencido OU 14+ dias sem contato.' },
}
export const alertReasonCopy = lang => REASON_COPY[lang] || REASON_COPY.en

export function AlertReasons({ alert, lang }) {
  if (!alert) return null
  const t = alertReasonCopy(lang)
  return <>{alert.reasons.map(r => <span key={r} className="sales-chip sales-chip-overdue">{r === 'quote_expired' ? `⏰ ${t.quote_expired}${alert.quote?.valid_until ? ` (${String(alert.quote.valid_until).slice(5, 10).replace('-', '/')})` : ''}` : `📵 ${t.no_contact(alert.sinceContact)}`}</span>)}</>
}
