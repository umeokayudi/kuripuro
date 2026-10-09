import { useMemo, useState } from 'react'
import { salesPost } from '../lib/salesApi'
import { aiDigest, quoteStats, regionBreakdown, responseBreakdown, stageBoard, weekdayTiming } from '../lib/salesInsights'
import { KpiTile, RankBars, num, pct, yen } from './SalesKpiParts'

const COPY = {
  en: {
    board: 'Funnel by client', boardSub: 'Where each client is right now. Won and lost show deals closed in the period.',
    stages: { approach: 'Approach', followup: 'Follow-up', quote: 'Quote sent', negotiation: 'Negotiation', won: 'Won', lost: 'Lost' },
    days: d => `${d}d in stage`, next: 'Next', overdue: 'overdue', none: 'No clients here.', more: n => `+${n} more`,
    quotes: 'Quotes: approval and price', sent: 'Quotes sent', accepted: 'Approved', declined: 'Declined', open: 'Waiting answer', acceptance: 'Approval rate',
    avgTotal: 'Avg. quote', avgAcc: 'Avg. approved quote', avgDec: 'Avg. declined quote', itemPrice: 'Avg. price per item', itemAcc: 'Per item (approved)', itemDec: 'Per item (declined)', answerDays: 'Days to answer', itemsPerQuote: 'Items per quote',
    byItem: 'Price per item', item: 'Item', timesQuoted: 'Quoted', avgPrice: 'Avg. price', avgPriceAcc: 'When approved', avgPriceDec: 'When declined', approval: 'Approval',
    bands: 'Which quote size sells best', band: 'Quote size', declineReasons: 'Why quotes were declined', noQuotes: 'No quotes sent in this period.',
    regions: 'By region', region: 'Region', leads: 'Leads', wins: 'Won', losses: 'Lost', winRate: 'Win rate', noRegions: 'Add addresses or regions to leads to see this.',
    answers: 'What clients answer most', answersSub: 'From the answer type picked when logging each contact.', share: 'of answers', winAfter: 'won after', noAnswers: 'Pick the answer type when you log a contact to fill this.',
    tags: { interested: 'Interested', asked_quote: 'Asked for a quote', price_high: 'Price too high', has_vendor: 'Already has a vendor', timing: 'Not now / timing', need_approval: 'Needs boss approval', no_need: 'No need', no_answer: 'No answer / absent', other: 'Other' },
    mood: 'Mood of contacts', moods: { positive: 'Positive', neutral: 'Neutral', negative: 'Negative' },
    weekday: 'Best day to contact', weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], positive: 'positive',
    ai: 'AI sales analysis', aiSub: 'The AI reads these numbers and the client answers, and explains why deals close or not, which price sells, where, when, and how to answer the most common objections.', ask: 'Analyse with AI', asking: 'Analysing…', aiNote: 'Suggestions for a person to review.',
  },
  ja: {
    board: '顧客別ファネル', boardSub: '各顧客の現在の段階です。成約・失注は期間内に決まった案件です。',
    stages: { approach: 'アプローチ', followup: 'フォロー中', quote: '見積送付', negotiation: '交渉中', won: '成約', lost: '失注' },
    days: d => `この段階で${d}日`, next: '次回', overdue: '期限超過', none: '該当なし', more: n => `他${n}件`,
    quotes: '見積：承認率と価格', sent: '送付見積', accepted: '承認', declined: '不成立', open: '回答待ち', acceptance: '承認率',
    avgTotal: '見積平均', avgAcc: '承認見積の平均', avgDec: '不成立見積の平均', itemPrice: '項目あたり平均単価', itemAcc: '単価（承認）', itemDec: '単価（不成立）', answerDays: '回答までの日数', itemsPerQuote: '見積あたり項目数',
    byItem: '項目別の単価', item: '項目', timesQuoted: '見積回数', avgPrice: '平均単価', avgPriceAcc: '承認時', avgPriceDec: '不成立時', approval: '承認率',
    bands: '売れやすい見積金額帯', band: '金額帯', declineReasons: '不成立の理由', noQuotes: 'この期間の見積送付はありません。',
    regions: '地域別', region: '地域', leads: 'リード', wins: '成約', losses: '失注', winRate: '成約率', noRegions: 'リードに住所か地域を入力すると表示されます。',
    answers: 'お客様の返答で多いもの', answersSub: '連絡記録で選んだ返答の種類から集計。', share: '割合', winAfter: 'その後成約', noAnswers: '連絡記録で返答の種類を選ぶと表示されます。',
    tags: { interested: '前向き', asked_quote: '見積依頼', price_high: '価格が高い', has_vendor: '既存業者あり', timing: '時期が合わない', need_approval: '上司の承認待ち', no_need: '必要なし', no_answer: '不在・返答なし', other: 'その他' },
    mood: '連絡時の温度感', moods: { positive: '良い', neutral: '普通', negative: '悪い' },
    weekday: '連絡に良い曜日', weekdays: ['日', '月', '火', '水', '木', '金', '土'], positive: '好反応',
    ai: 'AI営業分析', aiSub: '数値とお客様の返答をAIが読み、成約・失注の理由、売れる価格、地域、タイミング、よくある断り文句への返し方を説明します。', ask: 'AIで分析', asking: '分析中…', aiNote: '提案は担当者が確認してください。',
  },
}

const CARD_LIMIT = 8
const kYen = n => (n >= 10000 ? `¥${Math.round(n / 1000).toLocaleString()}k` : yen(n))

export default function SalesInsightsPanel({ scoped, range, today, lang, sellers = [], totals, closing, board = [], showSeller }) {
  const t = COPY[lang === 'ja' ? 'ja' : 'en']
  const [aiText, setAiText] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [openStage, setOpenStage] = useState('')

  const view = useMemo(() => ({
    board: stageBoard(scoped, range, today, sellers),
    quotes: quoteStats(scoped, range),
    regions: regionBreakdown(scoped, range),
    answers: responseBreakdown(scoped, range),
    weekday: weekdayTiming(scoped, range),
  }), [scoped, range, today, sellers])
  const { quotes: q, answers } = view
  const bestDay = view.weekday.filter(w => w.contacts >= 3).sort((a, b) => (b.positiveRate ?? 0) - (a.positiveRate ?? 0))[0]

  const askAi = async () => {
    setAiBusy(true); setAiError('')
    try {
      const digest = aiDigest({ scoped, range, totals, closing, sellersRows: board, today })
      const { answer } = await salesPost('/api/sales-ai', { task: 'sales-insights', text: JSON.stringify(digest), language: lang === 'ja' ? 'ja' : 'pt' }, lang)
      setAiText(String(answer || ''))
    } catch (e) { setAiError(e.message) }
    finally { setAiBusy(false) }
  }

  return <>
    <div className="card kpi-card kpi-wide">
      <div className="card-title">{t.board}</div><p className="sales-muted">{t.boardSub}</p>
      <div className="kpi-board" role="list">
        {view.board.map(col => {
          const expanded = openStage === col.stage
          const cards = expanded ? col.cards : col.cards.slice(0, CARD_LIMIT)
          return <div className={`kpi-board-col kpi-board-${col.stage}`} key={col.stage} role="listitem">
            <div className="kpi-board-head"><b>{t.stages[col.stage]}</b><span>{col.count}</span>{col.value > 0 && <small>{yen(col.value)}</small>}</div>
            {col.cards.length === 0 && <p className="kpi-board-empty">{t.none}</p>}
            {cards.map(card => <div className={`kpi-board-card${card.overdue ? ' overdue' : ''}`} key={card.id}>
              <strong title={card.company}>{card.name}</strong>
              <small>{[showSeller && card.seller, card.region !== '—' && card.region, card.value ? yen(card.value) : ''].filter(Boolean).join(' · ')}</small>
              {card.lastTag && <span className={`sales-chip sales-chip-tag${card.sentiment ? ` sales-sentiment-${card.sentiment}` : ''}`}>{t.tags[card.lastTag] || card.lastTag}</span>}
              {card.lastResponse && <q className="kpi-quote-text">{card.lastResponse}</q>}
              {col.stage === 'lost' && card.lostReason && <small className="kpi-bad">{card.lostReason}</small>}
              {!['won', 'lost'].includes(col.stage) && <small className={card.overdue ? 'kpi-bad' : 'sales-muted'}>{card.next ? `${t.next}: ${card.next}${card.overdue ? ` · ${t.overdue}` : ''}` : ''}{card.daysInStage != null ? `${card.next ? ' · ' : ''}${t.days(card.daysInStage)}` : ''}</small>}
            </div>)}
            {col.cards.length > CARD_LIMIT && <button type="button" className="btn btn-sm kpi-board-more" onClick={() => setOpenStage(expanded ? '' : col.stage)}>{expanded ? '−' : t.more(col.cards.length - CARD_LIMIT)}</button>}
          </div>
        })}
      </div>
    </div>

    <div className="card kpi-card kpi-wide">
      <div className="card-title">{t.quotes}</div>
      {q.sent === 0 ? <p className="sales-muted">{t.noQuotes}</p> : <>
        <div className="kpi-tiles kpi-tiles-compact">
          <KpiTile label={t.sent} value={num(q.sent)} hint={`${q.accepted} ${t.accepted} · ${q.declined} ${t.declined} · ${q.open} ${t.open}`} />
          <KpiTile label={t.acceptance} value={pct(q.acceptance)} hint={`${q.accepted}/${q.accepted + q.declined}`} />
          <KpiTile label={t.avgTotal} value={yen(q.avgTotal)} hint={`${t.avgAcc} ${yen(q.avgAcceptedTotal)} · ${t.avgDec} ${yen(q.avgDeclinedTotal)}`} />
          <KpiTile label={t.itemPrice} value={yen(q.avgItemPrice)} hint={`${t.itemAcc} ${yen(q.avgAcceptedItemPrice)} · ${t.itemDec} ${yen(q.avgDeclinedItemPrice)}`} />
          <KpiTile label={t.answerDays} value={q.avgDecisionDays == null ? '—' : num(q.avgDecisionDays)} hint={`${t.itemsPerQuote}: ${num(q.itemsPerQuote, 1)}`} />
        </div>
        <div className="kpi-grid kpi-grid-2">
          <div>
            <div className="kpi-sub-title">{t.byItem}</div>
            <div className="kpi-table-wrap"><table className="kpi-table">
              <thead><tr><th>{t.item}</th><th>{t.timesQuoted}</th><th>{t.avgPrice}</th><th>{t.avgPriceAcc}</th><th>{t.avgPriceDec}</th><th>{t.approval}</th></tr></thead>
              <tbody>{q.byItem.slice(0, 12).map(row => <tr key={row.item}><td><b>{row.item}</b></td><td>{row.quotes}</td><td>{yen(row.avgPrice)}</td><td>{yen(row.avgAccepted)}</td><td>{yen(row.avgDeclined)}</td><td>{pct(row.acceptance)}</td></tr>)}</tbody>
            </table></div>
          </div>
          <div>
            <div className="kpi-sub-title">{t.bands}</div>
            {q.priceBands.length ? <RankBars rows={q.priceBands.map(b => ({ label: `${kYen(b.from)}–${kYen(b.to)}`, acceptance: b.acceptance ?? 0, quotes: b.quotes }))} labelKey="label" valueKey="acceptance" format={pct} extra={row => `${row.quotes}`} /> : <p className="sales-muted">—</p>}
            <div className="kpi-sub-title">{t.declineReasons}</div>
            {q.declineReasons.length ? <RankBars rows={q.declineReasons.slice(0, 6)} labelKey="reason" valueKey="count" /> : <p className="sales-muted">—</p>}
          </div>
        </div>
      </>}
    </div>

    <div className="kpi-grid">
      <div className="card kpi-card">
        <div className="card-title">{t.answers}</div><p className="sales-muted">{t.answersSub}</p>
        {answers.tags.length ? <div className="kpi-answers">{answers.tags.slice(0, 8).map(row => <div className="kpi-answer" key={row.tag}>
          <div className="kpi-rank-row"><span className="kpi-rank-label">{t.tags[row.tag] || row.tag}</span><div className="kpi-rank-track"><i style={{ width: `${row.share || 0}%` }} /></div><b>{row.count}</b><small>{pct(row.share)} · {pct(row.winRate)} {t.winAfter}</small></div>
          {row.examples[0] && <q className="kpi-quote-text">{row.examples[0]}</q>}
        </div>)}</div> : <p className="sales-muted">{t.noAnswers}</p>}
        <div className="kpi-sub-title">{t.mood}</div>
        <div className="kpi-mini-stats">{Object.entries(t.moods).map(([key, label]) => <span key={key}><b className={`sales-sentiment-text-${key}`}>{answers.sentiments[key] || 0}</b>{label}</span>)}</div>
      </div>

      <div className="card kpi-card">
        <div className="card-title">{t.regions}</div>
        {view.regions.length ? <div className="kpi-table-wrap"><table className="kpi-table">
          <thead><tr><th>{t.region}</th><th>{t.leads}</th><th>{t.sent}</th><th>{t.wins}</th><th>{t.losses}</th><th>{t.winRate}</th></tr></thead>
          <tbody>{view.regions.slice(0, 10).map(row => <tr key={row.region}><td><b>{row.region}</b></td><td>{row.leads}</td><td>{row.quotes}</td><td>{row.wins}</td><td>{row.losses}</td><td>{pct(row.winRate)}</td></tr>)}</tbody>
        </table></div> : <p className="sales-muted">{t.noRegions}</p>}
      </div>

      <div className="card kpi-card">
        <div className="card-title">{t.weekday}</div>
        <RankBars rows={view.weekday.filter(w => w.weekday > 0 || w.contacts).map(w => ({ label: t.weekdays[w.weekday], contacts: w.contacts, positiveRate: w.positiveRate }))} labelKey="label" valueKey="contacts" extra={row => `${pct(row.positiveRate)} ${t.positive}`} />
        {bestDay && <div className="kpi-foot-stat"><span>{t.weekdays[bestDay.weekday]}</span><b>{pct(bestDay.positiveRate)} {t.positive}</b></div>}
      </div>
    </div>

    <div className="card kpi-card kpi-wide kpi-ai-card">
      <div className="kpi-card-head"><div><div className="card-title">{t.ai}</div><p className="sales-muted">{t.aiSub}</p></div><button type="button" className="btn btn-primary" disabled={aiBusy} onClick={askAi}>{aiBusy ? t.asking : t.ask}</button></div>
      {aiError && <p className="kpi-bad">{aiError}</p>}
      {aiText && <><div className="sales-ai-result kpi-ai-text">{aiText}</div><small className="sales-muted">{t.aiNote}</small></>}
    </div>
  </>
}

