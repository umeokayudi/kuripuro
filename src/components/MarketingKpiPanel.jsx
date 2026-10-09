import { useMemo, useState } from 'react'
import { RANGE_KEYS, attributionCoverage, budgetPacing, channelPerformance, delta, marketingSeries, rangeFor } from '../lib/salesKpi'
import { KpiTile, RangePills, TargetBar, TrendBars, num, pct, yen } from './SalesKpiParts'
import { monthElapsedPercent } from '../lib/salesFollowup'

const COPY = {
  en: {
    title: 'Marketing KPIs', sub: 'Spend, leads and contracts by channel. Tag every lead with a channel or campaign to measure it.',
    ranges: { month: 'This month', '3m': '3 months', '6m': '6 months', year: 'This year', '12m': '12 months' }, vsPrev: 'vs previous period',
    spend: 'Ad spend', leads: 'Leads from marketing', wins: 'Contracts won', cpl: 'Cost per lead', cac: 'Cost per customer', revenue: 'Revenue won / month', roi: '1st-year return', coverage: 'Leads with source',
    evolution: 'Evolution by month', empty: 'No marketing activity in this period yet.', goal: 'Goal', actual: 'Actual',
    metrics: { spend: 'Spend', leads: 'Leads', wins: 'Wins', cpl: 'CPL', cac: 'CAC', revenue: 'Revenue' },
    channels: 'Channel performance', channel: 'Channel', conversion: 'Lead → won', payback: 'Payback', months: m => `${m} mo`, noChannels: 'Create a channel to start tracking.',
    pacing: 'Budget pacing', pacingSub: 'Budget used vs share of the campaign period gone. Marker = time elapsed.', overPace: 'spending ahead of time', noBudgets: 'No campaign with a budget.',
    goals: 'Monthly marketing targets', goalsSub: 'Saved for everyone. Progress uses tracked spend, leads and contracts.', month: 'Month', save: 'Save targets', done: 'Reached',
    goalKeys: { leads: 'Leads', won: 'Contracts', revenue: 'Revenue / month', spend: 'Spend cap', max_cpl: 'Max cost per lead' },
  },
  ja: {
    title: 'マーケティングKPI', sub: 'チャネル別の広告費・リード・契約です。各リードにチャネルかキャンペーンを設定してください。',
    ranges: { month: '今月', '3m': '3ヶ月', '6m': '6ヶ月', year: '今年', '12m': '12ヶ月' }, vsPrev: '前期間比',
    spend: '広告費', leads: '集客リード', wins: '成約', cpl: 'リード単価', cac: '顧客獲得単価', revenue: '成約月額', roi: '初年度ROI', coverage: '流入元設定率',
    evolution: '月別の推移', empty: 'この期間のマーケティング活動はまだありません。', goal: '目標', actual: '実績',
    metrics: { spend: '広告費', leads: 'リード', wins: '成約', cpl: 'CPL', cac: 'CAC', revenue: '売上' },
    channels: 'チャネル実績', channel: 'チャネル', conversion: '成約率', payback: '回収期間', months: m => `${m}ヶ月`, noChannels: 'チャネルを作成すると計測が始まります。',
    pacing: '予算消化', pacingSub: '予算消化率とキャンペーン期間の経過率。印＝経過率。', overPace: '予定より早く消化中', noBudgets: '予算付きのキャンペーンはありません。',
    goals: '月間マーケティング目標', goalsSub: '全員に共有されます。進捗は記録された広告費・リード・契約から計算します。', month: '月', save: '目標を保存', done: '達成',
    goalKeys: { leads: 'リード', won: '成約', revenue: '月額売上', spend: '広告費上限', max_cpl: 'リード単価上限' },
  },
}

const FORMAT = { spend: yen, cpl: yen, cac: yen, revenue: yen }
const GOAL_FOR = { spend: 'spend', leads: 'leads', wins: 'won', revenue: 'revenue', cpl: 'max_cpl' }

export default function MarketingKpiPanel({ data, lang, today, onSaveGoal, busy }) {
  const t = COPY[lang === 'ja' ? 'ja' : 'en']
  const [rangeKey, setRangeKey] = useState('3m')
  const [metric, setMetric] = useState('leads')
  const [goalMonth, setGoalMonth] = useState(String(today).slice(0, 7))
  const [drafts, setDrafts] = useState({})
  const goals = useMemo(() => data?.marketing?.goals || [], [data])

  const view = useMemo(() => {
    const range = rangeFor(rangeKey, today)
    const chartRange = range.months.length >= 6 ? range : rangeFor('6m', today)
    const totals = r => {
      const rows = marketingSeries(data, r.months)
      const spend = rows.reduce((a, x) => a + x.spend, 0)
      const leads = rows.reduce((a, x) => a + x.leads, 0)
      const wins = rows.reduce((a, x) => a + x.wins, 0)
      const revenue = rows.reduce((a, x) => a + x.revenue, 0)
      return { spend, leads, wins, revenue, cpl: leads ? spend / leads : null, cac: wins ? spend / wins : null, roi: spend ? (revenue * 12 - spend) / spend * 100 : null }
    }
    const goalByMonth = new Map(goals.map(g => [g.period_month, g]))
    return {
      cur: totals(range), prev: totals(range.prev),
      series: marketingSeries(data, chartRange.months).map(row => ({ ...row, goal: goalByMonth.get(row.month) || null })),
      channels: channelPerformance(data, range),
      pacing: budgetPacing(data, today),
      coverage: attributionCoverage(data, range),
      month: marketingSeries(data, [goalMonth])[0],
    }
  }, [data, rangeKey, today, goals, goalMonth])

  const { cur, prev } = view
  const saved = goals.find(g => g.period_month === goalMonth) || {}
  const draft = drafts[goalMonth] || saved
  const setDraft = (key, value) => setDrafts(d => ({ ...d, [goalMonth]: { ...draft, [key]: value } }))
  const pace = goalMonth === String(today).slice(0, 7) ? monthElapsedPercent(today) : null
  const actualFor = { leads: view.month.leads, won: view.month.wins, revenue: view.month.revenue, spend: view.month.spend, max_cpl: view.month.cpl ?? 0 }

  return <section className="kpi-panel">
    <div className="kpi-head">
      <div><div className="card-title">{t.title}</div><p className="sales-muted">{t.sub}</p></div>
      <div className="kpi-controls"><RangePills value={rangeKey} onChange={setRangeKey} options={RANGE_KEYS.map(k => [k, t.ranges[k]])} /></div>
    </div>

    <div className="kpi-tiles">
      <KpiTile label={t.spend} value={yen(cur.spend)} delta={delta(cur.spend, prev.spend)} goodWhenDown vsLabel={t.vsPrev} />
      <KpiTile label={t.leads} value={num(cur.leads)} delta={delta(cur.leads, prev.leads)} vsLabel={t.vsPrev} />
      <KpiTile label={t.wins} value={num(cur.wins)} delta={delta(cur.wins, prev.wins)} vsLabel={t.vsPrev} />
      <KpiTile label={t.cpl} value={yen(cur.cpl)} delta={delta(cur.cpl, prev.cpl)} goodWhenDown vsLabel={t.vsPrev} />
      <KpiTile label={t.cac} value={yen(cur.cac)} delta={delta(cur.cac, prev.cac)} goodWhenDown vsLabel={t.vsPrev} />
      <KpiTile label={t.revenue} value={yen(cur.revenue)} delta={delta(cur.revenue, prev.revenue)} vsLabel={t.vsPrev} />
      <KpiTile label={t.roi} value={pct(cur.roi)} delta={cur.roi != null && prev.roi != null ? Math.round(cur.roi - prev.roi) : null} unit=" pt" vsLabel={t.vsPrev} />
      <KpiTile label={t.coverage} value={pct(view.coverage.rate)} hint={`${view.coverage.tagged}/${view.coverage.leads}`} />
    </div>

    <div className="card kpi-card kpi-wide">
      <div className="kpi-card-head"><div className="card-title">{t.evolution}</div><div className="kpi-pills kpi-pills-sm">{Object.keys(t.metrics).map(k => <button type="button" key={k} className={metric === k ? 'active' : ''} onClick={() => setMetric(k)}>{t.metrics[k]}</button>)}</div></div>
      <TrendBars rows={view.series} valueKey={metric} goalKey={GOAL_FOR[metric]} format={FORMAT[metric] || num} lang={lang} goalLabel={t.goal} actualLabel={t.actual} emptyLabel={t.empty} />
    </div>

    <div className="card kpi-card kpi-wide">
      <div className="card-title">{t.channels} · {t.ranges[rangeKey]}</div>
      {view.channels.length === 0 ? <p className="sales-muted">{t.noChannels}</p> : <div className="kpi-table-wrap"><table className="kpi-table">
        <thead><tr><th>{t.channel}</th><th>{t.spend}</th><th>{t.metrics.leads}</th><th>{t.metrics.wins}</th><th>{t.conversion}</th><th>{t.cpl}</th><th>{t.cac}</th><th>{t.revenue}</th><th>{t.roi}</th><th>{t.payback}</th></tr></thead>
        <tbody>{view.channels.map(row => <tr key={row.id}>
          <td><b>{row.name}</b></td><td>{yen(row.spend)}</td><td>{row.leads}</td><td>{row.wins}</td><td>{pct(row.conversion)}</td><td>{yen(row.cpl)}</td><td>{yen(row.cac)}</td><td>{yen(row.revenue)}</td>
          <td className={row.roi == null ? '' : row.roi >= 0 ? 'kpi-good' : 'kpi-bad'}>{row.roi == null ? '—' : `${row.roi >= 0 ? '▲' : '▼'} ${pct(Math.abs(row.roi))}`}</td>
          <td>{row.paybackMonths == null ? '—' : t.months(row.paybackMonths)}</td>
        </tr>)}</tbody>
      </table></div>}
    </div>

    <div className="kpi-grid kpi-grid-2">
      <div className="card kpi-card">
        <div className="card-title">{t.pacing}</div><p className="sales-muted">{t.pacingSub}</p>
        {view.pacing.length === 0 && <p className="sales-muted">{t.noBudgets}</p>}
        {view.pacing.map(row => <TargetBar key={row.id} label={`${row.name}${row.overPace ? ` · ${t.overPace}` : ''}`} value={row.used} target={row.budget} format={yen} pace={row.elapsed} invert doneLabel={t.done} />)}
      </div>

      <div className="card kpi-card">
        <div className="kpi-card-head"><div><div className="card-title">{t.goals}</div><p className="sales-muted">{t.goalsSub}</p></div><label className="sales-period-filter"><span>{t.month}</span><input type="month" value={goalMonth} onChange={e => setGoalMonth(e.target.value || String(today).slice(0, 7))} /></label></div>
        {['leads', 'won', 'revenue', 'spend', 'max_cpl'].map(key => <TargetBar key={key} label={t.goalKeys[key]} value={actualFor[key]} target={Number(saved[key] || 0)} format={['revenue', 'spend', 'max_cpl'].includes(key) ? yen : num} pace={['spend', 'max_cpl'].includes(key) ? null : pace} invert={['spend', 'max_cpl'].includes(key)} doneLabel={t.done} />)}
        {onSaveGoal && <>
          <div className="sales-goal-inputs kpi-goal-inputs">{['leads', 'won', 'revenue', 'spend', 'max_cpl'].map(key => <label key={key}><span>{t.goalKeys[key]}</span><input type="number" min="0" step={['revenue', 'spend', 'max_cpl'].includes(key) ? '1000' : '1'} value={draft[key] ?? ''} onChange={e => setDraft(key, e.target.value)} /></label>)}</div>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onSaveGoal(goalMonth, draft)}>{t.save}</button>
        </>}
      </div>
    </div>
  </section>
}
