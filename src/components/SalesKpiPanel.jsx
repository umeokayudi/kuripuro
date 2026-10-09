import { useMemo, useState } from 'react'
import {
  RANGE_KEYS, closingStats, delta, followupHealth, funnel, goalAttainment, leaderboard, monthlySeries,
  periodTotals, pipeline, rangeFor, scopeData, sourceBreakdown,
} from '../lib/salesKpi'
import { FunnelBars, KpiTile, RangePills, RankBars, StackBar, TrendBars, num, pct, yen } from './SalesKpiParts'

const COPY = {
  en: {
    title: 'KPIs & evolution', sub: 'Every number comes from logged approaches, contacts, quotes and approved contracts.',
    ranges: { month: 'This month', '3m': '3 months', '6m': '6 months', year: 'This year', '12m': '12 months' },
    everyone: 'Whole team', vsPrev: 'vs previous period',
    revenue: 'Contracted / month', wins: 'Deals won', winRate: 'Win rate', leads: 'New leads', contacts: 'Contacts logged', approaches: 'Approaches', quotes: 'Quotes sent', daysToClose: 'Median days to close', attainment: 'Goal attainment',
    days: d => `${d} days`, noGoal: 'no goal set',
    evolution: 'Evolution by month', goal: 'Goal', actual: 'Actual', empty: 'No activity in this period yet.',
    metrics: { revenue: 'Revenue', wins: 'Wins', leads: 'Leads', contacts: 'Contacts', approaches: 'Approaches', quotes: 'Quotes', attainment: 'Goal %' },
    funnel: 'Conversion funnel', funnelSub: 'Leads that started in the period and how far they got.',
    steps: { approaches: 'Approaches', leads: 'Leads', contacted: 'Contacted', quoted: 'Quoted', won: 'Won' }, conv: 'of previous',
    leadToWin: 'Lead → won',
    followup: 'Follow-up discipline', followupSub: 'Open clients today.', onTrack: 'On schedule', overdue: 'Overdue', stale: '14+ days silent', missing: 'No next date', avgSince: 'Avg. days since last contact', onTrackRate: 'On schedule',
    closing: 'Closing', avgDays: 'Average', fastest: 'Fastest', slowest: 'Slowest', contactsPerWin: 'Contacts per win', lost: 'Lost', lostReasons: 'Why deals were lost', noLost: 'No lost deals in this period.',
    pipeline: 'Open pipeline', pipelineValue: 'Expected / month', openLeads: 'Open leads', quoteValue: 'Quoted value', weighted: 'Weighted forecast', weightedHint: 'Expected value × chance by stage',
    stages: { approach: 'Approach', followup: 'Follow-up', quote: 'Quote', negotiation: 'Negotiation' },
    sources: 'Where leads come from', winRateShort: 'won',
    efficiency: 'Field efficiency', hours: 'Hours worked', perHour: 'Approaches / hour', travel: 'Travel cost', travelPerWin: 'Travel per win', avgDeal: 'Avg. deal / month',
    ranking: 'Seller ranking', seller: 'Seller', inactive: 'inactive',
  },
  ja: {
    title: 'KPI・推移', sub: 'すべて記録された営業活動・連絡・見積・承認済み契約から計算しています。',
    ranges: { month: '今月', '3m': '3ヶ月', '6m': '6ヶ月', year: '今年', '12m': '12ヶ月' },
    everyone: 'チーム全体', vsPrev: '前期間比',
    revenue: '月額契約', wins: '成約', winRate: '成約率', leads: '新規リード', contacts: '連絡数', approaches: '営業活動', quotes: '見積', daysToClose: '成約までの日数 (中央値)', attainment: '目標達成率',
    days: d => `${d}日`, noGoal: '目標未設定',
    evolution: '月別の推移', goal: '目標', actual: '実績', empty: 'この期間の活動はまだありません。',
    metrics: { revenue: '売上', wins: '成約', leads: 'リード', contacts: '連絡', approaches: '営業活動', quotes: '見積', attainment: '達成率' },
    funnel: 'コンバージョン', funnelSub: '期間内に開始したリードの進捗です。',
    steps: { approaches: '営業活動', leads: 'リード', contacted: '連絡済み', quoted: '見積済み', won: '成約' }, conv: '前段階比',
    leadToWin: 'リード → 成約',
    followup: 'フォローアップ状況', followupSub: '現在の進行中顧客。', onTrack: '予定どおり', overdue: '期限超過', stale: '14日以上連絡なし', missing: '次回日未設定', avgSince: '最終連絡からの平均日数', onTrackRate: '予定どおり',
    closing: 'クロージング', avgDays: '平均', fastest: '最短', slowest: '最長', contactsPerWin: '成約あたり連絡数', lost: '失注', lostReasons: '失注理由', noLost: 'この期間の失注はありません。',
    pipeline: '進行中の案件', pipelineValue: '見込み月額', openLeads: '進行中リード', quoteValue: '見積総額', weighted: '加重見込み', weightedHint: '見込み額 × 段階ごとの確度',
    stages: { approach: 'アプローチ', followup: 'フォロー中', quote: '見積', negotiation: '交渉中' },
    sources: 'リードの流入元', winRateShort: '成約',
    efficiency: '活動効率', hours: '稼働時間', perHour: '1時間あたり活動', travel: '交通費', travelPerWin: '成約あたり交通費', avgDeal: '平均月額',
    ranking: '営業ランキング', seller: '担当', inactive: '無効',
  },
}

const METRIC_FORMAT = { revenue: yen, attainment: pct }
const METRIC_GOAL = { revenue: 'revenue', leads: 'leads', contacts: 'contacts', approaches: 'approaches', quotes: 'quotes', wins: 'contracts' }

export default function SalesKpiPanel({ data, lang, sellers = null, today, channels = [] }) {
  const t = COPY[lang === 'ja' ? 'ja' : 'en']
  const [rangeKey, setRangeKey] = useState('6m')
  const [sellerId, setSellerId] = useState('')
  const [metric, setMetric] = useState('revenue')
  const isAdmin = Array.isArray(sellers)

  const view = useMemo(() => {
    const range = rangeFor(rangeKey, today)
    const scoped = scopeData(data, isAdmin ? sellerId : '')
    const cur = periodTotals(scoped, range)
    const prev = periodTotals(scoped, range.prev)
    const goalsIn = r => scoped.goals.filter(g => g.period_month >= r.from && g.period_month <= r.to)
    const sumGoals = rows => rows.length ? Object.fromEntries(['approaches', 'contacts', 'leads', 'quotes', 'contracts', 'revenue'].map(k => [k, rows.reduce((a, g) => a + Number(g[k] || 0), 0)])) : null
    // The evolution chart always shows at least 6 months so the trend is visible.
    const chartRange = range.months.length >= 6 ? range : rangeFor('6m', today)
    return {
      range, cur, prev,
      attainment: goalAttainment(cur, sumGoals(goalsIn(range))),
      prevAttainment: goalAttainment(prev, sumGoals(goalsIn(range.prev))),
      series: monthlySeries(scoped, chartRange.months),
      funnel: funnel(scoped, range),
      closing: closingStats(scoped, range),
      prevClosing: closingStats(scoped, range.prev),
      health: followupHealth(scoped, today),
      pipe: pipeline(scoped),
      sources: sourceBreakdown(scoped, range, channels).slice(0, 8),
      board: isAdmin ? leaderboard(data, sellers, range) : [],
    }
  }, [data, rangeKey, sellerId, today, isAdmin, sellers, channels])

  const { cur, prev, closing } = view
  const leadToWin = view.funnel[1].value ? view.funnel[4].value / view.funnel[1].value * 100 : null
  const metricKeys = Object.keys(t.metrics)

  return <section className="kpi-panel">
    <div className="kpi-head">
      <div><div className="card-title">{t.title}</div><p className="sales-muted">{t.sub}</p></div>
      <div className="kpi-controls">
        {isAdmin && <select aria-label={t.seller} value={sellerId} onChange={e => setSellerId(e.target.value)}><option value="">{t.everyone}</option>{sellers.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>}
        <RangePills value={rangeKey} onChange={setRangeKey} options={RANGE_KEYS.map(k => [k, t.ranges[k]])} />
      </div>
    </div>

    <div className="kpi-tiles">
      <KpiTile label={t.revenue} value={yen(cur.revenue)} delta={delta(cur.revenue, prev.revenue)} vsLabel={t.vsPrev} />
      <KpiTile label={t.wins} value={num(cur.wins)} delta={delta(cur.wins, prev.wins)} vsLabel={t.vsPrev} />
      <KpiTile label={t.winRate} value={pct(cur.winRate)} delta={cur.winRate != null && prev.winRate != null ? Math.round(cur.winRate - prev.winRate) : null} unit=" pt" vsLabel={t.vsPrev} hint={`${cur.wins}/${cur.wins + cur.losses}`} />
      <KpiTile label={t.leads} value={num(cur.leads)} delta={delta(cur.leads, prev.leads)} vsLabel={t.vsPrev} />
      <KpiTile label={t.contacts} value={num(cur.contacts)} delta={delta(cur.contacts, prev.contacts)} vsLabel={t.vsPrev} />
      <KpiTile label={t.approaches} value={num(cur.approaches)} delta={delta(cur.approaches, prev.approaches)} vsLabel={t.vsPrev} />
      <KpiTile label={t.daysToClose} value={closing.medianDays == null ? '—' : t.days(Math.round(closing.medianDays))} delta={delta(closing.medianDays, view.prevClosing.medianDays)} goodWhenDown vsLabel={t.vsPrev} />
      <KpiTile label={t.attainment} value={view.attainment == null ? '—' : pct(view.attainment)} delta={view.attainment != null && view.prevAttainment != null ? view.attainment - view.prevAttainment : null} unit=" pt" hint={view.attainment == null ? t.noGoal : undefined} vsLabel={t.vsPrev} />
    </div>

    <div className="card kpi-card kpi-wide">
      <div className="kpi-card-head"><div className="card-title">{t.evolution}</div><div className="kpi-pills kpi-pills-sm">{metricKeys.map(k => <button type="button" key={k} className={metric === k ? 'active' : ''} onClick={() => setMetric(k)}>{t.metrics[k]}</button>)}</div></div>
      <TrendBars rows={view.series} valueKey={metric} goalKey={METRIC_GOAL[metric]} format={METRIC_FORMAT[metric] || num} lang={lang} goalLabel={t.goal} actualLabel={t.actual} emptyLabel={t.empty} />
    </div>

    <div className="kpi-grid">
      <div className="card kpi-card">
        <div className="card-title">{t.funnel}</div><p className="sales-muted">{t.funnelSub}</p>
        <FunnelBars steps={view.funnel} labels={t.steps} convLabel={t.conv} />
        <div className="kpi-foot-stat"><span>{t.leadToWin}</span><b>{pct(leadToWin)}</b></div>
      </div>

      <div className="card kpi-card">
        <div className="card-title">{t.followup}</div><p className="sales-muted">{t.followupSub}</p>
        <StackBar parts={[
          { key: 'ok', label: t.onTrack, value: view.health.onTrack, tone: 'good' },
          { key: 'overdue', label: t.overdue, value: view.health.overdue, tone: 'bad' },
          { key: 'stale', label: t.stale, value: view.health.stale, tone: 'warn' },
          { key: 'missing', label: t.missing, value: view.health.missing, tone: 'muted' },
        ]} />
        <div className="kpi-mini-stats">
          <span><b>{pct(view.health.onTrackRate)}</b>{t.onTrackRate}</span>
          <span><b>{view.health.avgDaysSinceContact == null ? '—' : t.days(view.health.avgDaysSinceContact)}</b>{t.avgSince}</span>
        </div>
      </div>

      <div className="card kpi-card">
        <div className="card-title">{t.closing}</div>
        <div className="kpi-mini-stats">
          <span><b>{closing.medianDays == null ? '—' : t.days(Math.round(closing.medianDays))}</b>{t.daysToClose}</span>
          <span><b>{closing.avgDays == null ? '—' : t.days(closing.avgDays)}</b>{t.avgDays}</span>
          <span><b>{closing.fastest == null ? '—' : `${t.days(closing.fastest)} – ${t.days(closing.slowest)}`}</b>{t.fastest} – {t.slowest}</span>
          <span><b>{num(closing.contactsPerWin, 1)}</b>{t.contactsPerWin}</span>
          <span><b>{closing.won} / {closing.lost}</b>{t.wins} / {t.lost}</span>
          <span><b>{yen(cur.avgDeal)}</b>{t.avgDeal}</span>
        </div>
        <div className="kpi-sub-title">{t.lostReasons}</div>
        {closing.lostReasons.length ? <RankBars rows={closing.lostReasons.slice(0, 6)} labelKey="reason" valueKey="count" /> : <p className="sales-muted">{t.noLost}</p>}
      </div>

      <div className="card kpi-card">
        <div className="card-title">{t.pipeline}</div>
        <div className="kpi-mini-stats">
          <span><b>{num(view.pipe.count)}</b>{t.openLeads}</span>
          <span><b>{yen(view.pipe.value)}</b>{t.pipelineValue}</span>
          <span title={t.weightedHint}><b>{yen(view.pipe.weighted)}</b>{t.weighted}</span>
        </div>
        <RankBars rows={view.pipe.stages.map(s => ({ ...s, label: t.stages[s.stage] }))} labelKey="label" valueKey="count" extra={row => yen(row.value)} />
      </div>

      <div className="card kpi-card">
        <div className="card-title">{t.sources}</div>
        {view.sources.length ? <RankBars rows={view.sources} labelKey="source" valueKey="leads" extra={row => `${pct(row.winRate)} ${t.winRateShort}`} /> : <p className="sales-muted">{t.empty}</p>}
      </div>

      <div className="card kpi-card">
        <div className="card-title">{t.efficiency}</div>
        <div className="kpi-mini-stats">
          <span><b>{num(cur.hours, 1)}</b>{t.hours}</span>
          <span><b>{num(cur.approachesPerHour, 2)}</b>{t.perHour}</span>
          <span><b>{yen(cur.travel)}</b>{t.travel}</span>
          <span><b>{cur.wins ? yen(cur.travel / cur.wins) : '—'}</b>{t.travelPerWin}</span>
          <span><b>{num(cur.quotes)}</b>{t.quotes}</span>
          <span><b>{yen(cur.quoteValue)}</b>{t.quoteValue}</span>
        </div>
      </div>
    </div>

    {isAdmin && <div className="card kpi-card kpi-wide">
      <div className="card-title">{t.ranking} · {t.ranges[rangeKey]}</div>
      <div className="kpi-table-wrap"><table className="kpi-table">
        <thead><tr><th>{t.seller}</th><th>{t.revenue}</th><th>{t.wins}</th><th>{t.winRate}</th><th>{t.leads}</th><th>{t.contacts}</th><th>{t.approaches}</th><th>{t.attainment}</th></tr></thead>
        <tbody>{view.board.map(row => <tr key={row.id} className={sellerId === row.id ? 'selected' : ''} onClick={() => setSellerId(sellerId === row.id ? '' : row.id)}>
          <td><b>{row.name}</b>{!row.active && <small> · {t.inactive}</small>}</td>
          <td>{yen(row.revenue)}</td><td>{row.wins}</td><td>{pct(row.winRate)}</td><td>{row.leads}</td><td>{row.contacts}</td><td>{row.approaches}</td>
          <td>{row.attainment == null ? <small className="sales-muted">{t.noGoal}</small> : <span className="kpi-inline-bar"><i style={{ width: `${row.attainment}%` }} /><b>{pct(row.attainment)}</b></span>}</td>
        </tr>)}</tbody>
      </table></div>
    </div>}
  </section>
}
