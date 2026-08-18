import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { geocodeAddress, isNavigableAddress } from '../lib/geocode'
import {
  getCleaningType, locationNameFromTitle, applyCleaningTypeToTitle, cleaningTypesForLang,
} from '../lib/cleaningType'
import { useLang, fill } from '../hooks/useLang'
import toast from 'react-hot-toast'

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
  const { lang, t } = useLang()
  const jt = t.jobs
  const st = t.status
  const CLEANING_TYPES = cleaningTypesForLang(lang)
  const dateLocale = lang === 'ja' ? 'ja-JP' : 'en-GB'
  const [date, setDate] = useState(toDateStr(new Date()))
  const [calMonth, setCalMonth] = useState(() => toDateStr(new Date()).slice(0, 7))
  const [showCalendar, setShowCalendar] = useState(false)
  const [jobs, setJobs] = useState([])
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
  const weekDays = lang === 'ja'
    ? ['月', '火', '水', '木', '金', '土', '日']
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const monthLabel = new Date(calMonth + '-01T12:00:00').toLocaleDateString(dateLocale, { month: 'long', year: 'numeric' })
  const todayStr = toDateStr(new Date())

  const handleReassign = async (jobId, empId) => {
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
            <div style={{ fontSize: 13, color: ctypeCfg.color, fontWeight: 600, marginTop: 2 }}>{ctypeCfg.label}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', background: 'var(--surface2)', padding: '4px 10px', borderRadius: 8 }}>
                🕐 {j.scheduled_time || '00:30'}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: stl.text, background: stl.bg, padding: '4px 10px', borderRadius: 8 }}>
                {stl.label}
              </span>
              {j.value > 0 && <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>¥{Number(j.value).toLocaleString()}</span>}
            </div>
            {j.description && (
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8, background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px', lineHeight: 1.5 }}>
                🔑 {j.description.split('\n')[0]}
              </div>
            )}
            {j.address?.startsWith('http') && (
              <a href={j.address} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 8, fontSize: 12, color: '#60a5fa', textDecoration: 'none', fontWeight: 600 }}>
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
  const { lang, t } = useLang()
  const jt = t.jobs
  const st = t.status
  const CLEANING_TYPES = cleaningTypesForLang(lang)
  const [tab, setTab] = useState('list')
  const [cleaningFilter, setCleaningFilter] = useState('all')
  const [jobs, setJobs] = useState([])
  const [employees, setEmployees] = useState([])
  const [clients, setClients] = useState([])
  const [locations, setLocations] = useState([])
  const [showDaySchedule, setShowDaySchedule] = useState(false)
  const [editingLoc, setEditingLoc] = useState(null)
  const [loading, setLoading] = useState(true)
  const [geocoding, setGeocoding] = useState(false)
  const [form, setForm] = useState({
    title:'', client_id:'', client_name:'', employee_id:'', employee_name:'',
    scheduled_date:'', scheduled_time:'', address:'', gps_lat:'', gps_lng:'',
    value:0, description:'', checklist_template:'', photo_required:false,
    location_id:'', job_category:'regular', spot_value:0, cleaning_type:'basic'
  })

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    setLoading(true)
    const [j, e, c, l] = await Promise.all([
      supabase.from('jobs').select('*').order('scheduled_date', { ascending: false }),
      supabase.from('employees').select('id,full_name,salary_type,hourly_rate,fixed_salary').eq('is_active', true),
      supabase.from('clients').select('id,company_name').eq('is_active', true),
      supabase.from('locations').select('*').eq('is_active', true).order('name'),
    ])
    setJobs(j.data || [])
    setEmployees(e.data || [])
    setClients(c.data || [])
    setLocations(l.data || [])
    setLoading(false)
  }

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleLocationSelect = (locId) => {
    const loc = locations.find(l => l.id === locId)
    if (!loc) return
    setForm(f => ({
      ...f,
      location_id: locId,
      address: loc.address,
      gps_lat: loc.gps_lat || '',
      gps_lng: loc.gps_lng || '',
      title: f.title || loc.name,
      description: loc.notes || f.description,
    }))
  }

  const handleGeocode = async () => {
    if (!form.address) return toast.error('Enter address first')
    setGeocoding(true)
    const result = await geocodeAddress(form.address)
    setGeocoding(false)
    if (!applyGeocodeResult(result, coords => setForm(f => ({ ...f, gps_lat: coords.lat, gps_lng: coords.lng })), jt.mapsValid)) {
      toast.error('Endereço não encontrado — use link do Google Maps ou endereço completo')
    }
  }

  const handleCreate = async () => {
    if (!form.title || !form.employee_id || !form.scheduled_date || !form.address) return toast.error('Fill required fields')
    const emp = employees.find(e => e.id === form.employee_id)
    const cli = clients.find(c => c.id === form.client_id)
    const isSpot = form.job_category === 'spot'
    const jobTitle = form.title.includes(' — ')
      ? form.title
      : applyCleaningTypeToTitle(form.title, form.cleaning_type)
    const { error } = await supabase.from('jobs').insert({
      title: jobTitle,
      client_id: form.client_id || null,
      client_name: cli?.company_name || '',
      employee_id: form.employee_id,
      employee_name: emp?.full_name || '',
      scheduled_date: form.scheduled_date,
      scheduled_time: form.scheduled_time,
      address: form.address,
      gps_lat: form.gps_lat || null,
      gps_lng: form.gps_lng || null,
      value: parseFloat(form.value) || 0,
      spot_value: parseFloat(form.spot_value) || 0,
      description: form.description,
      checklist_template: form.checklist_template,
      photo_required: form.photo_required,
      job_category: form.job_category,
      status: 'assigned',
      spot_status: isSpot ? 'pending' : null,
    })
    if (error) return toast.error(error.message)
    toast.success(isSpot ? 'Spot job sent! Waiting for employee response.' : 'Job created!')
    setForm({ title:'', client_id:'', client_name:'', employee_id:'', employee_name:'', scheduled_date:'', scheduled_time:'', address:'', gps_lat:'', gps_lng:'', value:0, description:'', checklist_template:'', photo_required:false, location_id:'', job_category:'regular', spot_value:0, cleaning_type:'basic' })
    loadAll()
    setTab('list')
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

  const spotJobs = jobs.filter(j => j.job_category === 'spot')
  const regularJobs = jobs.filter(j => j.job_category !== 'spot')
  const basicJobs = regularJobs.filter(j => getCleaningType(j) === 'basic')
  const deepJobs = regularJobs.filter(j => getCleaningType(j) === 'deep')
  const filteredJobs = cleaningFilter === 'basic' ? basicJobs : cleaningFilter === 'deep' ? deepJobs : regularJobs
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
          {filteredJobs.map(j => {
            const ctype = getCleaningType(j)
            const ctypeCfg = CLEANING_TYPES[ctype]
            const locName = locationNameFromTitle(j.title)
            return (
            <div key={j.id} className="card" style={{ marginBottom: 12, borderLeft: `4px solid ${ctypeCfg.color}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>{locName}</div>
                    <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: `${ctypeCfg.color}20`, color: ctypeCfg.color, border: `1px solid ${ctypeCfg.color}50` }}>
                      {ctype === 'deep' ? jt.filterDeep : jt.filterBasic}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 6 }}>
                    👤 {j.employee_name || '—'} · 📅 {j.scheduled_date} · 🕐 {j.scheduled_time || '—'}
                  </div>
                  {j.address && (
                    <div style={{ fontSize: 12, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {j.address.startsWith('http') ? `🗺 ${jt.maps}` : j.address}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                  <span className={`badge ${statusColor(j.status)}`}>{st[j.status] || j.status}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--green)' }}>¥{Number(j.value || j.spot_value || 0).toLocaleString()}</span>
                </div>
              </div>

              {j.description && (
                <div style={{ fontSize: 12, color: 'var(--text2)', background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px', marginBottom: 10, lineHeight: 1.5 }}>
                  🔑 {j.description.split('\n')[0]}
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
                {j.address?.startsWith('http') && (
                  <a href={j.address} target="_blank" rel="noreferrer" className="btn btn-sm">🗺 {jt.maps}</a>
                )}
                {j.status === 'assigned' && <button className="btn btn-sm btn-danger" onClick={() => handleCancel(j.id)}>{jt.cancel}</button>}
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
            </div>
          ))}
        </div>
      )}

      {tab==='new' && (
        <div className="card">
          <div className="card-title">New Job</div>

          {/* Job type toggle */}
          <div style={{display:'flex',gap:8,marginBottom:16}}>
            <button type="button" onClick={()=>upd('job_category','regular')} style={{flex:1,padding:'10px',borderRadius:8,border:'2px solid',borderColor:form.job_category==='regular'?'var(--navy)':'var(--border)',background:form.job_category==='regular'?'var(--navy)':'none',color:form.job_category==='regular'?'#fff':'var(--text2)',fontWeight:600,cursor:'pointer',fontSize:13}}>
              📋 Regular Job
            </button>
            <button type="button" onClick={()=>upd('job_category','spot')} style={{flex:1,padding:'10px',borderRadius:8,border:'2px solid',borderColor:form.job_category==='spot'?'#EF9F27':'var(--border)',background:form.job_category==='spot'?'#FAEEDA':'none',color:form.job_category==='spot'?'#854F0B':'var(--text2)',fontWeight:600,cursor:'pointer',fontSize:13}}>
              ⚡ Spot Job (employee must accept)
            </button>
          </div>

          <div className="form-group">
            <label>Tipo de limpeza</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {Object.entries(CLEANING_TYPES).map(([key, cfg]) => (
                <button key={key} type="button" onClick={() => upd('cleaning_type', key)}
                  style={{ flex: 1, padding: '10px', borderRadius: 8, border: '2px solid', borderColor: form.cleaning_type === key ? cfg.color : 'var(--border)', background: form.cleaning_type === key ? `${cfg.color}18` : 'transparent', color: form.cleaning_type === key ? cfg.color : 'var(--text2)', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
                  {key === 'basic' ? '🧹' : '✨'} {cfg.short}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Use saved location</label>
            <select value={form.location_id} onChange={e=>handleLocationSelect(e.target.value)}>
              <option value="">— Select saved location —</option>
              {locations.map(l=><option key={l.id} value={l.id}>{l.name} ({l.location_type})</option>)}
            </select>
          </div>

          <div className="grid-2">
            <div className="form-group"><label>Job Title *</label><input value={form.title} onChange={e=>upd('title',e.target.value)} placeholder="Hotel cleaning" /></div>
            <div className="form-group"><label>Assign to *</label>
              <select value={form.employee_id} onChange={e=>upd('employee_id',e.target.value)}>
                <option value="">Select employee...</option>
                {employees.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Client</label>
              <select value={form.client_id} onChange={e=>upd('client_id',e.target.value)}>
                <option value="">Select client...</option>
                {clients.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>{form.job_category==='spot' ? '⚡ Spot Value (¥) — added to salary' : 'Job Value (¥)'}</label>
              <input type="number" value={form.job_category==='spot'?form.spot_value:form.value} onChange={e=>form.job_category==='spot'?upd('spot_value',e.target.value):upd('value',e.target.value)} />
            </div>
            <div className="form-group"><label>Date *</label><input type="date" value={form.scheduled_date} onChange={e=>upd('scheduled_date',e.target.value)} /></div>
            <div className="form-group"><label>Time</label><input type="time" value={form.scheduled_time} onChange={e=>upd('scheduled_time',e.target.value)} /></div>
          </div>

          <div className="form-group">
            <label>Address *</label>
            <div style={{display:'flex',gap:8}}>
              <input value={form.address} onChange={e=>upd('address',e.target.value)} placeholder="東京都新宿区..." style={{flex:1}} />
              <button className="btn" onClick={handleGeocode} disabled={geocoding} style={{whiteSpace:'nowrap'}}>{geocoding?'...':'📍 Get GPS'}</button>
            </div>
            {form.gps_lat && <div style={{fontSize:11,color:'var(--green)',marginTop:4}}>✓ GPS: {Number(form.gps_lat).toFixed(4)}, {Number(form.gps_lng).toFixed(4)}</div>}
            {!form.gps_lat && isNavigableAddress(form.address) && <div style={{fontSize:11,color:'var(--green)',marginTop:4}}>✓ Link do Maps válido</div>}
          </div>

          <div className="form-group"><label>Description / Instructions</label><textarea value={form.description} onChange={e=>upd('description',e.target.value)} placeholder="Clean all rooms..." /></div>
          <div className="form-group"><label>Checklist (one item per line)</label><textarea value={form.checklist_template} onChange={e=>upd('checklist_template',e.target.value)} placeholder="Clean floors&#10;Wipe windows&#10;Empty trash" /></div>

          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
            <input type="checkbox" id="photo_req" checked={form.photo_required} onChange={e=>upd('photo_required',e.target.checked)} style={{width:16,height:16,cursor:'pointer'}} />
            <label htmlFor="photo_req" style={{cursor:'pointer',fontSize:13}}>📷 Photo required to complete this job</label>
          </div>

          {form.job_category==='spot' && (
            <div style={{background:'#FAEEDA',border:'1px solid #EF9F27',borderRadius:8,padding:'10px 14px',marginBottom:14,fontSize:13,color:'#854F0B'}}>
              ⚡ This spot job will appear in the employee's app. They must accept it before it becomes active. Value <strong>¥{Number(form.spot_value||0).toLocaleString()}</strong> will be added to their salary automatically when completed.
            </div>
          )}

          <button className="btn btn-primary" onClick={handleCreate}>
            {form.job_category==='spot' ? '⚡ Send Spot Job' : '✅ Create Job'}
          </button>
        </div>
      )}

      {tab==='locations' && <LocationsTab />}
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
    if (!form.address) return toast.error('Enter address first')
    setGeocoding(true)
    const result = await geocodeAddress(form.address)
    setGeocoding(false)
    if (!applyGeocodeResult(result, setGps, jt.mapsValid)) {
      toast.error('Endereço não encontrado — use link do Google Maps ou endereço completo')
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
          <label>Endereço / Link Google Maps</label>
          <div style={{display:'flex',gap:8}}>
            <input value={form.address} onChange={e=>upd('address',e.target.value)} placeholder="https://maps.app.goo.gl/... ou endereço" style={{flex:1}} />
            <button className="btn" onClick={handleGeocode} disabled={geocoding}>{geocoding?'...':'📍 GPS'}</button>
          </div>
          {gps && <div style={{fontSize:11,color:'var(--green)',marginTop:4}}>✓ {gps.lat.toFixed(4)}, {gps.lng.toFixed(4)}</div>}
          {!gps && isNavigableAddress(form.address) && <div style={{fontSize:11,color:'var(--green)',marginTop:4}}>✓ Link do Maps válido</div>}
        </div>
        <div className="form-group"><label>Key box / Notas</label><input value={form.notes} onChange={e=>upd('notes',e.target.value)} placeholder="Key box: 0315" /></div>
        <button className="btn btn-primary" onClick={editingLoc ? handleUpdateLoc : handleSave}>{editingLoc ? 'Update Location' : 'Save Location'}</button>
        {editingLoc && <button className="btn" style={{ marginLeft: 8 }} onClick={() => { setEditingLoc(null); setForm({ name:'', address:'', location_type:'fixed', notes:'' }); setGps(null) }}>Cancel Edit</button>}
      </div>

      <div className="card">
        <div className="card-title">Saved Locations</div>
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>Address</th><th>Key box</th><th>GPS</th><th></th></tr></thead>
          <tbody>
            {locations.filter(l=>l.is_active).map(l=>(
              <tr key={l.id}>
                <td style={{fontWeight:500}}>{l.name}</td>
                <td><span className={`badge ${l.location_type==='fixed'?'badge-green':'badge-amber'}`}>{l.location_type}</span></td>
                <td style={{fontSize:12,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.address}</td>
                <td style={{fontSize:12}}>{l.notes || '—'}</td>
                <td>{l.gps_lat ? <span className="badge badge-navy">✓</span> : isNavigableAddress(l.address) ? <span className="badge badge-green">🗺</span> : '—'}</td>
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
