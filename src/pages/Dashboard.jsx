import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { buildDeepCleanProgress, currentYearMonth, formatScheduleDate, tuesdaySlotInfo, DEEP_CLEAN_LOCATIONS } from '../lib/cleaningType'
import { useLang, fill } from '../hooks/useLang'
import { groupRatingsByClient, ratingsInPeriod, avgStars, starsDisplay } from '../lib/satisfaction'
import OverviewChart from '../components/OverviewChart'
import DateRangeSheet, { presetRange, formatRangeLabel, tokyoToday } from '../components/DateRangeSheet'
import { useAuth } from '../hooks/useAuth'
import { summarizeJobs, summarizeByEmployee, formatMinutes, gpsCheck } from '../lib/workKpis'
import toast from 'react-hot-toast'
import TimeOffAlert from '../components/TimeOffAlert'

const METRICS_KEY = 'kuripuro-dashboard-metrics-v2'
const DEFAULT_METRICS = ['completed', 'cash', 'income', 'expenses', 'clients', 'satisfaction']
const addDays = (iso, days) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10) }
const daysBetween = (from, to) => Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 864e5) + 1

export default function Dashboard() {
  const { lang, t } = useLang()
  const { user } = useAuth() || {}
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
  const [range, setRange] = useState(() => ({ ...presetRange('month'), preset: 'month' }))
  const [rangeOpen, setRangeOpen] = useState(false)
  const [editMetrics, setEditMetrics] = useState(false)
  const [visibleMetrics, setVisibleMetrics] = useState(() => {
    try { return JSON.parse(localStorage.getItem(METRICS_KEY)) || DEFAULT_METRICS }
    catch { return DEFAULT_METRICS }
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
    // Selected range plus the same number of days before it, for the comparison.
    const trendStart = addDays(range.from, -daysBetween(range.from, range.to))
    const trendEnd = addDays(range.to, 1)
    const [c, e, j, ev, stale, mj, cr, tj, tc] = await Promise.all([
      supabase.from('clients').select('*').eq('is_active', true),
      supabase.from('employees').select('id,full_name,score,is_active').eq('is_active', true).order('full_name'),
      supabase.from('jobs').select('*').eq('scheduled_date', today).order('scheduled_time'),
      supabase.from('evaluations').select('*').order('created_at', { ascending: false }).limit(5),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'assigned').lt('scheduled_date', today),
      supabase.from('jobs').select('*').gte('scheduled_date', monthStart).lte('scheduled_date', monthEnd).neq('status', 'cancelled'),
      supabase.from('client_ratings').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('jobs').select('id,scheduled_date,scheduled_time,status,employee_id,employee_name,started_at,completed_at,gps_start_distance,start_lat,checklist_total,checklist_done,photo_ai_score').gte('scheduled_date', trendStart).lt('scheduled_date', trendEnd).neq('status', 'cancelled'),
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
  }, [progressMonth, range.from, range.to])

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
  const rangeDays = daysBetween(range.from, range.to)
  const prevFrom = addDays(range.from, -rangeDays)
  const prevTo = addDays(range.from, -1)
  const inRange = (iso, from, to) => iso && iso >= from && iso <= to
  const completedIn = (from, to) => trendJobs.filter(job => job.status === 'completed' && inRange(job.scheduled_date, from, to)).length
  const cashIn = (from, to, type) => trendCashflow.filter(row => row.entry_type === type && inRange(row.entry_date, from, to))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0)
  const periodJobs = completedIn(range.from, range.to)
  const prevJobs = completedIn(prevFrom, prevTo)
  const periodIncome = cashIn(range.from, range.to, 'income')
  const periodExpenses = cashIn(range.from, range.to, 'expense')
  const periodNetCash = periodIncome - periodExpenses
  const prevNetCash = cashIn(prevFrom, prevTo, 'income') - cashIn(prevFrom, prevTo, 'expense')
  const growth = (now, before) => before ? Math.round(((now - before) / Math.abs(before)) * 100) : null

  // Daily columns up to ~2 months, monthly columns beyond that.
  const daily = rangeDays <= 62
  const bucketKeys = []
  if (daily) for (let i = 0; i < rangeDays; i++) bucketKeys.push(addDays(range.from, i))
  else for (let key = range.from.slice(0, 7); key <= range.to.slice(0, 7);) {
    bucketKeys.push(key)
    const [y, m] = key.split('-').map(Number)
    key = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7)
  }
  const overviewData = bucketKeys.map(key => {
    const from = daily ? key : (key + '-01' < range.from ? range.from : key + '-01')
    const to = daily ? key : (addDays(new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 1)).toISOString().slice(0, 10), -1))
    const end = to > range.to ? range.to : to
    const date = new Date((daily ? key : key + '-01') + 'T12:00:00Z')
    return {
      key,
      label: daily ? String(date.getUTCDate()) : date.toLocaleDateString(dateLocale, { month: 'short', timeZone: 'UTC' }),
      title: date.toLocaleDateString(dateLocale, daily ? { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' } : { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      jobs: completedIn(from, end),
      cash: cashIn(from, end, 'income') - cashIn(from, end, 'expense'),
    }
  })

  const rangeJobs = trendJobs.filter(job => inRange(job.scheduled_date, range.from, range.to))
  const team = summarizeJobs(rangeJobs)
  const teamPrev = summarizeJobs(trendJobs.filter(job => inRange(job.scheduled_date, prevFrom, prevTo)))
  const people = summarizeByEmployee(rangeJobs)
  const liveJobs = todayJobs.filter(job => job.status === 'in_progress' && job.started_at)
  const pctText = v => v == null ? '—' : `${v}%`

  const metricLabels = lang === 'ja'
    ? { completed: '完了した作業', cash: '記録済み純入金', income: '入金', expenses: '出金', clients: '稼働中の顧客', satisfaction: '顧客満足度', today: '本日の作業', revenue: '月間契約売上（推定）', profit: '推定利益' }
    : { completed: 'Completed jobs', cash: 'Net cash', income: 'Money in', expenses: 'Money out', clients: 'Active clients', satisfaction: 'Satisfaction', today: "Today's jobs", revenue: 'Contract revenue', profit: 'Estimated profit' }
  Object.assign(metricLabels, lang === 'ja'
    ? { avgService: '平均作業時間', hoursWorked: '実働時間', onTime: '時間どおり開始', gps: 'GPSチェックイン' }
    : { avgService: 'Avg. service time', hoursWorked: 'Hours worked', onTime: 'On-time starts', gps: 'GPS check-ins' })
  const vsPrev = lang === 'ja' ? '前期間比' : 'vs previous period'
  const satisfaction30 = avgStars(ratingsInPeriod(clientRatings, 30))
  const availableMetrics = [
    { id: 'completed', tone: 'green', value: periodJobs, delta: growth(periodJobs, prevJobs) },
    { id: 'cash', tone: 'blue', value: fmt(periodNetCash), delta: growth(periodNetCash, prevNetCash) },
    { id: 'income', tone: 'purple', value: fmt(periodIncome) },
    { id: 'expenses', tone: 'orange', value: fmt(periodExpenses) },
    { id: 'clients', tone: 'teal', value: clients.length },
    { id: 'satisfaction', tone: 'amber', value: satisfaction30 != null ? `${satisfaction30.toFixed(1)} ★` : '—', note: lang === 'ja' ? '直近30日間' : 'Last 30 days' },
    { id: 'today', tone: 'sky', value: todayJobs.length },
    { id: 'revenue', tone: 'navy', value: fmt(revenue), note: lang === 'ja' ? '契約データに基づく推定' : 'Estimated, per month' },
    { id: 'profit', tone: 'green', value: fmt(profit), note: lang === 'ja' ? '契約売上 − 推定コスト' : 'Estimated, per month' },
    { id: 'avgService', tone: 'sky', value: formatMinutes(team.avgMin), delta: team.avgMin != null && teamPrev.avgMin ? growth(team.avgMin, teamPrev.avgMin) : null },
    { id: 'hoursWorked', tone: 'navy', value: formatMinutes(team.totalMin), delta: growth(team.totalMin, teamPrev.totalMin) },
    { id: 'onTime', tone: 'green', value: pctText(team.onTimePct) },
    { id: 'gps', tone: 'teal', value: pctText(team.gpsPct) },
  ]
  const updateVisibleMetrics = next => { setVisibleMetrics(next); try { localStorage.setItem(METRICS_KEY, JSON.stringify(next)) } catch {} }
  const minutesAgo = lastUpdate ? Math.max(0, Math.floor((clock - lastUpdate) / 60000)) : null
  const updatedLabel = minutesAgo == null ? '' : lang === 'ja'
    ? (minutesAgo === 0 ? 'たった今更新' : `${minutesAgo}分前に更新`)
    : (minutesAgo === 0 ? 'Updated just now' : `Updated ${minutesAgo} min ago`)

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
      {DetailModal()}
      {rangeOpen && <DateRangeSheet lang={lang} value={range} onClose={() => setRangeOpen(false)} onSave={next => { setRange(next); setRangeOpen(false) }} />}
      <header className="dx-hero">
        <div className="dx-hero-copy">
          <span className="dx-eyebrow">{new Date().toLocaleDateString(dateLocale, { dateStyle: 'full', timeZone: 'Asia/Tokyo' })}</span>
          <h1>{lang === 'ja' ? <>ダッシュボードへ<br />ようこそ</> : <>Welcome to your<br />Dashboard</>}{user?.name ? <span className="dx-hero-name">{lang === 'ja' ? `${user.name}さん` : `, ${user.name.split(' ')[0]}`}</span> : null}</h1>
        </div>
        <div className="dx-hero-controls">
          <button type="button" className="dx-range" onClick={() => setRangeOpen(true)} aria-haspopup="dialog">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
            <span>{formatRangeLabel(range, lang)}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          <div className="dx-updated">{updatedLabel}{updatedLabel && ' · '}<button type="button" onClick={load}>{lang === 'ja' ? '更新' : 'Refresh'}</button></div>
        </div>
      </header>

      <TimeOffAlert />

      <section className="dx-kpis-wrap" aria-label={lang === 'ja' ? '注目指標' : 'Key metrics'}>
        <div className="dx-kpis">
          {availableMetrics.filter(metric => visibleMetrics.includes(metric.id)).map(metric => (
            <div className={`dx-kpi tone-${metric.tone}`} key={metric.id}>
              <span className="dx-kpi-label">{metricLabels[metric.id]}</span>
              <strong className="dx-kpi-value">{metric.value}</strong>
              {metric.delta != null
                ? <small className={`dx-kpi-delta ${metric.delta >= 0 ? 'is-up' : 'is-down'}`}>{metric.delta > 0 ? '▲ +' : metric.delta < 0 ? '▼ ' : ''}{metric.delta}% <em>{vsPrev}</em></small>
                : metric.note ? <small className="dx-kpi-note">{metric.note}</small> : null}
            </div>
          ))}
        </div>
        <div className="dx-kpi-edit">
          <button type="button" onClick={() => setEditMetrics(value => !value)}>{editMetrics ? (lang === 'ja' ? '完了' : 'Done') : (lang === 'ja' ? '表示する指標を編集' : 'Edit tiles')}</button>
        </div>
        {editMetrics && <div className="dash-metric-picker">{availableMetrics.map(metric => <label key={metric.id}><input type="checkbox" checked={visibleMetrics.includes(metric.id)} onChange={event => updateVisibleMetrics(event.target.checked ? [...visibleMetrics, metric.id] : visibleMetrics.filter(id => id !== metric.id))}/><span>{metricLabels[metric.id]}</span></label>)}</div>}
      </section>

      <section className="card dx-overview">
        <div className="dx-overview-head">
          <div><h2>{lang === 'ja' ? '実績の概要' : 'Performance overview'}</h2><p>{formatRangeLabel(range, lang)} · {lang === 'ja' ? (daily ? '日別' : '月別') : (daily ? 'by day' : 'by month')}</p></div>
        </div>
        <OverviewChart data={overviewData} cashLabel={metricLabels.cash} jobsLabel={metricLabels.completed} formatCash={fmt} emptyLabel={lang === 'ja' ? 'データなし' : 'No data'} />
      </section>

      <section className="card dx-team">
        <div className="dx-overview-head">
          <div><h2>{lang === 'ja' ? 'チームのパフォーマンス' : 'Team performance'}</h2><p>{formatRangeLabel(range, lang)} · {lang === 'ja' ? '開始・終了時刻とGPSから' : 'from start/finish times and GPS'}</p></div>
          <Link to="/live" className="dx-link">{lang === 'ja' ? 'ライブ追跡 →' : 'Live tracking →'}</Link>
        </div>
        {liveJobs.length > 0 && (
          <div className="dx-live">
            {liveJobs.map(job => {
              const secs = Math.max(0, Math.floor((clock - new Date(job.started_at)) / 1000))
              const gps = gpsCheck(job)
              return (
                <div key={job.id} className="dx-live-item">
                  <span className="dx-live-dot" />
                  <div><strong>{job.employee_name || '—'}</strong><small>{(job.title || '').replace(/ — .*/, '')}{gps === 'away' ? (lang === 'ja' ? ' · ⚠ 現場外' : ' · ⚠ away from site') : gps ? ' · 📍' : ''}</small></div>
                  <b>{String(Math.floor(secs / 3600)).padStart(2, '0')}:{String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}:{String(secs % 60).padStart(2, '0')}</b>
                </div>
              )
            })}
          </div>
        )}
        <div className="dx-team-kpis">
          {[
            [metricLabels.avgService, formatMinutes(team.avgMin), teamPrev.avgMin != null && team.avgMin != null ? `${team.avgMin - teamPrev.avgMin > 0 ? '+' : team.avgMin - teamPrev.avgMin < 0 ? '−' : '±'}${formatMinutes(Math.abs(team.avgMin - teamPrev.avgMin))} ${vsPrev}` : null],
            [metricLabels.hoursWorked, formatMinutes(team.totalMin), lang === 'ja' ? `計測 ${team.timed}件` : `${team.timed} timed jobs`],
            [metricLabels.onTime, pctText(team.onTimePct), team.avgDelayMin != null ? (lang === 'ja' ? `平均開始 ${team.avgDelayMin}分` : `avg. start ${team.avgDelayMin > 0 ? '+' : ''}${team.avgDelayMin} min`) : null],
            [metricLabels.gps, pctText(team.gpsPct), team.gpsAway ? (lang === 'ja' ? `現場外 ${team.gpsAway}件` : `${team.gpsAway} away from site`) : null],
            [lang === 'ja' ? 'チェックリスト' : 'Checklist', pctText(team.checklistPct), null],
          ].map(([label, value, sub]) => (
            <div key={label} className="dx-team-kpi"><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div>
          ))}
        </div>
        {people.length === 0 ? <div className="ov-empty">{lang === 'ja' ? 'この期間の完了作業はありません' : 'No completed jobs in this period'}</div> : (
          <div className="dx-table-wrap">
            <table className="dx-table">
              <thead><tr>
                <th>{lang === 'ja' ? 'スタッフ' : 'Employee'}</th>
                <th>{lang === 'ja' ? '件数' : 'Jobs'}</th>
                <th>{lang === 'ja' ? '平均時間' : 'Avg. time'}</th>
                <th>{lang === 'ja' ? '実働' : 'Hours'}</th>
                <th>{lang === 'ja' ? '時間どおり' : 'On time'}</th>
                <th>GPS</th>
                <th>{lang === 'ja' ? 'チェック' : 'Checklist'}</th>
              </tr></thead>
              <tbody>
                {people.map(p => (
                  <tr key={p.id || p.name}>
                    <td>{p.id ? <Link to={`/employees/${p.id}`}>{p.name}</Link> : p.name}</td>
                    <td>{p.completed}</td>
                    <td>{formatMinutes(p.avgMin)}</td>
                    <td>{formatMinutes(p.totalMin)}</td>
                    <td className={p.onTimePct != null && p.onTimePct < 80 ? 'is-bad' : ''}>{pctText(p.onTimePct)}</td>
                    <td className={p.gpsAway ? 'is-bad' : ''}>{pctText(p.gpsPct)}{p.gpsAway ? ` · ⚠${p.gpsAway}` : ''}</td>
                    <td>{pctText(p.checklistPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
                const shortDate = new Date(date + 'T12:00:00').toLocaleDateString(dateLocale, { weekday: 'short', day: 'numeric', month: 'short' })
                return (
                  <button key={date} type="button" onClick={() => { setDetailTuesday(date); setDetailLoc(null) }}
                    style={{ padding: '8px 12px', borderRadius: 8, cursor: 'pointer', background: ok ? 'rgba(74,222,128,0.12)' : 'rgba(251,191,36,0.1)', border: `1px solid ${ok ? 'rgba(74,222,128,0.3)' : 'rgba(251,191,36,0.25)'}`, fontSize: 12, textAlign: 'left' }}>
                    <div style={{ fontWeight: 700 }}>{shortDate}</div>
                    <div style={{ color: ok ? '#15803d' : '#a16207', fontWeight: 600 }}>{fill(d.doneOf, { done, expected })}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{d.clickTuesday}</div>
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

      {todayJobs.some(j => j.area) && (() => {
        // Today by area (zone of the location): done / still to do
        const byArea = {}
        for (const j of todayJobs) {
          if (j.status === 'cancelled') continue
          const a = j.area || (lang === 'ja' ? '未設定' : 'No area')
          byArea[a] = byArea[a] || { total: 0, done: 0, staff: new Set() }
          byArea[a].total++
          if (j.status === 'completed') byArea[a].done++
          if (j.employee_name) byArea[a].staff.add(j.employee_name.split(' ')[0])
        }
        return (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>📍 {lang === 'ja' ? '本日のエリア別' : 'Today by area'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
              {Object.entries(byArea).sort((a, b) => b[1].total - a[1].total).map(([area, v]) => (
                <Link key={area} to="/jobs" style={{ textDecoration: 'none', color: 'inherit', background: 'var(--surface2)', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{area}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>{v.done}/{v.total}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{lang === 'ja' ? '完了' : 'done'}{v.staff.size ? ` · ${[...v.staff].join(', ')}` : ''}</div>
                </Link>
              ))}
            </div>
          </div>
        )
      })()}

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
                <span>{j.title?.replace(/ — .*/, '')} · {j.scheduled_time || '—'}{j.area ? ` · 📍 ${j.area}` : ''}</span>
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
