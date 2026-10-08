import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { buildDeepCleanProgress, currentYearMonth, formatScheduleDate, tuesdaySlotInfo, DEEP_CLEAN_LOCATIONS } from '../lib/cleaningType'
import { useLang, fill } from '../hooks/useLang'
import { groupRatingsByClient, ratingsInPeriod, avgStars, starsDisplay } from '../lib/satisfaction'
import { LineChart } from '../components/AnalyticsCharts'
import toast from 'react-hot-toast'

const tokyoToday = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).split(' ')[0]

export default function Dashboard() {
  const { lang, t } = useLang()
  const d = t.dashboard
  const slotLabels = { ...d, status: t.status }
  const dateLocale = lang === 'ja' ? 'ja-JP' : 'en-GB'

  const [clients, setClients] = useState([])
  const [employees, setEmployees] = useState([])
  const [todayJobs, setTodayJobs] = useState([])
  const [staleCount, setStaleCount] = useState(0)
  const [evals, setEvals] = useState([])
  const [monthJobs, setMonthJobs] = useState([])
  const [clientRatings, setClientRatings] = useState([])
  const [trendJobs, setTrendJobs] = useState([])
  const [trendCashflow, setTrendCashflow] = useState([])
  const [trendMonth, setTrendMonth] = useState(currentYearMonth())
  const [metricPeriod, setMetricPeriod] = useState('month')
  const [metricDay, setMetricDay] = useState(tokyoToday())
  const [editMetrics, setEditMetrics] = useState(false)
  const [visibleMetrics, setVisibleMetrics] = useState(() => {
    try { return JSON.parse(localStorage.getItem('kuripuro-dashboard-metrics')) || ['revenue', 'clients'] }
    catch { return ['revenue', 'clients'] }
  })
  const [progressMonth, setProgressMonth] = useState(currentYearMonth())
  const [detailLoc, setDetailLoc] = useState(null)
  const [detailTuesday, setDetailTuesday] = useState(null)
  const [loading, setLoading] = useState(true)
  const [clock, setClock] = useState(new Date())
  const [lastUpdate, setLastUpdate] = useState(null)

  const load = async () => {
    const today = tokyoToday()
    const monthStart = progressMonth + '-01'
    const monthEnd = progressMonth + '-31'
    const [trendYear, trendMonthNum] = trendMonth.split('-').map(Number)
    const metricYear = Number(metricDay.slice(0, 4))
    const startYear = Math.min(trendYear, metricYear)
    const endYear = Math.max(trendYear, metricYear)
    const trendStart = new Date(Date.UTC(startYear, 0, 1)).toISOString().slice(0, 10)
    const trendEnd = new Date(Date.UTC(endYear + 1, 0, 1)).toISOString().slice(0, 10)
    const [c, e, j, ev, stale, mj, cr, tj, tc] = await Promise.all([
      supabase.from('clients').select('*').eq('is_active', true),
      supabase.from('employees').select('id,full_name,score,is_active').eq('is_active', true).order('full_name'),
      supabase.from('jobs').select('*').eq('scheduled_date', today).order('scheduled_time'),
      supabase.from('evaluations').select('*').order('created_at', { ascending: false }).limit(5),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'assigned').lt('scheduled_date', today),
      supabase.from('jobs').select('*').gte('scheduled_date', monthStart).lte('scheduled_date', monthEnd).neq('status', 'cancelled'),
      supabase.from('client_ratings').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('jobs').select('id,scheduled_date,status').gte('scheduled_date', trendStart).lt('scheduled_date', trendEnd).neq('status', 'cancelled'),
      supabase.from('cashflow').select('entry_type,amount,entry_date').gte('entry_date', trendStart).lt('entry_date', trendEnd),
    ])
    setClients(c.data || [])
    setEmployees(e.data || [])
    setTodayJobs(j.data || [])
    setEvals(ev.data || [])
    setStaleCount(stale.count || 0)
    setMonthJobs(mj.data || [])
    setClientRatings(cr.data || [])
    setTrendJobs(tj.data || [])
    setTrendCashflow(tc.data || [])
    setLastUpdate(new Date())
    setLoading(false)
  }

  useEffect(() => {
    load()
    const tick = setInterval(() => setClock(new Date()), 1000)
    const refresh = setInterval(load, 15000)
    return () => { clearInterval(tick); clearInterval(refresh) }
  }, [progressMonth, trendMonth, metricDay])

  const cancelStaleJobs = async () => {
    const today = tokyoToday()
    if (!window.confirm(fill(d.cancelStaleConfirm, { today }))) return
    const { error } = await supabase.from('jobs').update({ status: 'cancelled' }).eq('status', 'assigned').lt('scheduled_date', today)
    if (error) return toast.error(error.message)
    toast.success(d.staleCancelled)
    load()
  }

  const fmt = n => '¥' + Number(n || 0).toLocaleString()
  const revenue = clients.reduce((s, c) => s + Number(c.monthly_revenue || 0), 0)
  const cost = clients.reduce((s, c) => s + Number(c.monthly_cost || 0), 0)
  const profit = revenue - cost

  const byEmp = {}
  todayJobs.forEach(j => {
    const k = j.employee_name || '—'
    if (!byEmp[k]) byEmp[k] = []
    byEmp[k].push(j)
  })

  const sortedClients = [...clients].sort((a, b) =>
    (Number(b.monthly_revenue || 0) - Number(b.monthly_cost || 0)) - (Number(a.monthly_revenue || 0) - Number(a.monthly_cost || 0))
  )
  const maxProfit = Math.max(...clients.map(c => Number(c.monthly_revenue || 0) - Number(c.monthly_cost || 0)), 1)
  const statusColor = s => ({ assigned: '#60a5fa', in_progress: '#fbbf24', completed: '#4ade80', cancelled: 'rgba(255,255,255,0.2)' }[s] || '#60a5fa')

  const deepProgress = useMemo(() => buildDeepCleanProgress(monthJobs, progressMonth), [monthJobs, progressMonth])
  const monthLabel = new Date(progressMonth + '-01T12:00:00').toLocaleDateString(dateLocale, { month: 'long', year: 'numeric' })
  const selectedYear = Number(trendMonth.slice(0, 4))
  const todayYear = Number(tokyoToday().slice(0, 4))
  const trendMonthNumber = Number(trendMonth.slice(5, 7))
  const trendData = Array.from({ length: selectedYear === todayYear ? trendMonthNumber : 12 }, (_, index) => {
    const [year, month] = trendMonth.split('-').map(Number)
    const date = new Date(Date.UTC(year, index, 1))
    const key = date.toISOString().slice(0, 7)
    const monthJobs = trendJobs.filter(job => job.scheduled_date?.startsWith(key))
    const money = trendCashflow.filter(entry => entry.entry_date?.startsWith(key))
    return {
      key,
      label: date.toLocaleDateString(dateLocale, { month: 'short', timeZone: 'UTC' }),
      jobs: monthJobs.filter(job => job.status === 'completed').length,
      income: money.filter(entry => entry.entry_type === 'income').reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
      expenses: money.filter(entry => entry.entry_type === 'expense').reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
    }
  })
  const currentTrend = trendData.find(row => row.key === trendMonth) || trendData[trendData.length - 1]
  const previousMonthDate = new Date(Date.UTC(Number(trendMonth.slice(0, 4)), Number(trendMonth.slice(5, 7)) - 2, 1))
  const previousMonthKey = previousMonthDate.toISOString().slice(0, 7)
  const todayDate = tokyoToday()
  const currentMonthIsSelected = trendMonth === todayDate.slice(0, 7)
  const comparisonDay = currentMonthIsSelected ? Number(todayDate.slice(8, 10)) : 31
  const previousTrendJobs = trendJobs.filter(job => job.scheduled_date?.startsWith(previousMonthKey) && Number(job.scheduled_date.slice(8, 10)) <= comparisonDay && job.status === 'completed').length
  const currentTrendJobs = trendJobs.filter(job => job.scheduled_date?.startsWith(trendMonth) && (!currentMonthIsSelected || Number(job.scheduled_date.slice(8, 10)) <= comparisonDay) && job.status === 'completed').length
  const jobGrowth = previousTrendJobs ? Math.round(((currentTrendJobs - previousTrendJobs) / previousTrendJobs) * 100) : null
  const moneyTrend = trendData.map(row => ({ label: row.label, value: row.income - row.expenses }))
  const periodStart = metricPeriod === 'day' ? metricDay : metricPeriod === 'year' ? `${trendMonth.slice(0, 4)}-01-01` : `${trendMonth}-01`
  const periodEnd = metricPeriod === 'day' ? metricDay : metricPeriod === 'year' ? (selectedYear === todayYear ? todayDate : `${trendMonth.slice(0, 4)}-12-31`) : `${trendMonth}-31`
  const periodJobs = trendJobs.filter(job => job.scheduled_date >= periodStart && job.scheduled_date <= periodEnd && job.status === 'completed').length
  const periodCash = trendCashflow.filter(row => row.entry_date >= periodStart && row.entry_date <= periodEnd)
  const periodNetCash = periodCash.reduce((sum, row) => sum + (row.entry_type === 'income' ? 1 : -1) * Number(row.amount || 0), 0)
  const metricLabels = lang === 'ja'
    ? { revenue: '月間契約売上（推定）', profit: '推定利益', clients: '稼働中の顧客', satisfaction: '顧客満足度', today: '本日の作業', completed: '完了した作業', cash: '記録済み純入金' }
    : { revenue: 'Estimated contract revenue', profit: 'Estimated profit', clients: 'Active clients', satisfaction: 'Client satisfaction', today: "Today's jobs", completed: 'Completed jobs', cash: 'Recorded net cash' }
  const availableMetrics = [
    { id: 'revenue', value: fmt(revenue), note: lang === 'ja' ? '契約データに基づく推定' : 'Estimated from active client records' },
    { id: 'profit', value: fmt(profit), note: lang === 'ja' ? '契約売上 − 推定コスト' : 'Contract revenue minus estimated costs' },
    { id: 'clients', value: clients.length, note: lang === 'ja' ? '現在有効な顧客' : 'Currently active' },
    { id: 'satisfaction', value: avgStars(ratingsInPeriod(clientRatings, 30)) != null ? `${avgStars(ratingsInPeriod(clientRatings, 30)).toFixed(1)} ★` : '—', note: lang === 'ja' ? '直近30日間' : 'Last 30 days' },
    { id: 'today', value: todayJobs.length, note: lang === 'ja' ? '予定された作業' : 'Scheduled work' },
    { id: 'completed', value: periodJobs, note: lang === 'ja' ? '選択した期間の完了作業' : `${metricPeriod} · completed only` },
    { id: 'cash', value: fmt(periodNetCash), note: lang === 'ja' ? '記録済みの入出金' : `${metricPeriod} · recorded cashflow` },
  ]
  const updateVisibleMetrics = next => { setVisibleMetrics(next); localStorage.setItem('kuripuro-dashboard-metrics', JSON.stringify(next)) }

  const ratings30 = ratingsInPeriod(clientRatings, 30)
  const ratings7 = ratingsInPeriod(clientRatings, 7)
  const satisfactionByClient = groupRatingsByClient(ratings30, clients)
  const atRisk = satisfactionByClient.filter(x => x.avg != null && x.avg < 3.5)
  const overallAvg = avgStars(ratings30)
  const weeklyAvg = avgStars(ratings7)
  const levelColor = l => ({ excellent: 'var(--green)', good: '#60a5fa', warning: '#EF9F27', critical: 'var(--red)', none: 'var(--text3)' }[l] || 'var(--text3)')

  const closeDetail = () => { setDetailLoc(null); setDetailTuesday(null) }

  const DetailModal = () => {
    if (!detailLoc && !detailTuesday) return null
    const title = detailLoc
      ? `${detailLoc} — ${monthLabel}${deepProgress.byLocation[detailLoc]?.schedule ? ` (${deepProgress.byLocation[detailLoc].schedule})` : ''}`
      : fill(d.tuesdayTitle, { date: formatScheduleDate(detailTuesday, lang) })

    const rows = detailLoc
      ? (deepProgress.byLocation[detailLoc]?.expectedDates || []).map(date => ({ date, job: deepProgress.byLocation[detailLoc]?.byDate[date] || null, loc: detailLoc }))
      : DEEP_CLEAN_LOCATIONS.filter(loc => deepProgress.byLocation[loc]?.expectedDates?.includes(detailTuesday)).map(loc => ({ date: detailTuesday, job: deepProgress.byLocation[loc]?.byDate[detailTuesday] || null, loc }))

    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={closeDetail}>
        <div style={{ background: 'var(--surface)', borderRadius: 14, padding: 24, maxWidth: 520, width: '100%', maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 17 }}>{title}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{d.closeOutside}</div>
            </div>
            <button onClick={closeDetail} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>✕</button>
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            {rows.map(({ date, job, loc }) => {
              const slot = tuesdaySlotInfo(job, slotLabels)
              const dateLabel = detailLoc ? formatScheduleDate(date, lang) : loc
              const sub = detailLoc
                ? (job ? `${job.employee_name || '—'} · ${job.scheduled_time || '—'}` : d.noJob)
                : (job ? formatScheduleDate(date, lang) + ` · ${job.employee_name || '—'}` : d.noJob)
              return (
                <div key={`${loc}-${date}`} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', borderRadius: 10, background: `${slot.color}10`, border: `1px solid ${slot.color}35` }}>
                  <div style={{ fontSize: 20, width: 28, textAlign: 'center' }}>{slot.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{dateLabel}</div>
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{sub}</div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: slot.color, textAlign: 'right' }}>{slot.label}</div>
                </div>
              )
            })}
          </div>

          {detailLoc && deepProgress.byLocation[detailLoc] && (
            <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--surface2)', borderRadius: 10, fontSize: 13 }}>
              <b>{d.summary}:</b> {fill(d.summaryLine, { completed: deepProgress.byLocation[detailLoc].completed, expected: deepProgress.byLocation[detailLoc].expected })}
              {deepProgress.byLocation[detailLoc].missing > 0 && (
                <span style={{ color: '#f87171' }}>{fill(d.missingTuesdays, { n: deepProgress.byLocation[detailLoc].missing })}</span>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <DetailModal />
      <div className="dash-ref-head">
        <div><div className="dash-ref-eyebrow">KURIPURO</div><h1>{t.sidebar.dashboard}</h1><p>{new Date().toLocaleDateString(dateLocale, { dateStyle: 'full', timeZone: 'Asia/Tokyo' })}</p></div>
      </div>
      <section className="dash-custom-metrics">
        <div className="dash-custom-head"><strong>{lang === 'ja' ? '注目指標' : 'Key metrics'}</strong><div className="dash-custom-controls">
          <select aria-label={lang === 'ja' ? '集計期間' : 'Metric period'} value={metricPeriod} onChange={event => setMetricPeriod(event.target.value)}><option value="day">{lang === 'ja' ? '日別' : 'Day'}</option><option value="month">{lang === 'ja' ? '月別' : 'Month'}</option><option value="year">{lang === 'ja' ? '年別' : 'Year'}</option></select>
          {metricPeriod === 'day' && <input aria-label={lang === 'ja' ? '対象日' : 'Metric date'} type="date" value={metricDay} onChange={event => setMetricDay(event.target.value)} />}
          <button type="button" className="btn btn-sm" onClick={() => setEditMetrics(value => !value)}>{editMetrics ? (lang === 'ja' ? '完了' : 'Done') : (lang === 'ja' ? '編集' : 'Edit dashboard')}</button>
        </div></div>
        {editMetrics && <div className="dash-metric-picker">{availableMetrics.map(metric => <label key={metric.id}><input type="checkbox" checked={visibleMetrics.includes(metric.id)} onChange={event => updateVisibleMetrics(event.target.checked ? [...visibleMetrics, metric.id] : visibleMetrics.filter(id => id !== metric.id))}/><span>{metricLabels[metric.id]}</span></label>)}</div>}
        <div className="dash-ref-kpis dash-kpis-compact">{availableMetrics.filter(metric => visibleMetrics.includes(metric.id)).map(metric => <div className="dash-ref-kpi" key={metric.id}><div className="dash-ref-kpi-top"><span className="dash-ref-kpi-label">{metricLabels[metric.id]}</span><span className="dash-ref-kpi-icon">{['revenue','profit','cash'].includes(metric.id) ? '¥' : '•'}</span></div><div className="dash-ref-kpi-value">{metric.value}</div><div className="dash-ref-kpi-meta">{metric.note}</div></div>)}</div>
      </section>

      <section className="card dash-trend-card">
        <div className="dash-trend-head">
          <div><div className="dash-trend-eyebrow">{lang === 'ja' ? '月次推移' : 'MONTHLY TRENDS'}</div><h2>{lang === 'ja' ? '実績と成長' : 'Performance and growth'}</h2><p>{lang === 'ja' ? '記録済みの入出金と完了した作業のみを表示' : 'Recorded cash in/out and completed jobs only'}</p></div>
          <label className="dash-trend-period"><span>{lang === 'ja' ? '表示する最終月' : 'Show through'}</span><input type="month" value={trendMonth} onChange={event => setTrendMonth(event.target.value)} /></label>
        </div>
        <div className="dash-trend-summary">
          <div><span>{lang === 'ja' ? '選択月の完了作業' : 'Completed jobs · selected month'}</span><strong>{currentTrend.jobs}</strong>{jobGrowth !== null && <small className={jobGrowth >= 0 ? 'is-up' : 'is-down'}>{jobGrowth > 0 ? '+' : ''}{jobGrowth}% {lang === 'ja' ? (currentMonthIsSelected ? '前月同日比' : '前月比') : (currentMonthIsSelected ? 'vs same days last month' : 'vs last month')}</small>}</div>
          <div><span>{lang === 'ja' ? '選択月の記録済み純入金' : 'Recorded net cash · selected month'}</span><strong>{fmt(currentTrend.income - currentTrend.expenses)}</strong><small>{lang === 'ja' ? '入出金記録ベース' : 'From cashflow entries'}</small></div>
        </div>
        <div className="dash-trend-charts">
          <div><h3>{lang === 'ja' ? '完了した作業' : 'Completed jobs'}</h3><LineChart data={trendData.map(row => ({ label: row.label, value: row.jobs }))} lineLabel={lang === 'ja' ? '件数' : 'Jobs'} /></div>
          <div><h3>{lang === 'ja' ? '記録済み純入金' : 'Recorded net cash'}</h3><LineChart data={moneyTrend} lineLabel="¥" valueFormatter={fmt} /></div>
        </div>
      </section>

      {staleCount > 0 && (
        <div style={{ background: 'rgba(239,159,39,0.08)', border: '1px solid rgba(239,159,39,0.25)', borderRadius: 12, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--text2)' }}>⚠️ {fill(d.staleJobs, { count: staleCount })}</span>
          <button onClick={cancelStaleJobs} className="btn btn-sm" style={{ background: '#EF9F27', color: '#fff', border: 'none', flexShrink: 0 }}>{d.cancelStale}</button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 20, borderLeft: '4px solid #c19c56' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{d.satisfactionTitle}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{d.satisfactionSubtitle}</div>
          </div>
          <Link to="/client-feedback" style={{ fontSize: 12, color: '#c19c56', fontWeight: 600, textDecoration: 'none' }}>{d.viewFeedback}</Link>
        </div>

        <div className="dash-sat">
          {[
          [d.avgRating, overallAvg != null ? overallAvg.toFixed(1) + ' ★' : '—'],
          [d.weeklyAvg, weeklyAvg != null ? weeklyAvg.toFixed(1) : '—'],
          [d.ratingsCount, ratings30.length],
          ].map(([l, v]) => (
            <div key={l} style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#EF9F27' }}>{v}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{l}</div>
            </div>
          ))}
        </div>

        {atRisk.length > 0 && (
          <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: 'var(--red)' }}>
            ⚠️ {d.atRiskClients}: {atRisk.map(x => x.client.company_name).join(', ')}
          </div>
        )}

        {satisfactionByClient.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text3)' }}>{d.noRatingsYet}</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
            {satisfactionByClient.map(({ client, avg, count, level }) => (
              <div key={client.id} style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--surface2)', border: `1px solid ${levelColor(level)}30` }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client.company_name}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: levelColor(level) }}>{avg != null ? starsDisplay(avg) : '—'}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{count} {d.ratingsCount.toLowerCase()}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 10 }}>{d.employeeScores}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {[...employees].sort((a, b) => (b.score || 100) - (a.score || 100)).slice(0, 8).map(emp => (
              <div key={emp.id} style={{ padding: '6px 12px', borderRadius: 20, background: 'var(--surface2)', fontSize: 12 }}>
                <span style={{ fontWeight: 600 }}>{emp.full_name}</span>
                <span style={{ marginLeft: 8, fontWeight: 700, color: (emp.score || 100) >= 70 ? 'var(--green)' : 'var(--red)' }}>{emp.score || 100}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20, borderLeft: '4px solid #fbbf24' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{d.deepCleanTitle}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
              {fill(d.deepContract, { month: monthLabel, expected: deepProgress.totals.expected })}
            </div>
          </div>
          <input type="month" value={progressMonth} onChange={e => setProgressMonth(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13, fontWeight: 600 }} />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          {[
            [d.completed, deepProgress.totals.completed, '#4ade80'],
            [d.pending, deepProgress.totals.pending, '#60a5fa'],
            [d.missingSchedule, Math.max(0, deepProgress.totals.expected - deepProgress.totals.scheduled), '#f87171'],
            [d.progress, `${deepProgress.totals.pct}%`, '#fbbf24'],
          ].map(([l, v, c]) => (
            <div key={l} style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 16px', minWidth: 100 }}>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{l}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: c }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ height: 10, background: 'var(--surface2)', borderRadius: 5, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ height: '100%', width: `${deepProgress.totals.pct}%`, background: 'linear-gradient(90deg,#fbbf24,#4ade80)', borderRadius: 5, transition: 'width 0.4s' }} />
        </div>

        {deepProgress.tuesdaySummary.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 8 }}>{d.byTuesday}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {deepProgress.tuesdaySummary.map(({ date, expected, done }) => {
                const ok = done >= expected
                const shortDate = new Date(date + 'T12:00:00').toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' })
                return (
                  <button key={date} type="button" onClick={() => { setDetailTuesday(date); setDetailLoc(null) }}
                    style={{ padding: '8px 12px', borderRadius: 8, cursor: 'pointer', background: ok ? 'rgba(74,222,128,0.12)' : 'rgba(251,191,36,0.1)', border: `1px solid ${ok ? 'rgba(74,222,128,0.3)' : 'rgba(251,191,36,0.25)'}`, fontSize: 12, textAlign: 'left' }}>
                    <div style={{ fontWeight: 700 }}>{fill(d.tuesdayShort, { date: shortDate })}</div>
                    <div style={{ color: ok ? '#4ade80' : '#fbbf24', fontWeight: 600 }}>{fill(d.doneOf, { done, expected })}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{d.clickTuesday}</div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 8 }}>{d.byRestaurant}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
          {Object.entries(deepProgress.byLocation).map(([loc, data]) => {
            const pct = data.expected ? Math.round((data.completed / data.expected) * 100) : 0
            const ok = data.completed >= data.expected
            return (
              <button key={loc} type="button" onClick={() => { setDetailLoc(loc); setDetailTuesday(null) }}
                style={{ padding: '10px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', background: 'var(--surface2)', border: `1px solid ${ok ? 'rgba(74,222,128,0.25)' : 'var(--border)'}` }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{loc}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4 }}>{data.schedule || 'Tue'}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>
                  <span>{fill(d.doneCount, { done: data.completed, expected: data.expected })}</span>
                  <span style={{ color: ok ? '#4ade80' : '#fbbf24', fontWeight: 700 }}>{pct}%</span>
                </div>
                <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: ok ? '#4ade80' : '#fbbf24', borderRadius: 2 }} />
                </div>
                {data.missing > 0 && <div style={{ fontSize: 10, color: '#f87171', marginTop: 4 }}>⚠ {fill(d.notScheduled, { n: data.missing })}</div>}
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6 }}>{d.clickRestaurant}</div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>{d.todayJobsTitle} ({tokyoToday()})</div>
        {todayJobs.length === 0 ? (
          <div className="empty-state">
            <strong>{d.noTodayJobs}</strong>
          </div>
        ) : Object.entries(byEmp).map(([name, jobs]) => (
          <div key={name} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 6 }}>{name}</div>
            {jobs.map(j => (
              <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                <span>{j.title?.replace(/ — .*/, '')} · {j.scheduled_time || '—'}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: statusColor(j.status) }}>{t.status[j.status] || j.status}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="dash-split">
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 12 }}>{d.recentEvals}</div>
          {evals.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{d.noEvals}</div>}
          {evals.map(e => (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div><div style={{ fontSize: 13, fontWeight: 500 }}>{e.employee_name}</div><div style={{ fontSize: 11, color: 'var(--text3)' }}>{e.category} · {e.eval_date}</div></div>
              <span className={`badge ${e.points_change > 0 ? 'badge-green' : 'badge-red'}`}>{e.points_change > 0 ? '+' : ''}{e.points_change} pts</span>
            </div>
          ))}
        </div>

        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 12 }}>{d.profitByClient}</div>
          {sortedClients.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13 }}>{d.noClients}</div>}
          {sortedClients.map(c => {
            const p = Number(c.monthly_revenue || 0) - Number(c.monthly_cost || 0)
            const pct = Math.round(p / maxProfit * 100)
            const color = pct >= 70 ? 'var(--green)' : pct >= 40 ? '#EF9F27' : 'var(--red)'
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <div style={{ width: 120, fontSize: 12, fontWeight: 500, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.company_name}</div>
                <div style={{ flex: 1, height: 14, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: pct + '%', background: color, borderRadius: 3 }} />
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color, width: 70, textAlign: 'right' }}>¥{(p / 1000).toFixed(0)}k</div>
              </div>
            )
          })}
        </div>
      </div>
      {loading && <div style={{ color: 'var(--text3)', fontSize: 12, marginTop: 8 }}>{d.updating}</div>}
    </div>
  )
}
