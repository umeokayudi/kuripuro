import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { hasMapsLink, mapsOpenUrl } from '../lib/mapsLink'
import { apiFetch } from '../lib/apiFetch'
import JobPhotos from '../components/JobPhotos'
import PhotoLightbox from '../components/PhotoLightbox'
import toast from 'react-hot-toast'
import { useLang, fill } from '../hooks/useLang'

const TZ = 'Asia/Tokyo'
const LATE_AFTER_MIN = 5
const LOCATION_FRESH_MIN = 15

// "Now" as a Date whose local fields are Tokyo wall-clock time.
const tokyoNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: TZ }))
const tokyoToday = () => new Date().toLocaleString('sv-SE', { timeZone: TZ }).split(' ')[0]
const hhmm = (iso) => iso ? new Date(iso).toLocaleTimeString('ja-JP', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : ''
const shortTime = (t) => (t || '').slice(0, 5)
const toMin = (t) => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + (m || 0) }

// Minutes from now until the job's scheduled time today (negative = already passed).
const minutesUntil = (scheduledTime, now) => {
  if (!scheduledTime) return null
  const [h, m] = scheduledTime.split(':').map(Number)
  const target = new Date(now); target.setHours(h, m || 0, 0, 0)
  return Math.round((target - now) / 60000)
}

const jobPlace = (j) => j.client_name || (j.title || '').replace(/ — .*/, '')
const jobKind = (j) => {
  const title = (j.title || '').replace(/ — .*/, '')
  return title && title !== jobPlace(j) ? title : ''
}
const byTime = (a, b) => (a.scheduled_time || '99:99').localeCompare(b.scheduled_time || '99:99') || (a.sequence_order || 99) - (b.sequence_order || 99)

// One status per person, in the order the admin needs to act on it.
const GROUPS = ['attention', 'working', 'upcoming', 'done', 'free']

function classify(emp, jobs, offToday, now, today) {
  const mine = jobs.filter(j => j.employee_id === emp.id)
  const todayJobs = mine.filter(j => j.scheduled_date === today && j.status !== 'cancelled').sort(byTime)
  const active = mine.find(j => j.status === 'in_progress')
  const pending = todayJobs.filter(j => j.status === 'assigned')
  const next = pending[0] || null
  const done = todayJobs.filter(j => j.status === 'completed')
  const staleOpen = active && active.scheduled_date < today ? active : null
  const nextIn = next ? minutesUntil(next.scheduled_time, now) : null
  const lateMin = !active && nextIn != null && nextIn <= -LATE_AFTER_MIN ? -nextIn : 0

  let group
  if (lateMin || staleOpen) group = 'attention'
  else if (active) group = 'working'
  else if (next) group = 'upcoming'
  else if (done.length) group = 'done'
  else group = 'free'

  return { emp, group, todayJobs, active, next, nextIn, done, lateMin, staleOpen, off: offToday.has(emp.id) }
}

export const fmtDuration = (min, L) => {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return fill(L.dMin, { m })
  const h = Math.floor(m / 60), r = m % 60
  return r ? fill(L.dHourMin, { h, m: r }) : fill(L.dHour, { h })
}

export default function LiveTracking() {
  const { t, lang } = useLang()
  const L = t.live
  const [employees, setEmployees] = useState([])
  const [jobs, setJobs] = useState([])
  const [offToday, setOffToday] = useState(new Set())
  const [open, setOpen] = useState(null)
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [showFree, setShowFree] = useState(false)
  const [photoInfo, setPhotoInfo] = useState(null)
  const [cleaning, setCleaning] = useState(false)
  const [retros, setRetros] = useState([])
  const [lightbox, setLightbox] = useState(null)

  const checkPhotos = async () => {
    try {
      const r = await apiFetch('/api/cleanup-photos')
      if (!r.ok) throw new Error('HTTP ' + r.status)
      setPhotoInfo(await r.json())
    } catch(e) { setPhotoInfo({ error: e.message }) }
  }

  const cleanPhotos = async () => {
    if (!window.confirm(L.cleanConfirm)) return
    setCleaning(true)
    try {
      const r = await apiFetch('/api/cleanup-photos', { method: 'POST' })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const res = await r.json()
      if (res.error) throw new Error(res.error)
      toast.success(fill(L.cleaned, { n: res.filesDeleted || 0 }))
      setPhotoInfo(res)
    } catch(e) { toast.error('Erro: '+e.message) }
    setCleaning(false)
  }

  const loadRetros = async () => {
    const { data } = await supabase.from('jobs')
      .select('id,title,scheduled_date,employee_name,retro_report,retro_ai_summary,retro_value,value,checklist_done,checklist_total,admin_reviewed,photo_start_url,photo_end_url')
      .not('retro_report','is',null).eq('admin_reviewed',false)
      .order('scheduled_date',{ascending:false}).limit(20)
    setRetros(data||[])
  }

  const approveRetro = async (id) => {
    const { error } = await supabase.from('jobs').update({ admin_reviewed: true }).eq('id', id)
    if (error) return toast.error(error.message)
    toast.success(L.reviewedToast)
    loadRetros()
  }

  const load = useCallback(async () => {
    loadRetros()
    const today = tokyoToday()
    const [e, activeRes, todayRes, offRes] = await Promise.all([
      supabase.from('employees').select('id,full_name,phone,is_active,last_lat,last_lng,last_location_at,location_sharing').eq('is_active',true).order('full_name'),
      supabase.from('jobs').select('*').eq('status','in_progress'),
      supabase.from('jobs').select('*').eq('scheduled_date', today).in('status',['assigned','in_progress','completed']),
      supabase.from('employee_availability').select('employee_id,kind,status').eq('date', today).eq('kind','off'),
    ])
    setEmployees(e.data||[])
    const byId = new Map()
    for (const j of [...(activeRes.data||[]), ...(todayRes.data||[])]) byId.set(j.id, j)
    setJobs([...byId.values()])
    setOffToday(new Set((offRes.data||[]).filter(r => r.status !== 'rejected').map(r => r.employee_id)))
    setUpdatedAt(new Date())
    setLoading(false)
  }, [])

  useEffect(() => { load(); const iv = setInterval(load, 30000); return ()=>clearInterval(iv) }, [load])

  const now = tokyoNow()
  const today = tokyoToday()
  const people = employees.map(emp => classify(emp, jobs, offToday, now, today))
  const grouped = Object.fromEntries(GROUPS.map(g => [g, people.filter(p => p.group === g)]))
  grouped.attention.sort((a, b) => b.lateMin - a.lateMin)
  grouped.upcoming.sort((a, b) => (a.nextIn ?? 9999) - (b.nextIn ?? 9999))
  grouped.working.sort((a, b) => new Date(a.active.started_at || 0) - new Date(b.active.started_at || 0))

  const dateLabel = new Date().toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-US', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })
  const tiles = [
    { g: 'attention', n: grouped.attention.length, label: L.tileLate, tone: 'red' },
    { g: 'working', n: grouped.working.length, label: L.tileWorking, tone: 'green' },
    { g: 'upcoming', n: grouped.upcoming.length, label: L.tileUpcoming, tone: 'blue' },
    { g: 'done', n: grouped.done.length, label: L.tileDone, tone: 'gray' },
  ]

  const statusLine = (p) => {
    const { active, next, nextIn, lateMin, staleOpen, done, todayJobs } = p
    if (staleOpen) return { main: fill(L.staleOpen, { place: jobPlace(staleOpen), date: staleOpen.scheduled_date }), sub: L.staleOpenHint }
    if (lateMin) return {
      main: fill(L.lateMain, { d: fmtDuration(lateMin, L) }),
      sub: fill(L.lateSub, { place: jobPlace(next), time: shortTime(next.scheduled_time) }),
    }
    if (active) {
      const since = active.started_at ? (Date.now() - new Date(active.started_at)) / 60000 : null
      const startedLate = active.started_at && active.scheduled_time && active.scheduled_date === today
        ? toMin(hhmm(active.started_at)) - toMin(active.scheduled_time)
        : 0
      return {
        main: active.started_at
          ? fill(L.workingMain, { place: jobPlace(active), time: hhmm(active.started_at), d: fmtDuration(since, L) })
          : fill(L.workingNoTime, { place: jobPlace(active) }),
        sub: [
          startedLate >= 10 ? fill(L.startedLate, { d: fmtDuration(startedLate, L) }) : '',
          next ? fill(L.thenNext, { place: jobPlace(next), time: next.scheduled_time ? shortTime(next.scheduled_time) : '—' }) : '',
        ].filter(Boolean).join(' · '),
      }
    }
    if (next) return {
      main: next.scheduled_time
        ? fill(nextIn > 0 ? L.nextMain : L.nextNow, { place: jobPlace(next), time: shortTime(next.scheduled_time), d: fmtDuration(nextIn, L) })
        : fill(L.nextNoTime, { place: jobPlace(next) }),
      sub: done.length ? fill(L.doneSoFar, { done: done.length, total: todayJobs.length }) : '',
    }
    if (done.length) {
      const last = done.map(j => j.completed_at).filter(Boolean).sort().pop()
      return { main: fill(last ? L.doneMain : L.doneMainNoTime, { n: done.length, time: hhmm(last) }), sub: '' }
    }
    return { main: p.off ? L.dayOff : L.noJobs, sub: '' }
  }

  const personCard = (p) => {
    const { emp, group, todayJobs, active, next } = p
    const s = statusLine(p)
    const locAgeMin = emp.last_location_at ? (Date.now() - new Date(emp.last_location_at)) / 60000 : null
    const showLoc = emp.location_sharing !== false && emp.last_lat && locAgeMin != null && locAgeMin < LOCATION_FRESH_MIN
    const focusJob = p.staleOpen || active || next
    const isOpen = open === emp.id
    return (
      <div key={emp.id} className={`lt-card is-${group}`}>
        <button type="button" className="lt-card-head" onClick={() => setOpen(isOpen ? null : emp.id)} aria-expanded={isOpen}>
          <span className="lt-avatar">{(emp.full_name || '?').trim().charAt(0)}</span>
          <span className="lt-who">
            <span className="lt-name">{emp.full_name}</span>
            <span className="lt-main">{s.main}</span>
            {s.sub && <span className="lt-sub">{s.sub}</span>}
          </span>
          {todayJobs.length > 0 && (
            <span className="lt-dots" title={fill(L.doneSoFar, { done: p.done.length, total: todayJobs.length })}>
              {todayJobs.map(j => <i key={j.id} className={`is-${j.status}`} />)}
            </span>
          )}
        </button>
        <div className="lt-actions">
          {focusJob && hasMapsLink(focusJob.address, focusJob.title) && <a className="lt-act" href={mapsOpenUrl(focusJob.address, focusJob.title)} target="_blank" rel="noreferrer">🗺 {L.jobAddress}</a>}
          {showLoc && <a className="lt-act" href={`https://www.google.com/maps?q=${emp.last_lat},${emp.last_lng}`} target="_blank" rel="noreferrer">📍 {fill(L.whereNow, { d: fmtDuration(locAgeMin, L) })}</a>}
          {emp.phone && <a className="lt-act" href={`tel:${emp.phone.replace(/[^\d+]/g, '')}`}>📞 {L.call}</a>}
          {todayJobs.length > 0 && <button type="button" className="lt-act lt-act-ghost" onClick={() => setOpen(isOpen ? null : emp.id)}>{isOpen ? L.hideDay : fill(L.showDay, { n: todayJobs.length })}</button>}
        </div>
        {isOpen && todayJobs.length > 0 && (
          <ol className="lt-timeline">
            {todayJobs.map(j => (
              <li key={j.id} className={`is-${j.status}`}>
                <span className="lt-tl-time">{j.scheduled_time ? shortTime(j.scheduled_time) : '—'}</span>
                <span className="lt-tl-body">
                  <b>{jobPlace(j)}</b>{jobKind(j) && <span className="lt-tl-kind"> · {jobKind(j)}</span>}
                  <span className="lt-tl-meta">
                    {j.status === 'completed' ? fill(L.tlDone, { start: hhmm(j.started_at) || '—', end: hhmm(j.completed_at) || '—' }) + (j.started_at && j.completed_at ? ` (${fmtDuration((new Date(j.completed_at) - new Date(j.started_at)) / 60000, L)})` : '')
                      : j.status === 'in_progress' ? fill(L.tlWorking, { start: hhmm(j.started_at) || '—' })
                      : L.tlNotStarted}
                  </span>
                </span>
                {j.status === 'completed' && (j.photo_start_url || j.photo_end_url) && (
                  <JobPhotos photoStartUrl={j.photo_start_url} photoEndUrl={j.photo_end_url} beforeLabel={L.before} afterLabel={L.after} size={36} onPhotoClick={setLightbox} />
                )}
                {hasMapsLink(j.address, j.title) && <a className="lt-tl-map" href={mapsOpenUrl(j.address, j.title)} target="_blank" rel="noreferrer" aria-label={L.jobAddress}>🗺</a>}
              </li>
            ))}
          </ol>
        )}
      </div>
    )
  }

  const groupTitle = { attention: L.gAttention, working: L.gWorking, upcoming: L.gUpcoming, done: L.gDone }

  return (
    <div className="lt-page">
      <div className="lt-head">
        <div>
          <h2>{L.title}</h2>
          <div className="lt-date">{dateLabel}</div>
        </div>
        <button type="button" className="btn btn-sm" onClick={load}>↻ {updatedAt ? fill(L.updated, { time: updatedAt.toLocaleTimeString('ja-JP', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) }) : L.refresh}</button>
      </div>

      <div className="lt-tiles">
        {tiles.map(tile => (
          <a key={tile.g} href={`#lt-${tile.g}`} className={`lt-tile is-${tile.tone}${tile.n ? '' : ' is-zero'}`}
            onClick={e => { e.preventDefault(); document.getElementById(`lt-${tile.g}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>
            <b>{tile.n}</b><span>{tile.label}</span>
          </a>
        ))}
      </div>

      {loading && <div className="lt-empty">{L.loading}</div>}

      {!loading && people.length > 0 && grouped.attention.length === 0 && (grouped.working.length + grouped.upcoming.length) > 0 && (
        <div className="lt-allgood">✓ {L.allGood}</div>
      )}

      {['attention', 'working', 'upcoming', 'done'].map(g => grouped[g].length > 0 && (
        <section key={g} id={`lt-${g}`} className={`lt-group is-${g}`}>
          <h3>{groupTitle[g]} <span>{grouped[g].length}</span></h3>
          <div className="lt-list">
            {grouped[g].map(p => personCard(p))}
          </div>
        </section>
      ))}

      {grouped.free.length > 0 && (
        <section className="lt-group is-free">
          <button type="button" className="lt-free-toggle" onClick={() => setShowFree(v => !v)} aria-expanded={showFree}>
            {fill(L.gFree, { n: grouped.free.length })} <span>{showFree ? '▲' : '▼'}</span>
          </button>
          {showFree ? (
            <div className="lt-list">{grouped.free.map(p => personCard(p))}</div>
          ) : (
            <div className="lt-free-names">{grouped.free.map(p => p.emp.full_name + (p.off ? ` (${L.offShort})` : '')).join(' · ')}</div>
          )}
        </section>
      )}

      {!loading && people.length === 0 && <div className="lt-empty">{L.noEmployees}</div>}

      {retros.length>0&&(
        <section className="lt-group lt-other">
          <h3>📝 {fill(L.retroReview, { n: retros.length })}</h3>
          <p className="lt-hint">{L.retroHint}</p>
          {retros.map(r=>(
            <div key={r.id} className="lt-retro">
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600}}>{(r.title||'').replace(/ — .*/,'')} <span style={{fontSize:11,color:'var(--text3)',fontWeight:400}}>· {r.employee_name} · {r.scheduled_date}</span></div>
                <div style={{fontSize:12,color:'var(--text2)',marginTop:4,fontStyle:'italic'}}>"{r.retro_report}"</div>
                <div style={{fontSize:11,color:'var(--text3)',marginTop:4}}>🤖 {r.retro_ai_summary} — {r.checklist_done}/{r.checklist_total} {L.items}</div>
                <div style={{fontSize:12,marginTop:4}}><b>{L.paid}: ¥{Number(r.retro_value||0).toLocaleString()}</b> {Number(r.value||0)>Number(r.retro_value||0)&&<span style={{color:'var(--red)'}}>({L.of} ¥{Number(r.value).toLocaleString()})</span>}</div>
                {(r.photo_start_url || r.photo_end_url) && (
                  <div style={{ marginTop: 8 }}>
                    <JobPhotos photoStartUrl={r.photo_start_url} photoEndUrl={r.photo_end_url} beforeLabel={L.before} afterLabel={L.after} size={52} onPhotoClick={setLightbox} />
                  </div>
                )}
              </div>
              <button onClick={()=>approveRetro(r.id)} className="btn btn-sm" style={{flexShrink:0}}>✓ {L.markReviewed}</button>
            </div>
          ))}
        </section>
      )}

      <section className="lt-group lt-other">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
          <div>
            <div style={{fontSize:13,fontWeight:600}}>📸 {L.photoStorage}</div>
            {photoInfo ? (
              photoInfo.error ? <div style={{fontSize:12,color:'var(--red)'}}>{photoInfo.error}</div> :
              <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>
                {fill(L.photoCount, { n: photoInfo.filesFound, date: photoInfo.cutoffDate })}{photoInfo.mode==='deleted'?fill(L.photoDeleted, { n: photoInfo.filesDeleted }):''}
              </div>
            ) : <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{L.photoCheckHint}</div>}
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={checkPhotos} className="btn btn-sm">{L.check}</button>
            {photoInfo && !photoInfo.error && photoInfo.filesFound > 0 && (
              <button onClick={cleanPhotos} disabled={cleaning} className="btn btn-sm lt-danger">{cleaning?L.cleaning:`🗑️ ${L.cleanOld}`}</button>
            )}
          </div>
        </div>
      </section>

      <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} />
    </div>
  )
}
