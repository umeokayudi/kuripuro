import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { buildDeepCleanProgress, currentYearMonth, formatTuesday, tuesdaySlotInfo, DEEP_CLEAN_LOCATIONS } from '../lib/cleaningType'
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

  const closeDetail = () => { setDetailLoc(null); setDetailTuesday(null) }

  const DetailModal = () => {
    if (!detailLoc && !detailTuesday) return null
    const title = detailLoc
      ? `${detailLoc} — ${monthLabel}`
      : fill(d.tuesdayTitle, { date: formatTuesday(detailTuesday, lang) })

    const rows = detailLoc
      ? deepProgress.tuesdays.map(date => ({ date, job: deepProgress.byLocation[detailLoc]?.byDate[date] || null, loc: detailLoc }))
      : DEEP_CLEAN_LOCATIONS.map(loc => ({ date: detailTuesday, job: deepProgress.byLocation[loc]?.byDate[detailTuesday] || null, loc }))

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
              const dateLabel = detailLoc ? formatTuesday(date, lang) : loc
              const sub = detailLoc
                ? (job ? `${job.employee_name || '—'} · ${job.scheduled_time || '—'}` : d.noJob)
                : (job ? formatTuesday(date, lang) + ` · ${job.employee_name || '—'}` : d.noJob)
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{t.app.admin}</h2>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            {clock.toLocaleDateString(dateLocale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Tokyo' })}
            {lastUpdate && <span style={{ marginLeft: 10 }}>· {d.updated} {lastUpdate.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })}</span>}
            <button onClick={load} style={{ marginLeft: 10, fontSize: 10, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text3)', cursor: 'pointer' }}>🔄</button>
          </div>
        </div>
        <div style={{ fontSize: 36, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text)', letterSpacing: -2 }}>
          {clock.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })}
        </div>
      </div>

      {staleCount > 0 && (
        <div style={{ background: 'rgba(239,159,39,0.08)', border: '1px solid rgba(239,159,39,0.25)', borderRadius: 12, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--text2)' }}>⚠️ {fill(d.staleJobs, { count: staleCount })}</span>
          <button onClick={cancelStaleJobs} className="btn btn-sm" style={{ background: '#EF9F27', color: '#fff', border: 'none', flexShrink: 0 }}>{d.cancelStale}</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        {[
          [d.monthlyRevenue, fmt(revenue), 'var(--text)'],
          [d.netProfit, fmt(profit), 'var(--green)'],
          [d.activeEmployees, employees.length, 'var(--text)'],
          [d.todayJobs, todayJobs.length, 'var(--text)'],
        ].map(([l, v, c]) => (
          <div key={l} className="card" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>{l}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: c }}>{v}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 20, borderLeft: '4px solid #c19c56' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{d.satisfactionTitle}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{d.satisfactionSubtitle}</div>
          </div>
          <Link to="/client-feedback" style={{ fontSize: 12, color: '#c19c56', fontWeight: 600, textDecoration: 'none' }}>{d.viewFeedback}</Link>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
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
              {fill(d.deepContract, { tuesdays: deepProgress.tuesdays.length, month: monthLabel, expected: deepProgress.totals.expected })}
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

      {todayJobs.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>{d.todayJobsTitle} ({tokyoToday()})</div>
          {Object.entries(byEmp).map(([name, jobs]) => (
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
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
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
