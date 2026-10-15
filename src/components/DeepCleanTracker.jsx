import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { buildDeepCleanProgress, currentYearMonth, formatScheduleDate, tuesdaySlotInfo, DEEP_CLEAN_LOCATIONS } from '../lib/cleaningType'
import { useLang, fill } from '../hooks/useLang'

// On The Planet deep-cleaning contract tracker. Lived on the admin dashboard until
// v1.0.34; now a tab of the Contracts page.
export default function DeepCleanTracker() {
  const { lang, t } = useLang()
  const d = t.dashboard
  const slotLabels = { ...d, status: t.status }
  const dateLocale = lang === 'ja' ? 'ja-JP' : 'en-GB'
  const [progressMonth, setProgressMonth] = useState(currentYearMonth())
  const [monthJobs, setMonthJobs] = useState([])
  const [detailLoc, setDetailLoc] = useState(null)
  const [detailTuesday, setDetailTuesday] = useState(null)

  useEffect(() => {
    let alive = true
    const load = () => supabase.from('jobs').select('*')
      .gte('scheduled_date', progressMonth + '-01').lte('scheduled_date', progressMonth + '-31').neq('status', 'cancelled')
      .then(({ data }) => { if (alive) setMonthJobs(data || []) })
    load()
    const timer = setInterval(load, 30000)
    return () => { alive = false; clearInterval(timer) }
  }, [progressMonth])

  const deepProgress = useMemo(() => buildDeepCleanProgress(monthJobs, progressMonth), [monthJobs, progressMonth])
  const monthLabel = new Date(progressMonth + '-01T12:00:00').toLocaleDateString(dateLocale, { month: 'long', year: 'numeric' })
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
    <div className="card" style={{ marginBottom: 20, borderLeft: '4px solid #fbbf24' }}>
      {DetailModal()}
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
  )
}
