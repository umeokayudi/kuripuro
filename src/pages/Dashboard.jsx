import { LineChart, BarChart } from '../components/AnalyticsCharts'
import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { buildDeepCleanProgress, currentYearMonth, formatScheduleDate, tuesdaySlotInfo, DEEP_CLEAN_LOCATIONS } from '../lib/cleaningType'
import { useLang, fill } from '../hooks/useLang'
import { groupRatingsByClient, ratingsInPeriod, avgStars, starsDisplay } from '../lib/satisfaction'
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
    const [c, e, j, ev, stale, mj, cr] = await Promise.all([
      supabase.from('clients').select('*').eq('is_active', true),
      supabase.from('employees').select('id,full_name,score,is_active').eq('is_active', true).order('full_name'),
      supabase.from('jobs').select('*').eq('scheduled_date', today).order('scheduled_time'),
      supabase.from('evaluations').select('*').order('created_at', { ascending: false }).limit(5),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'assigned').lt('scheduled_date', today),
      supabase.from('jobs').select('*').gte('scheduled_date', monthStart).lte('scheduled_date', monthEnd).neq('status', 'cancelled'),
      supabase.from('client_ratings').select('*').order('created_at', { ascending: false }).limit(500),
    ])
    setClients(c.data || [])
    setEmployees(e.data || [])
    setTodayJobs(j.data || [])
    setEvals(ev.data || [])
    setStaleCount(stale.count || 0)
    setMonthJobs(mj.data || [])
    setClientRatings(cr.data || [])
    setLastUpdate(new Date())
    setLoading(false)
  }

  useEffect(() => {
    load()
    const tick = setInterval(() => setClock(new Date()), 1000)
    const refresh = setInterval(load, 15000)
    return () => { clearInterval(tick); clearInterval(refresh) }
  }, [progressMonth])

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

  const ratings30 = ratingsInPeriod(clientRatings, 30)
  const ratings7 = ratingsInPeriod(clientRatings, 7)
  const satisfactionByClient = groupRatingsByClient(ratings30, clients)
  const atRisk = satisfactionByClient.filter(x => x.avg != null && x.avg < 3.5)
  const overallAvg = avgStars(ratings30)
  const weeklyAvg = avgStars(ratings7)
  const monthlyAvg = overallAvg
  const levelColor = l => ({ excellent: 'var(--green)', good: '#60a5fa', warning: '#EF9F27', critical: 'var(--red)', none: 'var(--text3)' }[l] || 'var(--text3)')
  const completedToday = todayJobs.filter(j => j.status === 'completed').length
  const assignedToday = todayJobs.filter(j => j.status === 'assigned').length
  const attentionCount = staleCount + atRisk.length + assignedToday

  const serviceTrend = useMemo(() => {
    const byDay = {}
    monthJobs.forEach(j => {
      const date = (j.completed_at || j.scheduled_date || j.created_at || '').slice(0, 10)
      if (date) byDay[date] = (byDay[date] || 0) + 1
    })
    return Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).slice(-14)
      .map(([date, value]) => ({ label: date.slice(5).replace('-', '/'), value }))
  }, [monthJobs])

  const clientProfitData = useMemo(() => [...clients]
    .map(c => ({ label: c.company_name || '—', value: Math.max(0, Number(c.monthly_revenue || 0) - Number(c.monthly_cost || 0)) }))
    .sort((a, b) => b.value - a.value).slice(0, 5), [clients])

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
    <div className="dashboard-v2">
      <DetailModal />
      <header className="dashboard-v2-head">
        <div className="dashboard-v2-title">
          <div className="dashboard-v2-eyebrow">{d.commandCenter}</div>
          <h1>{d.title}</h1>
          <p>{d.subtitle}</p>
        </div>
        <div className="dashboard-v2-actions">
          <Link to="/jobs" className="btn btn-primary">{d.newJob}</Link>
          <Link to="/clients" className="btn">{d.newClient}</Link>
          <Link to="/faturas" className="btn">{d.newInvoice}</Link>
        </div>
      </header>

      <section className="dashboard-v2-kpis" aria-label={d.overview}>
        <div className="dashboard-v2-kpi"><span className="dashboard-v2-kpi-icon">✓</span><div><span>{d.todayJobs}</span><strong>{completedToday}/{todayJobs.length}</strong><small>{d.completedToday}</small></div></div>
        <div className="dashboard-v2-kpi"><span className="dashboard-v2-kpi-icon">♙</span><div><span>{d.activeClients}</span><strong>{clients.length}</strong><small>{d.activeAccounts}</small></div></div>
        <div className="dashboard-v2-kpi"><span className="dashboard-v2-kpi-icon">♙</span><div><span>{d.activeEmployees}</span><strong>{employees.length}</strong><small>{d.currentTeam}</small></div></div>
        <div className={`dashboard-v2-kpi ${attentionCount ? 'is-alert' : 'is-good'}`}><span className="dashboard-v2-kpi-icon">{attentionCount ? '!' : '✓'}</span><div><span>{d.attention}</span><strong>{attentionCount}</strong><small>{attentionCount ? d.needsReview : d.everythingOnTrack}</small></div></div>
      </section>

      <section className="dashboard-v2-grid dashboard-v2-top">
        <article className="dashboard-v2-card dashboard-v2-priority">
          <div className="dashboard-v2-card-head"><div><h2>{d.priority}</h2><p>{d.prioritySubtitle}</p></div>{attentionCount > 0 && <span className="dashboard-v2-count dashboard-v2-count-alert">{attentionCount}</span>}</div>
          <div className="dashboard-v2-priority-list">
            {staleCount > 0 && <div className="dashboard-v2-priority-row is-warning"><span>!</span><div><strong>{fill(d.staleJobs, { count: staleCount })}</strong><small>{d.staleJobsHint}</small></div><Link to="/jobs">{d.open}</Link></div>}
            {assignedToday > 0 && <div className="dashboard-v2-priority-row"><span>→</span><div><strong>{fill(d.assignedToday, { count: assignedToday })}</strong><small>{d.assignedTodayHint}</small></div><Link to="/jobs">{d.open}</Link></div>}
            {atRisk.length > 0 && <div className="dashboard-v2-priority-row is-danger"><span>!</span><div><strong>{fill(d.atRiskClients, { count: atRisk.length })}</strong><small>{d.atRiskHint}</small></div><Link to="/client-feedback">{d.open}</Link></div>}
            {!attentionCount && <div className="dashboard-v2-empty-inline"><span>✓</span><div><strong>{d.everythingOnTrack}</strong><small>{d.noMajorAlerts}</small></div></div>}
          </div>
        </article>

        <article className="dashboard-v2-card dashboard-v2-finance">
          <div className="dashboard-v2-card-head"><div><h2>{d.financialSnapshot}</h2><p>{d.financialSubtitle}</p></div><Link to="/cashflow">{d.viewCashflow}</Link></div>
          <div className="dashboard-v2-money-main"><span>{d.contractBase}</span><strong>{fmt(revenue)}</strong></div>
          <div className="dashboard-v2-money-grid">
            <div><span>{d.estimatedCost}</span><strong>{fmt(cost)}</strong></div>
            <div><span>{d.estimatedProfit}</span><strong className={profit >= 0 ? 'positive' : 'negative'}>{fmt(profit)}</strong></div>
            <div><span>{d.margin}</span><strong>{revenue ? ((profit / revenue) * 100).toFixed(1) : '0.0'}%</strong></div>
          </div>
        </article>
      </section>

      <article className="dashboard-v2-card dashboard-v2-operations">
        <div className="dashboard-v2-card-head"><div><h2>{d.todayOperations}</h2><p>{fill(d.todayOperationsSubtitle, { count: todayJobs.length })}</p></div><Link to="/jobs">{d.viewAll}</Link></div>
        {todayJobs.length === 0 ? <div className="dashboard-v2-empty"><strong>{d.noTodayJobs}</strong><span>{d.noTodayJobsHint}</span></div> : <div className="dashboard-v2-job-list">
          {todayJobs.slice(0, 8).map(j => <div className="dashboard-v2-job-row" key={j.id}><span className="dashboard-v2-job-time">{j.scheduled_time || '—'}</span><div className="dashboard-v2-job-main"><strong>{j.title?.replace(/ — .*/, '') || '—'}</strong><span>{j.employee_name || d.unassigned}</span></div><span className={`dashboard-v2-status status-${j.status}`}>{t.status[j.status] || j.status}</span></div>)}
        </div>}
      </article>

      <section className="dashboard-v2-grid dashboard-v2-middle">
        <article className="dashboard-v2-card"><div className="dashboard-v2-card-head"><div><h2>{d.serviceVolume}</h2><p>{d.serviceVolumeSubtitle}</p></div><strong className="dashboard-v2-card-kpi">{monthJobs.length}</strong></div><LineChart data={serviceTrend} lineLabel={d.jobsLabel} /></article>
        <article className="dashboard-v2-card"><div className="dashboard-v2-card-head"><div><h2>{d.clientProfitability}</h2><p>{d.clientProfitabilitySubtitle}</p></div><Link to="/reports">{d.viewReports}</Link></div>{clientProfitData.length ? <BarChart data={clientProfitData} valueFormatter={fmt} /> : <div className="dashboard-v2-empty"><strong>{d.noClients}</strong></div>}</article>
      </section>

      <section className="dashboard-v2-grid dashboard-v2-bottom">
        <article className="dashboard-v2-card">
          <div className="dashboard-v2-card-head"><div><h2>{d.clientSatisfaction}</h2><p>{d.satisfactionSubtitle}</p></div><Link to="/client-feedback">{d.viewAll}</Link></div>
          <div className="dashboard-v2-quality-grid">
            <div><span>{d.avgRating}</span><strong>{overallAvg != null ? overallAvg.toFixed(1) : '—'}</strong></div>
            <div><span>{d.weeklyAvg}</span><strong>{weeklyAvg != null ? weeklyAvg.toFixed(1) : '—'}</strong></div>
            <div><span>{d.ratings30}</span><strong>{ratings30.length}</strong></div>
            <div className={atRisk.length ? 'is-danger' : ''}><span>{d.atRiskClientsShort}</span><strong>{atRisk.length}</strong></div>
          </div>
          {satisfactionByClient.length > 0 && <div className="dashboard-v2-chip-list">{[...satisfactionByClient].sort((a,b) => (b.avg || 0) - (a.avg || 0)).slice(0, 5).map(({ client, avg, level }) => <div className="dashboard-v2-client-chip" key={client.id}><span>{client.company_name}</span><strong className={`tone-${level}`}>{avg != null ? avg.toFixed(1) : '—'}</strong></div>)}</div>}
        </article>

        <article className="dashboard-v2-card">
          <div className="dashboard-v2-card-head"><div><h2>{d.deepCleanTitle}</h2><p>{fill(d.deepCleanSubtitle, { month: monthLabel })}</p></div><input aria-label={d.month} type="month" value={progressMonth} onChange={e => setProgressMonth(e.target.value)} /></div>
          <div className="dashboard-v2-progress-summary"><div><span>{d.completed}</span><strong>{deepProgress.totals.completed}</strong></div><div><span>{d.pending}</span><strong>{deepProgress.totals.pending}</strong></div><div><span>{d.progress}</span><strong>{deepProgress.totals.pct}%</strong></div></div>
          <div className="dashboard-v2-progress"><span style={{ width: `${deepProgress.totals.pct}%` }} /></div>
          <div className="dashboard-v2-location-list">{Object.entries(deepProgress.byLocation).slice(0, 5).map(([loc, data]) => { const pct = data.expected ? Math.round((data.completed / data.expected) * 100) : 0; return <button key={loc} type="button" onClick={() => { setDetailLoc(loc); setDetailTuesday(null) }} className="dashboard-v2-location"><span>{loc}</span><strong>{pct}%</strong></button> })}</div>
        </article>
      </section>

      <section className="dashboard-v2-card">
        <div className="dashboard-v2-card-head"><div><h2>{d.recentEvals}</h2><p>{d.recentEvalsSubtitle}</p></div></div>
        {evals.length === 0 ? <div className="dashboard-v2-empty"><strong>{d.noEvals}</strong></div> : <div className="dashboard-v2-eval-list">{evals.slice(0, 5).map(e => <div key={e.id} className="dashboard-v2-eval-row"><div><strong>{e.employee_name || '—'}</strong><span>{e.category || '—'} · {e.eval_date || '—'}</span></div><span className={e.points_change > 0 ? 'positive' : 'negative'}>{e.points_change > 0 ? '+' : ''}{e.points_change}</span></div>)}</div>}
      </section>

      {staleCount > 0 && <div className="dashboard-v2-stale"><span>⚠️ {fill(d.staleJobs, { count: staleCount })}</span><button onClick={cancelStaleJobs} className="btn btn-sm">{d.cancelStale}</button></div>}
      {loading && <div className="dashboard-v2-loading">{d.updating}</div>}
    </div>
  )
}
}