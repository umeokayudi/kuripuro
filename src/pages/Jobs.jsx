import { useState, useEffect, useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { geocodeAddress } from '../lib/geocode'
import { isNavigableAddress, mapsOpenUrl, hasMapsLink } from '../lib/mapsLink'
import {
  getCleaningType, locationNameFromTitle, applyCleaningTypeToTitle, cleaningTypesForLang,
  DEEP_TASKS, deepTaskName, parseDeepTaskList,
} from '../lib/cleaningType'
import { useLang, fill, localeOf } from '../hooks/useLang'
import JobPhotos from '../components/JobPhotos'
import JobVideos from '../components/JobVideos'
import PhotoLightbox from '../components/PhotoLightbox'
import toast from 'react-hot-toast'
import { googleCalendarUrl } from '../lib/calendar'
import { contractStatus } from '../lib/spotContract'
import { generateContractForJob } from '../lib/spotContractOps'
import { fetchContractSellers } from '../lib/contractSellers'
import JobsPeriodPanel from '../components/JobsPeriodPanel'
import NewJobForm from '../components/NewJobForm'
import { tokyoToday } from '../lib/dates'
import { isMissedJob, isRetroJob } from '../lib/jobOverdue'
import { jobDurationMin } from '../lib/workKpis'
import {
  periodRange, previousRange, inRange, matchesPeople, summarize, summarizeByPerson, fmtMinutes, fmtStartEnd,
} from '../lib/jobsPeriod'

function applyGeocodeResult(result, setCoords, mapsMsg) {
  if (result?.lat != null && result?.lng != null) {
    setCoords(result)
    toast.success(`GPS: ${result.lat.toFixed(4)}, ${result.lng.toFixed(4)}`)
    return true
  }
  if (result?.mapsLink) {
    setCoords(null)
    toast.success(mapsMsg)
    return true
  }
  return false
}

/** "Coifa, Fritadeira" from a "Deep Clean (Range Hood, Fryer)" title, or '' when it has no list. */
function deepTaskList(title, lang) {
  return (parseDeepTaskList(title) || [])
    .map(l => { const t = DEEP_TASKS.find(x => x.label.toLowerCase() === l.toLowerCase()); return t ? deepTaskName(t, lang) : l })
    .join(', ')
}

function toDateStr(d) {
  return d.toISOString().split('T')[0]
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return toDateStr(d)
}

function buildCalendarDays(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const last = new Date(y, m, 0)
  let startPad = first.getDay() - 1
  if (startPad < 0) startPad = 6
  const days = []
  for (let i = 0; i < startPad; i++) days.push(null)
  for (let d = 1; d <= last.getDate(); d++) {
    days.push(`${yearMonth}-${String(d).padStart(2, '0')}`)
  }
  return days
}

function dayDotColor(stats) {
  if (!stats?.total) return null
  if (stats.completed >= stats.total) return '#4ade80'
  if (stats.completed > 0) return '#fbbf24'
  return '#60a5fa'
}

function ProgressBar({ pct, height = 10, style }) {
  const safe = Math.min(100, Math.max(0, pct))
  return (
    <div style={{ height, background: 'var(--surface2)', borderRadius: height / 2, overflow: 'hidden', ...style }}>
      <div style={{
        height: '100%', width: `${safe}%`,
        background: safe >= 100 ? '#4ade80' : 'linear-gradient(90deg,#60a5fa,#4ade80)',
        borderRadius: height / 2, transition: 'width 0.35s ease',
      }} />
    </div>
  )
}

function statusStyle(status, labels) {
  const colors = {
    assigned: { bg: 'rgba(96,165,250,0.12)', border: '#60a5fa', text: '#93c5fd' },
    in_progress: { bg: 'rgba(251,191,36,0.14)', border: '#fbbf24', text: '#fcd34d' },
    completed: { bg: 'rgba(74,222,128,0.12)', border: '#4ade80', text: '#86efac' },
    cancelled: { bg: 'rgba(248,113,113,0.1)', border: '#f87171', text: '#fca5a5' },
  }
  const c = colors[status] || colors.assigned
  return { ...c, label: labels[status] || status }
}

function DayScheduleView({ onClose }) {
  const { lang, t, tr } = useLang()
  const jt = t.jobs
  const st = t.status
  const CLEANING_TYPES = cleaningTypesForLang(lang)
  const dateLocale = localeOf(lang)
  const [date, setDate] = useState(toDateStr(new Date()))
  const [calMonth, setCalMonth] = useState(() => toDateStr(new Date()).slice(0, 7))
  const [showCalendar, setShowCalendar] = useState(false)
  const [dayJobs, setJobs] = useState([])
  const [areaFilter, setAreaFilter] = useState('')
  const dayAreas = useMemo(() => [...new Set(dayJobs.map(j => j.area).filter(Boolean))].sort(), [dayJobs])
  const jobs = areaFilter ? dayJobs.filter(j => (j.area || '') === areaFilter) : dayJobs
  const [monthJobStats, setMonthJobStats] = useState({})
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => { loadEmps() }, [])
  useEffect(() => { loadJobs() }, [date])
  useEffect(() => { loadMonthStats(calMonth) }, [calMonth])
  useEffect(() => { setCalMonth(date.slice(0, 7)) }, [date])

  const loadEmps = async () => {
    const { data } = await supabase.from('employees').select('id,full_name').eq('is_active', true).order('full_name')
    setEmployees(data || [])
  }

  const loadJobs = async () => {
    setLoading(true)
    const { data } = await supabase.from('jobs').select('*').eq('scheduled_date', date).order('sequence_order')
    setJobs(data || [])
    setLoading(false)
  }

  const loadMonthStats = async (ym) => {
    const { data } = await supabase.from('jobs')
      .select('scheduled_date, status')
      .gte('scheduled_date', `${ym}-01`)
      .lte('scheduled_date', `${ym}-31`)
    const stats = {}
    for (const j of data || []) {
      if (!stats[j.scheduled_date]) stats[j.scheduled_date] = { total: 0, completed: 0 }
      stats[j.scheduled_date].total++
      if (j.status === 'completed') stats[j.scheduled_date].completed++
    }
    setMonthJobStats(stats)
  }

  const selectDate = (ds) => {
    setDate(ds)
    setShowCalendar(false)
  }

  const shiftCalMonth = (delta) => {
    const [y, m] = calMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setCalMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const calendarDays = useMemo(() => buildCalendarDays(calMonth), [calMonth])
  const weekDays = tr(
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    ['月', '火', '水', '木', '金', '土', '日'],
    ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
  )
  const monthLabel = new Date(calMonth + '-01T12:00:00').toLocaleDateString(dateLocale, { month: 'long', year: 'numeric' })
  const todayStr = toDateStr(new Date())

  const handleReassign = async (jobId, empId) => {
    if (!empId) {
      await supabase.from('jobs').update({ employee_id: null, employee_name: null }).eq('id', jobId)
      loadJobs()
      return
    }
    const emp = employees.find(e => e.id === empId)
    await supabase.from('jobs').update({ employee_id: empId, employee_name: emp?.full_name }).eq('id', jobId)
    loadJobs()
  }

  const handleStatusChange = async (jobId, status) => {
    await supabase.from('jobs').update({ status }).eq('id', jobId)
    loadJobs()
    loadMonthStats(calMonth)
  }

  const handleTimeChange = async (jobId, time) => {
    await supabase.from('jobs').update({ scheduled_time: time }).eq('id', jobId)
    loadJobs()
  }

  const handleDelete = async (jobId, title) => {
    if (!confirm(fill(jt.deleteJobConfirm, { title }))) return
    await supabase.from('jobs').delete().eq('id', jobId)
    toast.success(jt.jobDeleted)
    loadJobs()
    loadMonthStats(calMonth)
  }

  const handleCleaningTypeChange = async (job, type) => {
    const loc = locationNameFromTitle(job.title)
    const { error } = await supabase.from('jobs').update({ title: applyCleaningTypeToTitle(loc, type) }).eq('id', job.id)
    if (error) return toast.error(error.message)
    loadJobs()
  }

  const empGroups = employees.map(e => ({
    emp: e,
    jobs: jobs.filter(j => j.employee_id === e.id).sort((a, b) => (a.sequence_order || 99) - (b.sequence_order || 99)),
  })).filter(g => g.jobs.length > 0)

  const unassigned = jobs.filter(j => !j.employee_id)
  const done = jobs.filter(j => j.status === 'completed').length
  const inProgress = jobs.filter(j => j.status === 'in_progress').length
  const pending = jobs.filter(j => j.status === 'assigned').length
  const progressPct = jobs.length ? Math.round((done / jobs.length) * 100) : 0
  const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString(dateLocale, { weekday: 'long', day: 'numeric', month: 'long' })
  const dateShort = new Date(date + 'T12:00:00').toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit', year: 'numeric' })

  const JobCard = ({ j, idx }) => {
    const stl = statusStyle(j.status, st)
    const missed = isMissedJob(j)
    const locName = locationNameFromTitle(j.title)
    const ctype = getCleaningType(j)
    const ctypeCfg = CLEANING_TYPES[ctype]
    return (
      <div style={{
        background: 'var(--surface)',
        border: `1px solid var(--border)`,
        borderLeft: `4px solid ${ctype === 'deep' ? ctypeCfg.color : stl.border}`,
        borderRadius: 12,
        padding: '14px 16px',
        marginBottom: 10,
      }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 800,
            background: stl.bg, color: stl.text, border: `2px solid ${stl.border}`,
          }}>
            {j.status === 'completed' ? '✓' : idx + 1}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>{locName}</div>
            <div style={{ fontSize: 13, color: ctypeCfg.color, fontWeight: 600, marginTop: 2 }}>{ctypeCfg.label}{j.area && <span style={{ color: 'var(--text3)', fontWeight: 600 }}> · 📍 {j.area}</span>}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', background: 'var(--surface2)', padding: '4px 10px', borderRadius: 8 }}>
                🕐 {j.scheduled_time || '00:30'}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: missed ? '#fca5a5' : stl.text, background: missed ? 'rgba(248,113,113,0.12)' : stl.bg, padding: '4px 10px', borderRadius: 8 }}>
                {missed ? jt.incomplete : stl.label}
              </span>
              {isRetroJob(j) && <span className="badge badge-amber" title={jt.retroBadgeHint}>{jt.retroBadge}</span>}
              {j.value > 0 && <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>¥{Number(j.value).toLocaleString()}</span>}
            </div>
            {j.description && (
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8, background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px', lineHeight: 1.5 }}>
                🔑 {j.description.split('\n')[0]}
              </div>
            )}
            {hasMapsLink(j.address, locName) && (
              <a href={mapsOpenUrl(j.address, locName)} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 8, fontSize: 12, color: '#60a5fa', textDecoration: 'none', fontWeight: 600 }}>
                🗺 {jt.openMaps}
              </a>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
          <label style={{ fontSize: 11, color: 'var(--text3)' }}>
            {jt.time}
            <input type="time" defaultValue={j.scheduled_time || '00:30'} onBlur={e => handleTimeChange(j.id, e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 4, fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }} />
          </label>
          <label style={{ fontSize: 11, color: 'var(--text3)' }}>
            {jt.employee}
            <select value={j.employee_id || ''} onChange={e => handleReassign(j.id, e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 4, fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }}>
              <option value="">{jt.unassigned}</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 11, color: 'var(--text3)' }}>
            {jt.cleaningType}
            <select value={ctype} onChange={e => handleCleaningTypeChange(j, e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 4, fontSize: 13, padding: '8px 10px', borderRadius: 8, border: `2px solid ${ctypeCfg.color}`, background: `${ctypeCfg.color}12`, color: ctypeCfg.color, fontWeight: 600 }}>
              <option value="basic">{jt.filterBasic}</option>
              <option value="deep">{jt.filterDeep}</option>
            </select>
          </label>
          <label style={{ fontSize: 11, color: 'var(--text3)' }}>
            {jt.status}
            <select value={j.status} onChange={e => handleStatusChange(j.id, e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 4, fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: stl.text, fontWeight: 600 }}>
              <option value="assigned">{st.assigned}</option>
              <option value="in_progress">{st.in_progress}</option>
              <option value="completed">{st.completed}</option>
              <option value="cancelled">{st.cancelled}</option>
            </select>
          </label>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn btn-danger" onClick={() => handleDelete(j.id, locName)} style={{ width: '100%', fontSize: 13, padding: '9px 12px' }}>
              🗑 {jt.deleteJob}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg, #0a1929)', zIndex: 200, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '16px 20px', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn" onClick={onClose}>← {jt.back}</button>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>📅 {jt.dayScheduleTitle}</h2>
              <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 2, textTransform: 'capitalize' }}>{dateLabel}</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <button className="btn" onClick={() => setDate(shiftDate(date, -1))} title={jt.prevDay}>◀ {jt.prevDay}</button>
            <button
              className="btn"
              onClick={() => setShowCalendar(v => !v)}
              style={{ fontWeight: 700, minWidth: 130, background: showCalendar ? 'var(--navy)' : 'var(--surface2)', color: showCalendar ? '#fff' : 'var(--text)' }}
            >
              📅 {dateShort}
            </button>
            <button className="btn" onClick={() => setDate(shiftDate(date, 1))} title={jt.nextDay}>{jt.nextDay} ▶</button>
            {date !== todayStr && (
              <button className="btn btn-primary" onClick={() => setDate(todayStr)}>{jt.today}</button>
            )}
          </div>
        </div>

        {showCalendar && (
          <div style={{
            marginTop: 14, padding: 14, background: 'var(--surface2)', borderRadius: 14,
            border: '1px solid var(--border)', maxWidth: 360,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <button type="button" className="btn btn-sm" onClick={() => shiftCalMonth(-1)}>◀</button>
              <div style={{ fontWeight: 800, fontSize: 14, textTransform: 'capitalize' }}>{monthLabel}</div>
              <button type="button" className="btn btn-sm" onClick={() => shiftCalMonth(1)}>▶</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
              {weekDays.map(w => (
                <div key={w} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text3)', padding: '2px 0' }}>{w}</div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
              {calendarDays.map((ds, i) => {
                if (!ds) return <div key={`pad-${i}`} />
                const dayNum = Number(ds.split('-')[2])
                const stats = monthJobStats[ds]
                const dot = dayDotColor(stats)
                const isSelected = ds === date
                const isToday = ds === todayStr
                return (
                  <button
                    key={ds}
                    type="button"
                    onClick={() => selectDate(ds)}
                    style={{
                      aspectRatio: '1', borderRadius: 10, border: '2px solid',
                      borderColor: isSelected ? 'var(--navy)' : isToday ? '#60a5fa' : 'transparent',
                      background: isSelected ? 'var(--navy)' : isToday ? 'rgba(96,165,250,0.12)' : 'var(--surface)',
                      color: isSelected ? '#fff' : 'var(--text)',
                      fontWeight: isSelected || isToday ? 800 : 600,
                      fontSize: 13, cursor: 'pointer', padding: 0,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                    }}
                  >
                    <span>{dayNum}</span>
                    {dot && <span style={{ width: 5, height: 5, borderRadius: '50%', background: isSelected ? '#fff' : dot }} />}
                  </button>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 10, color: 'var(--text3)', flexWrap: 'wrap' }}>
              <span>● {st.completed}</span>
              <span style={{ color: '#fbbf24' }}>● {st.in_progress}</span>
              <span style={{ color: '#60a5fa' }}>● {st.assigned}</span>
            </div>
          </div>
        )}

        <div style={{ marginTop: 14, background: 'var(--surface2)', borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{jt.checkingProgress}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: progressPct >= 100 ? '#4ade80' : '#60a5fa' }}>
              {fill(jt.progressSummary, { done, total: jobs.length, pct: progressPct })}
            </div>
          </div>
          <ProgressBar pct={progressPct} height={12} />
        </div>

        {dayAreas.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>📍 {tr('Area', 'エリア', 'Área')}</span>
            <button type="button" className={`tab-pill${!areaFilter ? ' active' : ''}`} onClick={() => setAreaFilter('')}>{tr('All', 'すべて', 'Todos')} ({dayJobs.length})</button>
            {dayAreas.map(a => (
              <button key={a} type="button" className={`tab-pill${areaFilter === a ? ' active' : ''}`} onClick={() => setAreaFilter(a)}>{a} ({dayJobs.filter(j => j.area === a).length})</button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          {[
            [jt.total, jobs.length, 'var(--text)'],
            [st.completed, done, '#4ade80'],
            [st.assigned, pending, '#60a5fa'],
            [st.in_progress, inProgress, '#fbbf24'],
            [jt.progress, `${progressPct}%`, progressPct >= 100 ? '#4ade80' : '#fbbf24'],
          ].map(([label, val, color]) => (
            <div key={label} style={{ background: 'var(--surface2)', borderRadius: 10, padding: '10px 16px', minWidth: 90 }}>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color }}>{val}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '20px', maxWidth: 900, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {loading && <div style={{ color: 'var(--text3)', fontSize: 14, padding: 20 }}>{t.app.loading}</div>}

        {!loading && jobs.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{jt.noJobsDay}</div>
            <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>{jt.chooseDate}</div>
          </div>
        )}

        {empGroups.map(({ emp, jobs: empJobs }) => {
          const empDone = empJobs.filter(j => j.status === 'completed').length
          const empPct = empJobs.length ? Math.round((empDone / empJobs.length) * 100) : 0
          return (
          <div key={emp.id} style={{ marginBottom: 24 }}>
            <div style={{
              fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 12,
              padding: '10px 14px', background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: empJobs.every(j => j.status === 'completed') ? '#4ade80'
                    : empJobs.some(j => j.status === 'in_progress') ? '#fbbf24' : '#60a5fa',
                }} />
                {emp.full_name}
                <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 500 }}>
                  {fill(jt.doneOfTotal, { done: empDone, total: empJobs.length })}
                </span>
                <span style={{ fontSize: 12, fontWeight: 800, color: empPct >= 100 ? '#4ade80' : '#60a5fa', marginLeft: 'auto' }}>
                  {empPct}%
                </span>
              </div>
              <ProgressBar pct={empPct} height={6} />
            </div>
            {empJobs.map((j, idx) => <JobCard key={j.id} j={j} idx={idx} />)}
          </div>
        )})}

        {unassigned.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#fbbf24', marginBottom: 12, padding: '10px 14px', background: 'rgba(251,191,36,0.1)', borderRadius: 12, border: '1px solid rgba(251,191,36,0.25)' }}>
              ⚠️ {jt.noEmployee} ({unassigned.length})
            </div>
            {unassigned.map((j, idx) => <JobCard key={j.id} j={j} idx={idx} />)}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Jobs() {
  const [searchParams] = useSearchParams()
  const searchId = searchParams.get('search')
  const { lang, t } = useLang()
  const jt = t.jobs
  const st = t.status
  const CLEANING_TYPES = cleaningTypesForLang(lang)
  const [tab, setTab] = useState('list')
  const [cleaningFilter, setCleaningFilter] = useState('all')
  const [period, setPeriod] = useState('7d')
  const [customRange, setCustomRange] = useState(() => ({ from: shiftDate(tokyoToday(), -6), to: tokyoToday() }))
  const [people, setPeople] = useState(() => new Set())
  const [jobs, setJobs] = useState([])
  const [employees, setEmployees] = useState([])
  const [clients, setClients] = useState([])
  const [locations, setLocations] = useState([])
  const [showDaySchedule, setShowDaySchedule] = useState(false)
  const [editingLoc, setEditingLoc] = useState(null)
  const [loading, setLoading] = useState(true)
  const [geocoding, setGeocoding] = useState(false)
  const [lightbox, setLightbox] = useState(null)
  const [spotContracts, setSpotContracts] = useState([])
  const [sellers, setSellers] = useState({ salespeople: [], rules: [] })

  useEffect(() => { loadAll(); fetchContractSellers().then(setSellers) }, [])
  useEffect(() => {
    if (!searchId) return
    const selected = jobs.find(job => job.id === searchId)
    if (selected) setTab(selected.job_category === 'spot' ? 'spot' : 'list')
  }, [searchId, jobs])

  const loadAll = async () => {
    setLoading(true)
    const [j, e, c, l] = await Promise.all([
      supabase.from('jobs').select('*').order('scheduled_date', { ascending: false }),
      supabase.from('employees').select('id,full_name,salary_type,hourly_rate,fixed_salary').eq('is_active', true),
      supabase.from('clients').select('id,company_name,address,contact_person,contact_name,phone,manager_name,manager_phone').eq('is_active', true),
      supabase.from('locations').select('*').eq('is_active', true).order('name'),
    ])
    // Table added in v1.0.21; ignore errors so Jobs still loads if it is missing.
    const sc = await supabase.from('spot_contracts').select('id,job_id,contract_number,status').eq('is_active', true)
    setSpotContracts(sc.error ? [] : (sc.data || []))
    setJobs(j.data || [])
    setEmployees(e.data || [])
    setClients(c.data || [])
    setLocations(l.data || [])
    setLoading(false)
  }

  const statusColor = s => ({ assigned:'badge-blue', in_progress:'badge-amber', completed:'badge-green', cancelled:'badge-red' }[s] || 'badge-navy')
  const spotStatusColor = s => ({ pending:'badge-amber', accepted:'badge-green', declined:'badge-red' }[s] || 'badge-navy')

  const handleCleaningTypeChange = async (job, type) => {
    const loc = locationNameFromTitle(job.title)
    const newTitle = applyCleaningTypeToTitle(loc, type)
    const { error } = await supabase.from('jobs').update({ title: newTitle }).eq('id', job.id)
    if (error) return toast.error(error.message)
    toast.success(type === 'deep' ? jt.deep : jt.simple)
    loadAll()
  }

  const handleCancel = async (id) => {
    await supabase.from('jobs').update({ status: 'cancelled' }).eq('id', id)
    loadAll()
  }

  const matchingJobs = searchId ? jobs.filter(j => j.id === searchId) : jobs
  const spotJobs = matchingJobs.filter(j => j.job_category === 'spot')
  const allRegularJobs = matchingJobs.filter(j => j.job_category !== 'spot')
  // Period + people filters (skipped when opening one job from search).
  const range = searchId ? null : periodRange(period, tokyoToday(), customRange)
  const prevRange = previousRange(range)
  const peopleOptions = (() => {
    const seen = new Map()
    for (const j of allRegularJobs) if (!seen.has(j.employee_id || '')) seen.set(j.employee_id || '', j.employee_name || '')
    for (const e of employees) if (seen.has(e.id)) seen.set(e.id, e.full_name)
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => (!a.id) - (!b.id) || a.name.localeCompare(b.name))
  })()
  const byPeople = j => searchId || matchesPeople(j, people)
  const regularJobs = allRegularJobs.filter(j => inRange(j, range) && byPeople(j))
  const prevRegularJobs = prevRange ? allRegularJobs.filter(j => inRange(j, prevRange) && byPeople(j)) : []
  const basicJobs = regularJobs.filter(j => getCleaningType(j) === 'basic')
  const deepJobs = regularJobs.filter(j => getCleaningType(j) === 'deep')
  const filteredJobs = cleaningFilter === 'basic' ? basicJobs : cleaningFilter === 'deep' ? deepJobs : regularJobs
  const prevFilteredJobs = prevRegularJobs.filter(j => cleaningFilter === 'all' || getCleaningType(j) === cleaningFilter)
  const periodSummary = summarize(filteredJobs)
  const prevSummary = prevRange ? summarize(prevFilteredJobs) : null
  const personRows = summarizeByPerson(filteredJobs, prevFilteredJobs)
  const dayTotals = {}
  for (const j of filteredJobs) {
    const d = (dayTotals[j.scheduled_date] ||= { n: 0, min: 0 })
    d.n++
    d.min += jobDurationMin(j) || 0
  }
  const listCompleted = filteredJobs.filter(j => j.status === 'completed').length
  const listPct = filteredJobs.length ? Math.round((listCompleted / filteredJobs.length) * 100) : 0

  return (
    <div>
      {showDaySchedule&&<DayScheduleView onClose={()=>setShowDaySchedule(false)} />}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <button className="btn btn-primary" onClick={()=>setShowDaySchedule(true)}>📅 {jt.daySchedule}</button>
      </div>
      <div className="tab-pills">
        <button className={`tab-pill${tab==='list'?' active':''}`} onClick={()=>setTab('list')}>{jt.allJobs}</button>
        <button className={`tab-pill${tab==='spot'?' active':''}`} onClick={()=>setTab('spot')}>
          ⚡ {jt.spotJobs} {spotJobs.filter(j=>j.spot_status==='pending').length > 0 && <span className="badge badge-amber" style={{marginLeft:4}}>{spotJobs.filter(j=>j.spot_status==='pending').length}</span>}
        </button>
        <button className={`tab-pill${tab==='new'?' active':''}`} onClick={()=>setTab('new')}>+ {jt.newJob}</button>
        <button className={`tab-pill${tab==='locations'?' active':''}`} onClick={()=>setTab('locations')}>📍 {jt.locations}</button>
      </div>

      {tab==='list' && (
        <div>
          {!searchId && (
            <JobsPeriodPanel
              period={period} setPeriod={setPeriod}
              custom={customRange} setCustom={setCustomRange}
              range={range} prevRange={prevRange}
              people={people} setPeople={setPeople} peopleOptions={peopleOptions}
              summary={periodSummary} prevSummary={prevSummary} byPerson={personRows}
            />
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {[
              { key: 'all', label: jt.filterAll, count: regularJobs.length, color: 'var(--navy)' },
              { key: 'basic', label: jt.filterBasic, count: basicJobs.length, color: CLEANING_TYPES.basic.color },
              { key: 'deep', label: jt.filterDeep, count: deepJobs.length, color: CLEANING_TYPES.deep.color },
            ].map(f => (
              <button key={f.key} type="button" onClick={() => setCleaningFilter(f.key)}
                style={{
                  padding: '10px 18px', borderRadius: 10, border: '2px solid',
                  borderColor: cleaningFilter === f.key ? f.color : 'var(--border)',
                  background: cleaningFilter === f.key ? `${f.color}18` : 'var(--surface)',
                  color: cleaningFilter === f.key ? f.color : 'var(--text2)',
                  fontWeight: 700, fontSize: 14, cursor: 'pointer',
                }}>
                {f.label} <span style={{ opacity: 0.85 }}>({f.count})</span>
              </button>
            ))}
          </div>

          {!loading && filteredJobs.length > 0 && (
            <div style={{
              marginBottom: 16, padding: '14px 16px', background: 'var(--surface)',
              borderRadius: 12, border: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{jt.checkingProgress}</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: listPct >= 100 ? '#4ade80' : '#60a5fa' }}>
                  {fill(jt.progressSummary, { done: listCompleted, total: filteredJobs.length, pct: listPct })}
                </div>
              </div>
              <ProgressBar pct={listPct} height={10} />
            </div>
          )}

          {loading && <div style={{color:'var(--text3)',fontSize:13}}>{t.app.loading}</div>}
          {filteredJobs.length === 0 && !loading && (
            <div className="card">
              <div style={{color:'var(--text3)',fontSize:13}}>
                {cleaningFilter === 'all' ? jt.noJobs : fill(jt.noJobsFilter, { type: cleaningFilter === 'deep' ? jt.deep : jt.simple })}
              </div>
            </div>
          )}
          {filteredJobs.map((j, idx) => {
            const ctype = getCleaningType(j)
            const ctypeCfg = CLEANING_TYPES[ctype]
            const locName = locationNameFromTitle(j.title)
            const dur = jobDurationMin(j)
            const startEnd = fmtStartEnd(j)
            const newDay = j.scheduled_date !== filteredJobs[idx - 1]?.scheduled_date
            const dayInfo = dayTotals[j.scheduled_date]
            return (
            <div key={j.id}>
            {newDay && j.scheduled_date && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, margin: '14px 2px 8px', fontSize: 13, color: 'var(--text2)' }}>
                <span style={{ fontWeight: 800, color: 'var(--text)' }}>
                  {new Date(j.scheduled_date + 'T12:00:00').toLocaleDateString(localeOf(lang), { weekday: 'short', day: 'numeric', month: 'short' })}
                </span>
                <span>{fill(jt.jobsWithJobs, { n: dayInfo.n })}{dayInfo.min > 0 && ` · ⏱ ${fmtMinutes(dayInfo.min)}`}</span>
              </div>
            )}
            <div className="card" style={{ marginBottom: 12, borderLeft: `4px solid ${ctypeCfg.color}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>{locName}</div>
                    <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: `${ctypeCfg.color}20`, color: ctypeCfg.color, border: `1px solid ${ctypeCfg.color}50` }}>
                      {ctype === 'deep' ? jt.filterDeep : jt.filterBasic}
                    </span>
                  </div>
                  {ctype === 'deep' && deepTaskList(j.title, lang) && (
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#b7791f', marginBottom: 4 }}>✨ {deepTaskList(j.title, lang)}</div>
                  )}
                  <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 6 }}>
                    👤 {j.employee_name || '—'} · 📅 {j.scheduled_date} · 🕐 {j.scheduled_time || '—'}
                  </div>
                  {(dur != null || startEnd) && (
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
                      ⏱ {dur != null ? fmtMinutes(dur) : st.in_progress || '…'}
                      {startEnd && <span style={{ fontWeight: 500, color: 'var(--text3)' }}> ({startEnd})</span>}
                    </div>
                  )}
                  {j.address && (
                    <div style={{ fontSize: 12, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {j.address.startsWith('http') ? `🗺 ${jt.maps}` : j.address}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                  {isMissedJob(j)
                    ? <span className="badge badge-red">{jt.incomplete}</span>
                    : <span className={`badge ${statusColor(j.status)}`}>{st[j.status] || j.status}</span>}
                  {isRetroJob(j) && <span className="badge badge-amber" title={jt.retroBadgeHint}>{jt.retroBadge}</span>}
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--green)' }}>¥{Number(j.value || j.spot_value || 0).toLocaleString()}</span>
                </div>
              </div>

              {j.description && (
                <div style={{ fontSize: 12, color: 'var(--text2)', background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px', marginBottom: 10, lineHeight: 1.5 }}>
                  🔑 {j.description.split('\n')[0]}
                </div>
              )}

              {j.status === 'completed' && (j.photo_start_url || j.photo_end_url) && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>{jt.servicePhotos}</div>
                  <JobPhotos
                    photoStartUrl={j.photo_start_url}
                    photoEndUrl={j.photo_end_url}
                    beforeLabel={jt.before}
                    afterLabel={jt.after}
                    variant="full"
                    onPhotoClick={setLightbox}
                  />
                  <JobVideos jobId={j.id} lazy style={{ marginTop: 8 }} />
                </div>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <label style={{ fontSize: 12, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {jt.type}:
                  <select
                    value={ctype}
                    onChange={e => handleCleaningTypeChange(j, e.target.value)}
                    style={{ fontSize: 13, fontWeight: 600, padding: '6px 10px', borderRadius: 8, border: `2px solid ${ctypeCfg.color}`, background: `${ctypeCfg.color}15`, color: ctypeCfg.color }}
                  >
                    <option value="basic">{jt.filterBasic}</option>
                    <option value="deep">{jt.filterDeep}</option>
                  </select>
                </label>
                {j.photo_required && <span className="badge badge-amber">📷 {jt.photoRequired}</span>}
                {j.gps_lat && <span className="badge badge-navy">📍 GPS</span>}
                {hasMapsLink(j.address, locName) && (
                  <a href={mapsOpenUrl(j.address, locName)} target="_blank" rel="noreferrer" className="btn btn-sm">🗺 {jt.maps}</a>
                )}
                {j.status === 'assigned' && <button className="btn btn-sm btn-danger" onClick={() => handleCancel(j.id)}>{jt.cancel}</button>}
              </div>
            </div>
            </div>
          )})}
        </div>
      )}

      {tab==='spot' && (
        <div>
          <div style={{fontSize:13,color:'var(--text2)',marginBottom:14}}>Spot jobs are extra services sent to employees. They must accept before starting.</div>
          {spotJobs.length===0 && <div className="card"><div style={{color:'var(--text3)',fontSize:13}}>No spot jobs yet.</div></div>}
          {spotJobs.map(j=>(
            <div key={j.id} className="card" style={{marginBottom:10,borderLeft:`3px solid ${j.spot_status==='accepted'?'var(--green)':j.spot_status==='declined'?'var(--red)':'#EF9F27'}`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'start',marginBottom:8}}>
                <div>
                  <div style={{fontWeight:600,fontSize:15}}>{j.title}</div>
                  <div style={{fontSize:12,color:'var(--text3)'}}>{j.employee_name} · {j.scheduled_date}</div>
                  <div style={{fontSize:12,color:'var(--text3)'}}>{j.address}</div>
                </div>
                <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
                  <span className={`badge ${spotStatusColor(j.spot_status)}`}>{j.spot_status}</span>
                  <span style={{fontSize:14,fontWeight:700,color:'var(--green)'}}>+¥{Number(j.spot_value||j.value||0).toLocaleString()}</span>
                </div>
              </div>
              {j.description && <div style={{fontSize:12,color:'var(--text2)',background:'var(--surface2)',borderRadius:6,padding:'7px 10px'}}>{j.description}</div>}
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:8}}>
                {(() => { const c = spotContracts.find(x => x.job_id === j.id); return c
                  ? <Link className="btn btn-sm" to={`/contracts?spot=${c.id}`}>📄 {c.contract_number} · {({ draft:'awaiting approval', approved:'approved ✓', rejected:'not approved', cancelled:'cancelled' })[contractStatus(c)]}</Link>
                  : <button className="btn btn-sm btn-primary" onClick={async()=>{ try { const { contract, invoiceError } = await generateContractForJob(j); toast.success(`📄 ${contract.contract_number}`); if (invoiceError) toast.error(invoiceError.message); loadAll() } catch (err) { toast.error(err.message) } }}>📄 Generate contract</button> })()}
                <a className="btn btn-sm" href={googleCalendarUrl(j)} target="_blank" rel="noreferrer">📅 Google Calendar</a>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab==='new' && (
        <NewJobForm
          jobs={jobs} employees={employees} clients={clients} locations={locations} sellers={sellers}
          onCreated={({ another }) => { loadAll(); if (!another) setTab('list') }}
        />
      )}

      {tab==='locations' && <LocationsTab />}

      <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} closeLabel={t.reports?.close || 'Close'} />
    </div>
  )
}

function LocationsTab() {
  const { t } = useLang()
  const jt = t.jobs
  const [locations, setLocations] = useState([])
  const [showDaySchedule, setShowDaySchedule] = useState(false)
  const [editingLoc, setEditingLoc] = useState(null)
  const [form, setForm] = useState({ name:'', address:'', location_type:'fixed', notes:'' })
  const [geocoding, setGeocoding] = useState(false)
  const [gps, setGps] = useState(null)

  useEffect(() => { load() }, [])

  const load = async () => {
    const { data } = await supabase.from('locations').select('*').order('name')
    setLocations(data || [])
  }

  const upd = (k,v) => setForm(f=>({...f,[k]:v}))

  const handleGeocode = async () => {
    if (!form.address) return toast.error(jt.enterAddressFirst)
    setGeocoding(true)
    const result = await geocodeAddress(form.address)
    setGeocoding(false)
    if (!applyGeocodeResult(result, setGps, jt.mapsValid)) {
      toast.error(t.jobs.addressNotFound)
    }
  }

  const handleSave = async () => {
    if (!form.name || !form.address) return toast.error('Name and address required')
    const { error } = await supabase.from('locations').insert({ ...form, gps_lat: gps?.lat, gps_lng: gps?.lng })
    if (error) return toast.error(error.message)
    toast.success('Location saved!')
    setForm({ name:'', address:'', location_type:'fixed', notes:'' }); setGps(null); load()
  }

  const handleEditLoc = (l) => {
    setEditingLoc(l.id)
    setForm({ name:l.name||'', address:l.address||'', location_type:l.location_type||'fixed', notes:l.notes||'' })
    setGps(l.gps_lat&&l.gps_lng?{lat:l.gps_lat,lng:l.gps_lng}:null)
  }

  const handleUpdateLoc = async () => {
    if (!form.name) return toast.error('Name required')
    await supabase.from('locations').update({ name:form.name, address:form.address, location_type:form.location_type, notes:form.notes, gps_lat:gps?.lat||null, gps_lng:gps?.lng||null }).eq('id', editingLoc)
    toast.success('Location updated!')
    setEditingLoc(null)
    setForm({ name:'', address:'', location_type:'fixed', notes:'' }); setGps(null); load()
  }

  const handleDelete = async (id) => {
    await supabase.from('locations').update({ is_active: false }).eq('id', id)
    load()
  }

  return (
    <div>
      {showDaySchedule&&<DayScheduleView onClose={()=>setShowDaySchedule(false)} />}
      <div className="card" style={{marginBottom:14}}>
        <div className="card-title">{editingLoc ? 'Edit Location' : 'Save New Location'}</div>
        <div className="grid-2">
          <div className="form-group"><label>Name</label><input value={form.name} onChange={e=>upd('name',e.target.value)} placeholder="Hotel Grand" /></div>
          <div className="form-group"><label>Type</label>
            <select value={form.location_type} onChange={e=>upd('location_type',e.target.value)}>
              <option value="fixed">Fixed (recurring)</option>
              <option value="spot">Spot (one-time)</option>
            </select>
          </div>
        </div>
        <div className="form-group">
          <label>{t.jobs.addressLabel}</label>
          <div style={{display:'flex',gap:8}}>
            <input value={form.address} onChange={e=>upd('address',e.target.value)} placeholder={t.jobs.addressPlaceholder} style={{flex:1}} />
            <button className="btn" onClick={handleGeocode} disabled={geocoding}>{geocoding?'...':'📍 GPS'}</button>
          </div>
          {gps && <div style={{fontSize:11,color:'var(--green)',marginTop:4}}>✓ {gps.lat.toFixed(4)}, {gps.lng.toFixed(4)}</div>}
          {!gps && isNavigableAddress(form.address) && <div style={{fontSize:11,color:'var(--green)',marginTop:4}}>✓ {jt.mapsValid}</div>}
        </div>
        <div className="form-group"><label>{jt.keyboxNotes}</label><input value={form.notes} onChange={e=>upd('notes',e.target.value)} placeholder="Key box: 0315" /></div>
        <button className="btn btn-primary" onClick={editingLoc ? handleUpdateLoc : handleSave}>{editingLoc ? jt.updateLocation : jt.saveLocation}</button>
        {editingLoc && <button className="btn" style={{ marginLeft: 8 }} onClick={() => { setEditingLoc(null); setForm({ name:'', address:'', location_type:'fixed', notes:'' }); setGps(null) }}>{jt.cancelEdit}</button>}
      </div>

      <div className="card">
        <div className="card-title">{jt.savedLocations}</div>
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Address</th><th>Key box</th><th>GPS</th><th></th></tr></thead>
          <tbody>
            {locations.filter(l=>l.is_active).map(l=>(
              <tr key={l.id}>
                <td style={{fontWeight:500}}>{l.name}</td>
                <td><span className={`badge ${l.location_type==='fixed'?'badge-green':'badge-amber'}`}>{l.location_type}</span></td>
                <td style={{fontSize:12,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.address}</td>
                <td style={{fontSize:12}}>{l.notes || '—'}</td>
                <td>{l.gps_lat ? <span className="badge badge-navy">✓</span> : hasMapsLink(l.address, l.name) ? <span className="badge badge-green">🗺</span> : '—'}</td>
                <td style={{display:'flex',gap:4}}>
                  <button className="btn btn-sm btn-primary" onClick={()=>handleEditLoc(l)}>✏️</button>
                  <button className="btn btn-sm btn-danger" onClick={()=>handleDelete(l.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
