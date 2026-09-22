import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { buildDeepCleanProgress, buildDaySummaries, currentYearMonth, deepCleanScheduleLabel, formatScheduleDate, storeProgressRows, tuesdaySlotInfo, DEEP_CLEAN_LOCATIONS } from '../lib/cleaningType'
import { deepCleanVisitSplit, jobMixSplit, partCount, partPct, storeRowSplit, withLabels } from '../lib/progressSplit'
import ProgressSplit, { ProgressSplitMini } from '../components/ProgressSplit'
import { useLang, fill, dateLocale } from '../hooks/useLang'
import { useConfirm } from '../hooks/useConfirm'
import AppDialog from '../components/AppDialog'
import { groupRatingsByClient, ratingsInPeriod, avgStars, starsDisplay } from '../lib/satisfaction'
import toast from 'react-hot-toast'
import { tokyoToday, monthBounds } from '../lib/dates'
import { summarizeStaffStatus } from '../lib/jobGps'
import { clientMonthlyCost } from '../lib/clientPortal'

function shiftYearMonth(ym, delta) {
  const [y, m] = String(ym || '').split('-').map(Number)
  if (!y || !m) return ym
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Dashboard() {
  const { lang, t } = useLang()
  const confirm = useConfirm()
  const d = t.dashboard
  const slotLabels = { ...d, status: t.status }
  const loc = dateLocale(lang)

  const [clients, setClients] = useState([])
  const [employees, setEmployees] = useState([])
  const [todayJobs, setTodayJobs] = useState([])
  const [inProgressJobs, setInProgressJobs] = useState([])
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
    const { from: monthStart, to: monthEnd } = monthBounds(progressMonth)
    const [c, e, j, ev, stale, mj, cr, activeNow] = await Promise.all([
      supabase.from('clients').select('*').eq('is_active', true),
      supabase.from('employees').select('id,full_name,score,is_active').eq('is_active', true).order('full_name'),
      supabase.from('jobs').select('*').eq('scheduled_date', today).order('scheduled_time'),
      supabase.from('evaluations').select('*').order('created_at', { ascending: false }).limit(5),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'assigned').lt('scheduled_date', today),
      supabase.from('jobs').select('*').gte('scheduled_date', monthStart).lte('scheduled_date', monthEnd).neq('status', 'cancelled'),
      supabase.from('client_ratings').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('jobs').select('*').eq('status', 'in_progress'),
    ])
    setClients(c.data || [])
    setEmployees(e.data || [])
    setTodayJobs(j.data || [])
    setInProgressJobs(activeNow.data || [])
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
    if (!(await confirm({
      title: d.cancelStale,
      message: fill(d.cancelStaleConfirm, { today }),
      tone: 'danger',
      confirmLabel: d.cancelStale,
    }))) return
    const { error } = await supabase.from('jobs').update({ status: 'cancelled' }).eq('status', 'assigned').lt('scheduled_date', today)
    if (error) return toast.error(error.message)
    toast.success(d.staleCancelled)
    load()
  }

  const fmt = n => '¥' + Number(n || 0).toLocaleString()
  const revenue = clients.reduce((s, c) => s + Number(c.monthly_revenue || 0), 0)
  const cost = clients.reduce((s, c) => s + clientMonthlyCost(c), 0)
  const profit = revenue - cost
  const costsUnset = clients.length > 0 && clients.every(c => clientMonthlyCost(c) === 0)

  const byEmp = {}
  todayJobs.forEach(j => {
    const k = j.employee_name || '—'
    if (!byEmp[k]) byEmp[k] = []
    byEmp[k].push(j)
  })
  const liveSummary = summarizeStaffStatus(employees, [...todayJobs, ...inProgressJobs], tokyoToday())

  const sortedClients = [...clients].sort((a, b) =>
    (Number(b.monthly_revenue || 0) - clientMonthlyCost(b)) - (Number(a.monthly_revenue || 0) - clientMonthlyCost(a))
  )
  const maxProfit = Math.max(...clients.map(c => Number(c.monthly_revenue || 0) - clientMonthlyCost(c)), 1)
  const statusColor = s => ({ assigned: '#60a5fa', in_progress: '#fbbf24', completed: '#4ade80', cancelled: 'rgba(255,255,255,0.2)' }[s] || '#60a5fa')

  const deepProgress = useMemo(() => buildDeepCleanProgress(monthJobs, progressMonth), [monthJobs, progressMonth])
  const daySummaries = useMemo(() => buildDaySummaries(deepProgress.byLocation), [deepProgress])
  const storeRows = useMemo(() => storeProgressRows(deepProgress.byLocation, tokyoToday(), lang), [deepProgress, lang])
  const completedDays = daySummaries.filter(d => d.state === 'done').length
  const missingDays = daySummaries.filter(d => d.state === 'missing').length
  const lateDays = storeRows.reduce((s, r) => s + (r.late || 0), 0)
  const deepVisitSplit = useMemo(
    () => withLabels(deepCleanVisitSplit(deepProgress.byLocation), {
      done: d.mixDone || d.completed,
      pending: d.pending,
      late: d.mixLate || d.lateSlots,
      missing: d.mixMissing || d.missingSchedule,
    }),
    [deepProgress, d],
  )
  const todaySplit = useMemo(
    () => withLabels(jobMixSplit(todayJobs), {
      done: d.mixDone || d.completed,
      progress: d.mixProgress || d.slotProgress,
      assigned: d.mixAssigned || d.pending,
      late: d.mixLate || d.lateSlots,
    }),
    [todayJobs, d],
  )
  const monthSplit = useMemo(
    () => withLabels(jobMixSplit(monthJobs), {
      done: d.mixDone || d.completed,
      progress: d.mixProgress || d.slotProgress,
      assigned: d.mixAssigned || d.pending,
      late: d.mixLate || d.lateSlots,
    }),
    [monthJobs, d],
  )
  const todayOverdue = partCount(todaySplit, 'late')
  const monthOverdue = partCount(monthSplit, 'late')
  const overdueNow = staleCount + todayOverdue
  const deepDonePct = partPct(deepVisitSplit, 'done')
  const monthLabel = new Date(progressMonth + '-01T12:00:00').toLocaleDateString(loc, { month: 'long', year: 'numeric' })

  const ratings30 = ratingsInPeriod(clientRatings, 30)
  const ratings7 = ratingsInPeriod(clientRatings, 7)
  const satisfactionByClient = groupRatingsByClient(ratings30, clients)
  const atRisk = satisfactionByClient.filter(x => x.avg != null && x.avg < 3.5)
  const overallAvg = avgStars(ratings30)
  const weeklyAvg = avgStars(ratings7)
  const monthlyAvg = overallAvg
  const levelColor = l => ({ excellent: 'var(--green)', good: '#60a5fa', warning: '#EF9F27', critical: 'var(--red)', none: 'var(--text3)' }[l] || 'var(--text3)')

  const closeDetail = () => { setDetailLoc(null); setDetailTuesday(null) }

  const detailTitle = detailLoc
    ? `${detailLoc} — ${monthLabel} (${deepCleanScheduleLabel(detailLoc, lang)})`
    : detailTuesday
      ? fill(d.tuesdayTitle, { date: formatScheduleDate(detailTuesday, lang) })
      : ''

  const detailRows = detailLoc
    ? (deepProgress.byLocation[detailLoc]?.expectedDates || []).map(date => ({ date, job: deepProgress.byLocation[detailLoc]?.byDate[date] || null, loc: detailLoc }))
    : detailTuesday
      ? DEEP_CLEAN_LOCATIONS.filter(locName => deepProgress.byLocation[locName]?.expectedDates?.includes(detailTuesday)).map(locName => ({ date: detailTuesday, job: deepProgress.byLocation[locName]?.byDate[detailTuesday] || null, loc: locName }))
      : []

  return (
    <div>
      <AppDialog
        open={Boolean(detailLoc || detailTuesday)}
        title={detailTitle}
        cancelLabel={t.dialog.close}
        onClose={closeDetail}
        wide
      >
        <div style={{ display: 'grid', gap: 8 }}>
          {detailRows.map(({ date, job, loc: locName }) => {
            const slot = tuesdaySlotInfo(job, slotLabels, date)
            const dateLabel = detailLoc ? formatScheduleDate(date, lang) : locName
            const sub = detailLoc
              ? (job ? `${job.employee_name || '—'} · ${job.scheduled_time || '—'}` : d.noJob)
              : (job ? formatScheduleDate(date, lang) + ` · ${job.employee_name || '—'}` : d.noJob)
            return (
              <div key={`${locName}-${date}`} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', borderRadius: 10, background: `${slot.color}10`, border: `1px solid ${slot.color}35` }}>
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
      </AppDialog>
      <div className="dash-hero">
        <div>
          <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 2 }}>
            {clock.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Tokyo' })}
            <span style={{ marginLeft: 8 }}>{d.tokyo}</span>
            {lastUpdate && <span style={{ marginLeft: 10 }}>· {d.updated} {lastUpdate.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })}</span>}
            <button type="button" onClick={load} aria-label={d.updating} style={{ marginLeft: 10, fontSize: 10, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text3)', cursor: 'pointer' }}>↻</button>
          </div>
        </div>
        <div className="dash-clock">
          {clock.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })}
        </div>
      </div>

      {staleCount > 0 && (
        <div className="dash-stale">
          <span style={{ fontSize: 13, color: 'var(--text2)' }}>⚠️ {fill(d.staleJobs, { count: staleCount })}</span>
          <button onClick={cancelStaleJobs} className="btn btn-sm" style={{ background: '#EF9F27', color: '#fff', border: 'none', flexShrink: 0 }}>{d.cancelStale}</button>
        </div>
      )}

      <div className="dash-quick">
        <Link to="/jobs" className="dash-quick-btn">
          <strong>{todayJobs.length}</strong>
          <span>{d.quickToday}</span>
        </Link>
        <Link to="/reports" className="dash-quick-btn">
          <strong>{d.quickReports}</strong>
          <span>{d.quickReportsHint}</span>
        </Link>
        <Link to="/salary" className="dash-quick-btn">
          <strong>{d.quickPay}</strong>
          <span>{d.quickPayHint}</span>
        </Link>
        <Link to="/schedule" className="dash-quick-btn">
          <strong>{d.quickPlan}</strong>
          <span>{d.quickPlanHint}</span>
        </Link>
      </div>

      <div className="dash-metrics">
        {[
          [d.monthlyRevenue, fmt(revenue), 'var(--text)'],
          [costsUnset ? (d.costsUnset || d.netProfit) : d.netProfit, costsUnset ? '—' : fmt(profit), costsUnset ? 'var(--text3)' : 'var(--green)'],
          [d.activeEmployees, employees.length, 'var(--text)'],
          [d.todayJobs, todayJobs.length, 'var(--text)'],
        ].map(([l, v, c]) => (
          <div key={l} className="metric-card">
            <div className="metric-label">{l}</div>
            <div className="metric-value" style={{ color: c }}>{v}</div>
          </div>
        ))}
      </div>

      <div className="card dash-ops" style={{ borderLeft: `4px solid ${overdueNow ? '#f87171' : '#4ade80'}` }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{d.mixTitle}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{fill(d.mixHint, { month: monthLabel })}</div>
          </div>
          <Link to="/jobs" style={{ fontSize: 12, color: '#c19c56', fontWeight: 600, textDecoration: 'none' }}>{d.mixOpenJobs}</Link>
        </div>
        <div className="dash-ops-grid">
          <div className={`dash-ops-overdue${overdueNow ? '' : ' ok'}`}>
            <div className="dash-ops-overdue-n">{overdueNow}</div>
            <div className="dash-ops-overdue-lbl">{d.mixOverdue}</div>
            <div className="dash-ops-overdue-hint">
              {overdueNow
                ? fill(d.mixOverdueHint, { n: overdueNow })
                : d.mixNoneOverdue}
            </div>
            {overdueNow > 0 && staleCount > monthOverdue && (
              <div className="dash-ops-overdue-hint">
                {fill(d.mixOverdueOlder, { older: staleCount - monthOverdue })}
              </div>
            )}
          </div>
          <ProgressSplit
            compact
            title={d.mixTodayTitle}
            headline={todayJobs.length ? String(todayJobs.length) : '0'}
            headlineHint={todayJobs.length ? `${todayOverdue} ${d.mixLate || d.lateSlots}` : d.mixTodayEmpty}
            parts={todaySplit.parts}
          />
          <ProgressSplit
            compact
            title={d.mixMonthTitle}
            headline={monthJobs.length ? String(monthJobs.length) : '0'}
            headlineHint={monthJobs.length ? `${monthOverdue} ${d.mixLate || d.lateSlots}` : d.mixMonthEmpty}
            parts={monthSplit.parts}
          />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20, borderLeft: '4px solid #4ade80' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{d.liveNow}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{d.liveNowHint}</div>
          </div>
          <Link to="/live" style={{ fontSize: 12, color: '#c19c56', fontWeight: 600, textDecoration: 'none' }}>{d.openLive}</Link>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: liveSummary.working ? 12 : 0 }}>
          {[
            [d.liveNow, liveSummary.working, '#4ade80'],
            [d.liveIdle, liveSummary.idle, '#60a5fa'],
            [d.liveUnscheduled || d.liveFolga, liveSummary.unscheduled, 'var(--text3)'],
          ].map(([label, n, color]) => (
            <div key={label} style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color }}>{n}</div>
            </div>
          ))}
        </div>
        {liveSummary.rows.filter(r => r.key === 'working').length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {liveSummary.rows.filter(r => r.key === 'working').map(r => (
              <Link key={r.employee.id} to="/live" style={{ padding: '6px 12px', borderRadius: 20, background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.25)', fontSize: 12, color: '#4ade80', fontWeight: 600, textDecoration: 'none' }}>
                ● {r.employee.full_name.split(' ')[0]}{r.job ? ` · ${(r.job.title || '').replace(/ — .*/, '').slice(0, 18)}` : ''}
              </Link>
            ))}
          </div>
        )}
      </div>

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
            [d.monthlyAvg, monthlyAvg != null ? monthlyAvg.toFixed(1) : '—'],
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
              {fill(d.deepContract, {
                month: monthLabel,
                expected: deepProgress.totals.expected,
                days: daySummaries.length,
              })}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button type="button" className="btn btn-sm" onClick={() => setProgressMonth(shiftYearMonth(progressMonth, -1))} aria-label={d.prevDay || '‹'}>‹</button>
            <span style={{ fontSize: 13, fontWeight: 700, minWidth: 120, textAlign: 'center' }}>{monthLabel}</span>
            <button type="button" className="btn btn-sm" onClick={() => setProgressMonth(shiftYearMonth(progressMonth, 1))} aria-label={d.nextDay || '›'}>›</button>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <ProgressSplit
            title={d.progress}
            headline={fill(d.mixVisits, { done: partCount(deepVisitSplit, 'done'), expected: deepProgress.totals.expected })}
            headlineHint={fill(d.mixVisitPct, { pct: deepDonePct })}
            subtitle={d.deepSplitHint}
            parts={deepVisitSplit.parts}
          />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          {[
            [d.serviceDays, `${completedDays}/${daySummaries.length}`, '#4ade80'],
            [d.missingDays || d.missingSchedule, missingDays, '#fbbf24'],
            [d.lateSlots, lateDays, '#f87171'],
          ].map(([l, v, c]) => (
            <div key={l} style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 16px', minWidth: 100 }}>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{l}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: c }}>{v}</div>
            </div>
          ))}
        </div>

        {daySummaries.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 8 }}>{d.byTuesday}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {daySummaries.map((day) => {
                const tone = day.state === 'done'
                  ? { bg: 'rgba(74,222,128,0.12)', border: 'rgba(74,222,128,0.3)', color: '#4ade80' }
                  : day.state === 'late'
                    ? { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.35)', color: '#f87171' }
                    : day.state === 'partial'
                      ? { bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.3)', color: '#60a5fa' }
                      : { bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.25)', color: '#fbbf24' }
                return (
                  <button key={day.date} type="button" onClick={() => { setDetailTuesday(day.date); setDetailLoc(null) }}
                    style={{ padding: '8px 12px', borderRadius: 8, cursor: 'pointer', background: tone.bg, border: `1px solid ${tone.border}`, fontSize: 12, textAlign: 'left' }}>
                    <div style={{ fontWeight: 700 }}>{fill(d.tuesdayShort, { date: formatScheduleDate(day.date, lang) })}</div>
                    <div style={{ color: tone.color, fontWeight: 600 }}>{fill(d.doneOf, { done: day.done, expected: day.expected })}</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{d.clickTuesday}</div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 8 }}>{d.byRestaurant}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
          {storeRows.map((row) => {
            const ok = row.completed >= row.expected
            return (
              <button key={row.name} type="button" onClick={() => { setDetailLoc(row.name); setDetailTuesday(null) }}
                style={{ padding: '10px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', background: 'var(--surface2)', border: `1px solid ${ok ? 'rgba(74,222,128,0.25)' : 'var(--border)'}` }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4 }}>{row.schedule || deepCleanScheduleLabel(row.name, lang)}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>
                  <span>{fill(d.doneCount, { done: row.completed, expected: row.expected })}</span>
                  <span style={{ color: ok ? '#4ade80' : '#fbbf24', fontWeight: 700 }}>{row.pct}%</span>
                </div>
                <ProgressSplitMini parts={storeRowSplit(row).parts} />
                {row.late > 0 && <div style={{ fontSize: 10, color: '#f87171', marginTop: 4 }}>⚠ {d.lateSlots}: {row.late}</div>}
                {row.missing > 0 && <div style={{ fontSize: 10, color: '#fbbf24', marginTop: 4 }}>⚠ {fill(d.notScheduled, { n: row.missing })}</div>}
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6 }}>{d.clickRestaurant}</div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span>{d.todayJobsTitle} ({tokyoToday()})</span>
          <Link to="/jobs" style={{ fontSize: 12, color: '#c19c56', fontWeight: 600, textDecoration: 'none' }}>{t.sidebar.jobs} →</Link>
        </div>
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
            const p = Number(c.monthly_revenue || 0) - clientMonthlyCost(c)
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
