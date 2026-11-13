import { useState, useEffect, useCallback } from 'react'
import { coveredJobs, withoutCovered } from '../lib/jobCoverage'
import SkeletonRows from '../components/SkeletonRows'
import OvertimeAlerts from '../components/OvertimeAlerts'
import { supabase } from '../lib/supabase'
import { hasMapsLink, mapsOpenUrl, mapsCoordsUrl } from '../lib/mapsLink'
import { apiFetch } from '../lib/apiFetch'
import JobPhotos from '../components/JobPhotos'
import PhotoLightbox from '../components/PhotoLightbox'
import toast from 'react-hot-toast'
import { useLang, fill, localeOf, pickLang } from '../hooks/useLang'
import { askConfirm } from '../components/ConfirmDialog'
import { ManualCloseButton } from '../components/ManualCloseModal'
import { JaFizButton } from '../components/JaFizSheet'
import { adminMarkNotDone } from '../lib/jobAdminOps'
import { EliminateJobButton } from '../components/EliminateJobButton'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { fetchDayCoverage } from '../lib/dayCoverage'
import { ownMinutes, slotText } from '../lib/jobDuration'
import DayStoreStrip from '../components/DayStoreStrip'
import { fetchDayPanel } from '../lib/dayPanel'

const TZ = 'Asia/Tokyo'
import { countJobs, LATE_AFTER_MIN } from '../lib/jobCounts'
import { isDeadlineJob, isDeadlineLate, DEADLINE_MIN, OTP_DEADLINE, otpRouteAlerts, otpRouteAlertText, jobTimeLabel, jobTimeShort } from '../lib/jobDeadline'
import { pollWhileVisible } from '../lib/visiblePoll'
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
// v1.0.166 · the service type ("Basic Cleaning", "Deep Clean (AC Cleaning)") so two jobs at the same store differ.
const jobService = (j) => { const m = /\s—\s(.+)$/.exec(j.title || ''); return m ? m[1] : '' }
const byTime = (a, b) => (a.scheduled_time || '99:99').localeCompare(b.scheduled_time || '99:99') || (a.sequence_order || 99) - (b.sequence_order || 99)

// One status per person, in the order the admin needs to act on it.
const GROUPS = ['attention', 'working', 'upcoming', 'done', 'free']

function classify(emp, jobs, offToday, now, today, routeAlerts = []) {
  const mine = jobs.filter(j => j.employee_id === emp.id)
  const todayJobs = mine.filter(j => j.scheduled_date === today && j.status !== 'cancelled').sort(byTime)
  const active = mine.find(j => j.status === 'in_progress')
  const pending = todayJobs.filter(j => j.status === 'assigned')
  const next = pending[0] || null
  const done = todayJobs.filter(j => j.status === 'completed')
  const staleOpen = active && active.scheduled_date < today ? active : null
  const nowMin = now.getHours() * 60 + now.getMinutes()
  // v1.0.147 · OTP night jobs: no start time, only "concluir até 10:00"; late = not finished at 10:00 (running too)
  const nextIn = next ? (isDeadlineJob(next) ? DEADLINE_MIN - nowMin : minutesUntil(next.scheduled_time, now)) : null
  const deadlineLate = todayJobs.filter(j => isDeadlineLate(j, { today, nowMin }))
  const lateMin = deadlineLate.length ? nowMin - DEADLINE_MIN
    : !active && next && !isDeadlineJob(next) && nextIn != null && nextIn <= -LATE_AFTER_MIN ? -nextIn : 0
  const routeAlert = routeAlerts.find(a => a.employeeId === emp.id) || null

  let group
  if (lateMin || staleOpen || (routeAlert && !routeAlert.startedAt)) group = 'attention'
  else if (active) group = 'working'
  else if (next) group = 'upcoming'
  else if (done.length) group = 'done'
  else group = 'free'

  return { emp, group, todayJobs, active, next, nextIn, done, lateMin, deadlineLate, routeAlert, staleOpen, off: offToday.has(emp.id) }
}

export const fmtDuration = (min, L) => {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return fill(L.dMin, { m })
  const h = Math.floor(m / 60), r = m % 60
  return r ? fill(L.dHourMin, { h, m: r }) : fill(L.dHour, { h })
}

export default function LiveTracking() {
  const { t, lang, tr } = useLang()
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
  const [cov, setCov] = useState(null)
  // v1.0.238 · ONE snapshot of the day (lib/dayPanel) feeds the header counter AND the status tiles
  const [panel, setPanel] = useState(null)
  const [showCovDone, setShowCovDone] = useState(false)
  const navigate = useNavigate()
  // v1.0.195 · opened from Painel "Aguardando você hoje": ?emp=<id> (open + scroll to that person)
  // or ?focus=contracts&stores=A|B (scroll to the contract stores list, those stores highlighted).
  const [params] = useSearchParams()
  const focusEmp = params.get('emp')
  const focusContracts = params.get('focus') === 'contracts'
  const focusStores = new Set((params.get('stores') || '').split('|').filter(Boolean))
  const [focusDone, setFocusDone] = useState(false)

  const checkPhotos = async () => {
    try {
      const r = await apiFetch('/api/cleanup-photos')
      if (!r.ok) throw new Error('HTTP ' + r.status)
      setPhotoInfo(await r.json())
    } catch(e) { setPhotoInfo({ error: e.message }) }
  }

  const cleanPhotos = async () => {
    if (!(await askConfirm({ message: L.cleanConfirm, danger: false }))) return
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
    const n = tokyoNow()
    fetchDayCoverage(today, { nowMin: n.getHours() * 60 + n.getMinutes(), respectStart: true }).then(setCov, () => {})
    fetchDayPanel(today, { nowMin: n.getHours() * 60 + n.getMinutes(), today }).then(setPanel, () => {})
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

  useEffect(() => { load(); return pollWhileVisible(load, 30000) }, [load])

  useEffect(() => {
    if (focusDone || loading || (!focusEmp && !focusContracts)) return
    if (focusContracts && !cov) return
    if (focusEmp) { setOpen(focusEmp); setShowFree(true) }
    setFocusDone(true)
    const id = focusEmp ? `lt-emp-${focusEmp}` : 'lt-contracts'
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }, [focusDone, loading, focusEmp, focusContracts, cov])

  const now = tokyoNow()
  const today = tokyoToday()
  const nowMinT = now.getHours() * 60 + now.getMinutes()
  // v1.0.147 · 05:00 alert: OTP route of the day with no start by 05:00 (one per person per day)
  const routeAlerts = otpRouteAlerts(withoutCovered(jobs), { today, nowMin: nowMinT })
  // v1.0.148 · a job covered by another person (same day/store/service done by B) is not A's late/next
  const covered = coveredJobs(jobs)
  const ownJobs = covered.size ? jobs.filter(j => !covered.has(j.id)) : jobs
  const people = employees.map(emp => classify(emp, ownJobs, offToday, now, today, routeAlerts))
  const grouped = Object.fromEntries(GROUPS.map(g => [g, people.filter(p => p.group === g)]))
  grouped.attention.sort((a, b) => b.lateMin - a.lateMin)
  grouped.upcoming.sort((a, b) => (a.nextIn ?? 9999) - (b.nextIn ?? 9999))
  grouped.working.sort((a, b) => new Date(a.active.started_at || 0) - new Date(b.active.started_at || 0))

  const dateLabel = new Date().toLocaleDateString(lang === 'en' ? 'en-US' : localeOf(lang), { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })
  // v1.0.133 · the tiles count JOBS of today with the shared counter (jobCounts), not people:
  // "Ainda não começou" = every job of the day still not started (late ones included), with or without a person.
  const dayCount = countJobs(jobs.filter(j => j.scheduled_date === today), { from: today, to: today, today, nowMin: now.getHours() * 60 + now.getMinutes() })
  // v1.0.238 · tiles read the SAME counts as the header (dayPanel): done / in progress / not started of the services of the day
  const pc = panel?.count
  const tileN = { late: pc ? pc.servicesLate : dayCount.late, working: pc ? pc.inProgress : dayCount.inProgress, upcoming: pc ? pc.toStart : dayCount.notStarted, done: pc ? pc.servicesDone : dayCount.completed }
  const staleCount = jobs.filter(j => j.status === 'in_progress' && j.scheduled_date < today).length
  const tiles = [
    { g: 'attention', n: tileN.late + staleCount + routeAlerts.filter(a => !a.startedAt && !people.some(p => p.emp.id === a.employeeId && p.deadlineLate.length)).length, label: L.tileLate, tone: 'red' },
    { g: 'working', n: tileN.working, label: L.tileWorking, tone: 'green' },
    { g: 'upcoming', n: tileN.upcoming, label: L.tileUpcoming, tone: 'blue' },
    { g: 'done', n: tileN.done, label: L.tileDone, tone: 'gray' },
  ]

  const statusLine = (p) => {
    const { active, next, nextIn, lateMin, staleOpen, done, todayJobs, deadlineLate, routeAlert } = p
    const routeNote = routeAlert ? otpRouteAlertText(routeAlert, tr) : ''
    if (staleOpen) return { main: fill(L.staleOpen, { place: jobPlace(staleOpen), date: staleOpen.scheduled_date }), sub: L.staleOpenHint }
    if (deadlineLate?.length) return {
      main: tr(`Late — OTP not finished by ${OTP_DEADLINE} (${fmtDuration(lateMin, L)} ago)`, `遅れ — OTPが${OTP_DEADLINE}までに完了していません（${fmtDuration(lateMin, L)}経過）`, `Atrasado — OTP não concluído até ${OTP_DEADLINE} (há ${fmtDuration(lateMin, L)})`),
      sub: [fill(L.doneSoFar, { done: done.length, total: todayJobs.length }), routeNote].filter(Boolean).join(' · '),
    }
    if (routeAlert && !routeAlert.startedAt && !active) return {
      main: routeNote,
      sub: next ? `${jobPlace(next)} · ${jobTimeLabel(next, tr)}` : '',
    }
    if (lateMin) return {
      main: fill(L.lateMain, { d: fmtDuration(lateMin, L) }),
      sub: fill(L.lateSub, { place: jobPlace(next), time: shortTime(next.scheduled_time) }),
    }
    if (active) {
      const since = active.started_at ? (Date.now() - new Date(active.started_at)) / 60000 : null
      const startedLate = active.started_at && active.scheduled_time && active.scheduled_date === today && !isDeadlineJob(active)
        ? toMin(hhmm(active.started_at)) - toMin(active.scheduled_time)
        : 0
      return {
        main: active.started_at
          ? fill(L.workingMain, { place: jobPlace(active), time: hhmm(active.started_at), d: fmtDuration(since, L) })
          : fill(L.workingNoTime, { place: jobPlace(active) }),
        sub: [
          startedLate >= 10 ? fill(L.startedLate, { d: fmtDuration(startedLate, L) }) : '',
          isDeadlineJob(active) ? jobTimeLabel(active, tr) : '',
          next ? fill(L.thenNext, { place: jobPlace(next), time: isDeadlineJob(next) ? jobTimeLabel(next, tr) : next.scheduled_time ? shortTime(next.scheduled_time) : '—' }) : '',
          routeNote,
        ].filter(Boolean).join(' · '),
      }
    }
    if (next && isDeadlineJob(next)) return {
      main: `${jobPlace(next)} · ${jobTimeLabel(next, tr)}`,
      sub: [done.length ? fill(L.doneSoFar, { done: done.length, total: todayJobs.length }) : '', routeNote].filter(Boolean).join(' · '),
    }
    if (next) return {
      main: next.scheduled_time
        ? fill(nextIn > 0 ? L.nextMain : L.nextNow, { place: jobPlace(next), time: shortTime(next.scheduled_time), d: fmtDuration(nextIn, L) })
        : fill(L.nextNoTime, { place: jobPlace(next) }),
      sub: done.length ? fill(L.doneSoFar, { done: done.length, total: todayJobs.length }) : '',
    }
    if (done.length) {
      const last = done.map(j => j.completed_at).filter(Boolean).sort().pop()
      return { main: fill(last ? L.doneMain : L.doneMainNoTime, { n: done.length, time: hhmm(last) }), sub: routeNote }
    }
    return { main: p.off ? L.dayOff : L.noJobs, sub: '' }
  }

  // v1.0.144 · "Não feito": the job never happened (or was a duplicate) → cancelled with a reason, not paid or billed.
  const markNotDone = async (j) => {
    const reason = await askConfirm({
      title: tr('Mark as not done?', '未実施にしますか？', 'Marcar como não feito?'),
      message: tr(`${jobPlace(j)} · ${jobKind(j) || ''} (${j.employee_name || '—'}) will be cancelled: it is not paid or billed. Why?`,
        `${jobPlace(j)} · ${jobKind(j) || ''}（${j.employee_name || '—'}）をキャンセルします。給与・請求に含まれません。理由は？`,
        `${jobPlace(j)} · ${jobKind(j) || ''} (${j.employee_name || '—'}) será cancelado: não entra no pagamento nem na cobrança. Por quê?`),
      reason: tr('Reason (e.g. duplicate, done by another person)', '理由（例：重複、他のスタッフが実施）', 'Motivo (ex.: duplicado, feito por outra pessoa)'),
      confirmLabel: tr('Not done', '未実施にする', 'Não feito'),
      danger: true,
    })
    if (!reason) return
    try {
      await adminMarkNotDone(j, { reason: typeof reason === 'string' ? reason : null })
      toast.success(tr('Marked as not done', '未実施にしました', 'Marcado como não feito'))
    } catch (ex) {
      toast.error(ex.message === 'started' ? tr('The employee already started this job.', 'スタッフがすでに開始しています。', 'O funcionário já iniciou este job.') : ex.message)
    }
    load()
  }

  const personCard = (p) => {
    const { emp, group, todayJobs, active, next } = p
    const s = statusLine(p)
    const locAgeMin = emp.last_location_at ? (Date.now() - new Date(emp.last_location_at)) / 60000 : null
    const showLoc = emp.location_sharing !== false && emp.last_lat && locAgeMin != null && locAgeMin < LOCATION_FRESH_MIN
    const focusJob = p.staleOpen || active || next
    const isOpen = open === emp.id
    return (
      <div key={emp.id} id={`lt-emp-${emp.id}`} className={`lt-card is-${group}${focusEmp === emp.id ? ' is-focus' : ''}`}>
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
          {p.staleOpen && <ManualCloseButton job={p.staleOpen} className="lt-act lt-act-close" onDone={load} />}
          {focusJob && hasMapsLink(focusJob.address, focusJob.title) && <a className="lt-act" href={mapsOpenUrl(focusJob.address, focusJob.title)} target="_blank" rel="noreferrer">🗺 {L.jobAddress}</a>}
          {showLoc && <a className="lt-act" href={mapsCoordsUrl(emp.last_lat, emp.last_lng)} target="_blank" rel="noreferrer">📍 {fill(L.whereNow, { d: fmtDuration(locAgeMin, L) })}</a>}
          {emp.phone && <a className="lt-act" href={`tel:${emp.phone.replace(/[^\d+]/g, '')}`}>📞 {L.call}</a>}
          {todayJobs.length > 0 && <button type="button" className="lt-act lt-act-ghost" onClick={() => setOpen(isOpen ? null : emp.id)}>{isOpen ? L.hideDay : fill(L.showDay, { n: todayJobs.length })}</button>}
        </div>
        {isOpen && todayJobs.length > 0 && (
          <ol className="lt-timeline">
            {todayJobs.map(j => (
              <li key={j.id} className={`is-${j.status}`}>
                <span className="lt-tl-time">{isDeadlineJob(j) ? jobTimeShort(j, tr) : j.scheduled_time ? shortTime(j.scheduled_time) : '—'}</span>
                <span className="lt-tl-body">
                  <b>{jobPlace(j)}</b>{jobKind(j) && <span className="lt-tl-kind"> · {jobKind(j)}</span>}{jobService(j) && <span className="lt-tl-kind"> · {jobService(j)}</span>}
                  {/* v1.0.220 · planned duration + finish, for any job that has its own (with or without contract) */}
                  {!isDeadlineJob(j) && ownMinutes(j) && <span className="lt-tl-meta">{slotText(j.scheduled_time, ownMinutes(j), tr)}</span>}
                  <span className="lt-tl-meta">
                    {j.status === 'completed' ? fill(L.tlDone, { start: hhmm(j.started_at) || '—', end: hhmm(j.completed_at) || '—' }) + (j.started_at && j.completed_at ? ` (${fmtDuration((new Date(j.completed_at) - new Date(j.started_at)) / 60000, L)})` : '')
                      : j.status === 'in_progress' ? fill(L.tlWorking, { start: hhmm(j.started_at) || '—' })
                      : L.tlNotStarted}
                  </span>
                </span>
                {j.status === 'completed' && (j.photo_start_url || j.photo_end_url) && (
                  <JobPhotos photoStartUrl={j.photo_start_url} photoEndUrl={j.photo_end_url} beforeLabel={L.before} afterLabel={L.after} size={36} onPhotoClick={setLightbox} />
                )}
                {/* v1.0.166 · a job registered by mistake (duplicate, 0 min…) leaves pay and billing */}
                {(j.status === 'completed' || j.status === 'in_progress') && (
                  <span className="lt-tl-acts"><EliminateJobButton job={j} className="lt-act lt-act-sm lt-act-danger" onDone={load} /></span>
                )}
                {j.status !== 'completed' && (
                  <span className="lt-tl-acts">
                    {/* v1.0.156 · never opened → "Já fiz" (times, checklist, photos, note); running → close manually */}
                    {j.status === 'assigned' && !j.started_at
                      ? <JaFizButton job={j} className="lt-act lt-act-close lt-act-sm" onDone={load} />
                      : <ManualCloseButton job={j} allowNotStarted className="lt-act lt-act-close lt-act-sm" onDone={load} label={`🔒 ${tr('Close', '終了', 'Fechar')}`} />}
                    {j.status === 'assigned' && !j.started_at && <button type="button" className="lt-act lt-act-sm" onClick={() => markNotDone(j)}>✕ {tr('Not done', '未実施', 'Não feito')}</button>}
                  </span>
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
      <DayStoreStrip count={panel?.count} L={(en, ja, pt) => pickLang(lang, en, ja, pt)} />

      {cov && cov.total > 0 && (() => {
        const missing = cov.total - cov.done
        const shown = showCovDone ? cov.items : cov.missing
        const stLabel = { noJob: L.covNoJob, noPerson: L.covNoPerson, late: L.covLate, waiting: L.covWaiting, working: L.covWorking, done: L.covDone }
        return (
          <section id="lt-contracts" className={`lt-cov ${missing ? 'is-missing' : 'is-alldone'}`}>
            <div className="lt-cov-head">
              <div>
                <div className="lt-cov-label">{L.covTitle}</div>
                <div className="lt-cov-count">
                  {fill(L.covCount, { done: cov.done, total: cov.total })}
                  {missing > 0 && <> · <em>{fill(L.covMissing, { n: missing })}</em></>}
                </div>
              </div>
            </div>
            <div className="lt-cov-bar" role="progressbar" aria-valuemin={0} aria-valuemax={cov.total} aria-valuenow={cov.done}><i style={{ width: `${Math.round(cov.done / cov.total * 100)}%` }} /></div>
            {missing === 0 && <p className="lt-cov-hint">✓ {L.covAllDone}</p>}
            {shown.length > 0 && (
              <ul className="lt-cov-list">
                {shown.map(it => (
                  <li key={it.place} className={focusStores.has(it.place) ? 'is-focus' : undefined}>
                    <span className="lt-cov-place">
                      <b>{it.place}</b>
                      <span>{it.personName ? (it.usual ? fill(L.covUsual, { name: it.personName }) : it.personName) : L.covNobody}{it.job && isDeadlineJob(it.job) ? ` · ${jobTimeLabel(it.job, tr)}` : it.job?.scheduled_time ? ` · ${shortTime(it.job.scheduled_time)}` : ''}</span>
                    </span>
                    <span className={`lt-cov-chip st-${it.state}`}>{stLabel[it.state]}</span>
                  </li>
                ))}
              </ul>
            )}
            {cov.missing.some(it => it.state === 'noJob') && <p className="lt-cov-hint">{L.covNoJobHint}</p>}
            <div className="lt-cov-actions">
              {cov.missing.some(it => it.state === 'noJob' || it.state === 'noPerson') && (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => navigate('/schedule')}>📅 {L.covCreate}</button>
              )}
              {cov.done > 0 && (
                <button type="button" className="btn btn-sm" onClick={() => setShowCovDone(v => !v)}>{showCovDone ? L.covHideDone : fill(L.covShowDone, { n: cov.done })}</button>
              )}
            </div>
          </section>
        )
      })()}

      <div className="lt-tiles">
        {tiles.map(tile => (
          <a key={tile.g} href={`#lt-${tile.g}`} className={`lt-tile is-${tile.tone}${tile.n ? '' : ' is-zero'}`}
            onClick={e => { e.preventDefault(); document.getElementById(`lt-${tile.g}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>
            <b>{tile.n}</b><span>{tile.label}</span>
          </a>
        ))}
      </div>

      <OvertimeAlerts jobs={jobs} onChanged={load} />

      {loading && <SkeletonRows rows={4} label={L.loading} />}

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
                {r.retro_report&&<div style={{fontSize:12,color:'var(--text2)',marginTop:4,fontStyle:'italic'}}>"{r.retro_report}"</div>}
                <div style={{fontSize:11,color:'var(--text3)',marginTop:4}}>{r.retro_ai_summary&&<>🤖 {r.retro_ai_summary} — </>}{r.checklist_done}/{r.checklist_total} {L.items}</div>
                <div style={{fontSize:12,marginTop:4}}><b>{tr('Client pays', '顧客支払', 'Cliente paga')}: ¥{Number(r.retro_value||0).toLocaleString()}</b> {Number(r.value||0)>Number(r.retro_value||0)&&<span style={{color:'var(--red)'}}>({L.of} ¥{Number(r.value).toLocaleString()})</span>}</div>
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
