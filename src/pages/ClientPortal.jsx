import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useLang, fill } from '../hooks/useLang'
import LanguageToggle from '../components/LanguageToggle'
import {
  buildDeepCleanProgressForUser, currentYearMonth, ONTHEPLANET_CLIENT_ID,
} from '../lib/cleaningType'
import { fmtDuration, jobDurationMin } from '../lib/jobReport'
import { viewablePhotoUrl } from '../lib/photoUrl'
import JobPhotos from '../components/JobPhotos'
import { ManagerCard, BillingView, BillingAlerts, StoresView, QuoteForm, RequestCard, MaintenanceList, maintenanceAlertsFor, itemLabel } from '../components/ClientCare'
import { summarizeCleaningMonth, deepSummaryFromPlan, weeklyCompleted, shiftMonth } from '../lib/clientProgress'
import PhotoLightbox from '../components/PhotoLightbox'
import {
  jobMatchesClientUser, locationFromJob, fmtVisitTime, fmtVisitEnd, ratingMatchesClientUser,
} from '../lib/clientPortal'
import { updateClientCredentials } from '../lib/clientCredentials'
import toast from 'react-hot-toast'
import { tokyoToday } from '../lib/dates'
import { uploadJobPhoto } from '../lib/uploadPhoto'
import './client-portal.css'

function sanitizePostgrestToken(value) {
  return String(value || '').replace(/[%(),.\\]/g, '').trim()
}

const filterByLocation = (rows, locationName) => {
  if (!locationName) return rows || []
  return (rows || []).filter(r => !r.location_name || r.location_name === locationName)
}

function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number)
  const from = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { from, to }
}

function visitRangeForPreset(preset, today) {
  if (preset === 'all') return { from: '2000-01-01', to: today }
  if (preset === '90d') {
    const from = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
    return { from, to: today }
  }
  if (preset === 'lastMonth') {
    const [y, m] = today.split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    return monthBounds(ym)
  }
  return { from: `${today.slice(0, 7)}-01`, to: today }
}

export default function ClientPortal() {
  const { user, logout, updateSession } = useAuth()
  const { lang, switchLang, t: tr } = useLang()
  const c = tr?.client
  const dateLocale = lang === 'ja' ? 'ja-JP' : 'en-GB'

  const [desktopMode, setDesktopMode] = useState(() => {
    const saved = localStorage.getItem('cp_view_mode')
    if (saved === 'desktop' || saved === 'mobile') return saved === 'desktop'
    return typeof window !== 'undefined' && window.innerWidth >= 900
  })

  const [tab, setTab] = useState('home')
  const [jobs, setJobs] = useState([])
  const [contracts, setContracts] = useState([])
  const [messages, setMessages] = useState([])
  const [complaints, setComplaints] = useState([])
  const [compliments, setCompliments] = useState([])
  const [ratings, setRatings] = useState([])
  const [requests, setRequests] = useState([])
  const [invoices, setInvoices] = useState([])
  const [clientRow, setClientRow] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [maintRecords, setMaintRecords] = useState([])
  const [quoteDefaults, setQuoteDefaults] = useState({})
  const [moreOpen, setMoreOpen] = useState(false)
  const [feedbackTab, setFeedbackTab] = useState('complaints')
  const [newMsg, setNewMsg] = useState('')
  const [selectedVisit, setSelectedVisit] = useState(null)
  const [lightbox, setLightbox] = useState(null)
  const [unreadMsgs, setUnreadMsgs] = useState(0)
  const [loading, setLoading] = useState(true)
  const [clock, setClock] = useState(new Date())
  const [visitPreset, setVisitPreset] = useState('month')
  const [visitRange, setVisitRange] = useState(() => visitRangeForPreset('month', tokyoToday()))
  const [deepProgressMonth, setDeepProgressMonth] = useState(currentYearMonth)
  const loadedOnceRef = useRef(false)

  const [complaintForm, setComplaintForm] = useState({ job_id: '', category: 'quality', description: '' })
  const [showComplaintForm, setShowComplaintForm] = useState(false)
  const [showComplimentForm, setShowComplimentForm] = useState(false)
  const [showRequestForm, setShowRequestForm] = useState(false)
  const [ratingForm, setRatingForm] = useState({ stars: 5, comment: '' })
  const [complimentForm, setComplimentForm] = useState({ job_id: '', message: '' })
  const [submittingRating, setSubmittingRating] = useState(false)
  const [submittingComplaint, setSubmittingComplaint] = useState(false)
  const [complaintPhoto, setComplaintPhoto] = useState(null)
  const [complaintPhotoPreview, setComplaintPhotoPreview] = useState(null)
  const [ratingPhoto, setRatingPhoto] = useState(null)
  const [ratingPhotoPreview, setRatingPhotoPreview] = useState(null)
  const [credForm, setCredForm] = useState({ currentPassword: '', newEmail: '', newPassword: '' })
  const [savingCreds, setSavingCreds] = useState(false)

  const msgEndRef = useRef()

  const toggleView = () => {
    const next = !desktopMode
    setDesktopMode(next)
    localStorage.setItem('cp_view_mode', next ? 'desktop' : 'mobile')
  }

  const loadAll = useCallback(async ({ silent = false } = {}) => {
    if (!user?.client_id) {
      setLoading(false)
      toast.error(c?.sessionExpired || 'Session expired. Please log in again.')
      return
    }
    const since = new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0]
    if (!silent && !loadedOnceRef.current) setLoading(true)

    try {
      const locToken = sanitizePostgrestToken(user.location_name)
      const locOrFilter = locToken
        ? `client_id.eq.${user.client_id},and(client_id.is.null,title.ilike.%${locToken}%)`
        : `client_id.eq.${user.client_id}`
      const [jobsRes, contractsRes, msgsRes, compRes, cmplRes, ratRes, reqRes] = await Promise.all([
        supabase.from('jobs').select('*').or(locOrFilter).gte('scheduled_date', since).order('scheduled_date', { ascending: false }).limit(200),
        supabase.from('service_contracts').select('location_name').eq('client_id', user.client_id).eq('is_active', true),
        supabase.from('client_messages').select('*').eq('client_id', user.client_id).order('created_at').limit(100),
        supabase.from('client_complaints').select('*').eq('client_id', user.client_id).order('created_at', { ascending: false }).limit(30),
        supabase.from('client_compliments').select('*').eq('client_id', user.client_id).order('created_at', { ascending: false }).limit(30),
        supabase.from('client_ratings').select('*').eq('client_id', user.client_id).order('created_at', { ascending: false }).limit(100),
        supabase.from('client_requests').select('*').eq('client_id', user.client_id).order('created_at', { ascending: false }).limit(30),
      ])

      const firstErr = [jobsRes, contractsRes, msgsRes, compRes, cmplRes, ratRes, reqRes]
        .map(r => r.error?.message)
        .find(Boolean)
      if (firstErr?.includes('client_') || firstErr?.includes('PGRST205')) {
        toast.error('Portal tables missing. Ask admin to run portal setup in Clients.')
      } else if (firstErr) {
        toast.error(firstErr)
      }

      // Billing, account manager and store data: optional, so a missing table never blocks the portal.
      const [invRes, cliRes, profRes, maintRes] = await Promise.all([
        supabase.from('faturas').select('*').eq('client_id', user.client_id).in('status', ['sent', 'paid', 'overdue']).order('issue_date', { ascending: false }).limit(60),
        supabase.from('clients').select('id,company_name,manager_name,manager_email,manager_phone,manager_line_url,manager_photo_url').eq('id', user.client_id).maybeSingle(),
        supabase.from('location_profiles').select('*').eq('client_id', user.client_id),
        supabase.from('location_maintenance').select('*').eq('client_id', user.client_id),
      ])
      setInvoices(invRes.data || [])
      setClientRow(cliRes.data || null)
      setProfiles(filterByLocation(profRes.data, user.location_name))
      setMaintRecords(filterByLocation(maintRes.data, user.location_name))
      setJobs((jobsRes.data || []).filter(j => jobMatchesClientUser(j, user)))
      setContracts(contractsRes.data || [])
      setMessages(filterByLocation(msgsRes.data, user.location_name))
      setComplaints(filterByLocation(compRes.data, user.location_name))
      setCompliments(filterByLocation(cmplRes.data, user.location_name))
      setRatings((ratRes.data || []).filter(r => ratingMatchesClientUser(r, user)))
      setRequests(filterByLocation(reqRes.data, user.location_name))
      setUnreadMsgs(filterByLocation(msgsRes.data, user.location_name).filter(m => m.sender === 'admin' && !m.read).length)
      await supabase.from('client_users').update({ last_seen: new Date().toISOString() }).eq('id', user.id)
    } catch (err) {
      toast.error(err?.message || 'Failed to load portal data')
    } finally {
      setLoading(false)
      loadedOnceRef.current = true
    }
  }, [user, c?.sessionExpired])

  const markMessagesRead = useCallback(async () => {
    if (!user?.client_id) return
    let q = supabase.from('client_messages').update({ read: true }).eq('client_id', user.client_id).eq('sender', 'admin').eq('read', false)
    if (user.location_name) q = q.eq('location_name', user.location_name)
    await q
    setUnreadMsgs(0)
  }, [user?.client_id, user?.location_name])

  useEffect(() => {
    if (!localStorage.getItem('kp_lang') && !localStorage.getItem('emp_lang')) switchLang('en')
  }, [])

  useEffect(() => {
    if (!c) return
    loadAll({ silent: false })
    const refresh = setInterval(() => loadAll({ silent: true }), 20000)
    return () => clearInterval(refresh)
  }, [user?.id, c, loadAll])

  useEffect(() => {
    const tick = setInterval(() => setClock(new Date()), 60000)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    if (!c || tab !== 'chat') return
    markMessagesRead()
    setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 150)
  }, [tab, messages, c, markMessagesRead])

  useEffect(() => {
    if (!selectedVisit) return
    const existing = ratings.find(r => r.job_id === selectedVisit.id)
    if (existing) setRatingForm({ stars: existing.stars, comment: existing.comment || '' })
    else setRatingForm({ stars: 5, comment: '' })
  }, [selectedVisit?.id, ratings])

  useEffect(() => {
    setRatingPhoto(null)
    setRatingPhotoPreview(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
  }, [selectedVisit?.id])

  useEffect(() => () => {
    if (complaintPhotoPreview) URL.revokeObjectURL(complaintPhotoPreview)
    if (ratingPhotoPreview) URL.revokeObjectURL(ratingPhotoPreview)
  }, [complaintPhotoPreview, ratingPhotoPreview])

  const clearComplaintPhoto = () => {
    setComplaintPhoto(null)
    if (complaintPhotoPreview) URL.revokeObjectURL(complaintPhotoPreview)
    setComplaintPhotoPreview(null)
  }

  const clearRatingPhoto = () => {
    setRatingPhoto(null)
    if (ratingPhotoPreview) URL.revokeObjectURL(ratingPhotoPreview)
    setRatingPhotoPreview(null)
  }

  const pickComplaintPhoto = (file) => {
    clearComplaintPhoto()
    setComplaintPhoto(file)
    setComplaintPhotoPreview(URL.createObjectURL(file))
  }

  const pickRatingPhoto = (file) => {
    clearRatingPhoto()
    setRatingPhoto(file)
    setRatingPhotoPreview(URL.createObjectURL(file))
  }

  const uploadFeedbackPhoto = async (folder, id, file) => {
    if (!file) return null
    return uploadJobPhoto(`client-portal/${folder}/${id}.jpg`, file)
  }

  const filteredVisits = useMemo(() => {
    const done = jobs.filter(j => j.status === 'completed')
    return done.filter(j => j.scheduled_date >= visitRange.from && j.scheduled_date <= visitRange.to)
  }, [jobs, visitRange.from, visitRange.to])

  const visitStats = useMemo(() => {
    let minutes = 0
    let withDuration = 0
    for (const job of filteredVisits) {
      const min = jobDurationMin(job)
      if (min != null) {
        minutes += min
        withDuration += 1
      }
    }
    const avg = withDuration ? Math.round(minutes / withDuration) : null
    return { count: filteredVisits.length, minutes, avg }
  }, [filteredVisits])

  const isOtpClient = user?.client_id === ONTHEPLANET_CLIENT_ID
  const deepProgress = useMemo(() => {
    if (!isOtpClient) return null
    return buildDeepCleanProgressForUser(jobs, deepProgressMonth, user)
  }, [jobs, deepProgressMonth, user, isOtpClient])
  const deepProgressMonthLabel = useMemo(() => (
    new Date(`${deepProgressMonth}-01T12:00:00`).toLocaleDateString(dateLocale, { month: 'long', year: 'numeric' })
  ), [deepProgressMonth, dateLocale])

  if (!c) {
    return (
      <div style={{ minHeight: '100vh', background: '#0d2137', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Client portal unavailable</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginBottom: 16 }}>Translation bundle failed to load. Please refresh or contact support.</div>
          <button type="button" onClick={logout} style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: '#c19c56', color: '#0d2137', fontWeight: 700, cursor: 'pointer' }}>Logout</button>
        </div>
      </div>
    )
  }

  const sendMessage = async () => {
    if (!newMsg.trim()) return
    const { error } = await supabase.from('client_messages').insert({
      client_id: user.client_id, client_user_id: user.id, client_name: user.client_name,
      location_name: user.location_name, sender: 'client', content: newMsg.trim(), read: false,
    })
    if (error) return toast.error(error.message)
    setNewMsg('')
    loadAll({ silent: true })
  }

  const submitComplaint = async () => {
    if (!complaintForm.description.trim()) return toast.error(c.complaintDesc)
    if (submittingComplaint) return
    setSubmittingComplaint(true)
    const job = jobs.find(j => j.id === complaintForm.job_id)
    const complaintId = crypto.randomUUID()
    try {
      let photo_url = null
      if (complaintPhoto) {
        photo_url = await uploadFeedbackPhoto('complaints', complaintId, complaintPhoto)
      }
      const payload = {
        id: complaintId,
        client_id: user.client_id,
        client_user_id: user.id,
        job_id: complaintForm.job_id || null,
        location_name: job ? locationFromJob(job) : user.location_name,
        employee_name: job?.employee_name || null,
        category: complaintForm.category,
        description: complaintForm.description.trim(),
        status: 'open',
        photo_url,
      }
      let { error } = await supabase.from('client_complaints').insert(payload)
      if (error?.message?.includes('photo_url')) {
        const { photo_url: _drop, ...withoutPhoto } = payload
        ;({ error } = await supabase.from('client_complaints').insert(withoutPhoto))
      }
      if (error) throw error
      toast.success(c.complaintSent)
      setComplaintForm({ job_id: '', category: 'quality', description: '' })
      clearComplaintPhoto()
      setShowComplaintForm(false)
      loadAll({ silent: true })
    } catch (err) {
      toast.error(err?.message || 'Failed to submit complaint')
    } finally {
      setSubmittingComplaint(false)
    }
  }

  const submitRating = async (job) => {
    if (!ratingForm.stars) return
    if (submittingRating) return
    setSubmittingRating(true)
    const existing = ratings.find(r => r.job_id === job.id)
    try {
      let photo_url = existing?.photo_url || null
      if (ratingPhoto) {
        photo_url = await uploadFeedbackPhoto('ratings', job.id, ratingPhoto)
      }
      const payload = {
        client_id: user.client_id,
        client_user_id: user.id,
        job_id: job.id,
        employee_name: job.employee_name,
        location_name: locationFromJob(job),
        stars: ratingForm.stars,
        comment: ratingForm.comment.trim() || null,
        photo_url,
      }
      let { error } = await supabase.from('client_ratings').upsert(payload, { onConflict: 'job_id' })
      if (error?.message?.includes('photo_url')) {
        const { photo_url: _drop, ...withoutPhoto } = payload
        ;({ error } = await supabase.from('client_ratings').upsert(withoutPhoto, { onConflict: 'job_id' }))
      }
      if (error) throw error
      toast.success(c.ratingSent)
      setRatingForm({ stars: 5, comment: '' })
      clearRatingPhoto()
      loadAll({ silent: true })
    } catch (err) {
      toast.error(err?.message || 'Failed to submit rating')
    } finally {
      setSubmittingRating(false)
    }
  }

  const submitCompliment = async () => {
    if (!complimentForm.message.trim()) return toast.error(c.complimentDesc)
    const job = jobs.find(j => j.id === complimentForm.job_id)
    const { error } = await supabase.from('client_compliments').insert({
      client_id: user.client_id, client_user_id: user.id, job_id: complimentForm.job_id || null,
      location_name: job ? locationFromJob(job) : user.location_name, employee_name: job?.employee_name || null,
      message: complimentForm.message.trim(), status: 'new',
    })
    if (error) return toast.error(error.message)
    toast.success(c.complimentSent)
    setComplimentForm({ job_id: '', message: '' })
    setShowComplimentForm(false)
    loadAll({ silent: true })
  }

  const saveCredentials = async () => {
    if (!credForm.currentPassword.trim()) return toast.error(c.currentPassword)
    if (!credForm.newEmail.trim() && !credForm.newPassword.trim()) {
      return toast.error(c.nothingToUpdate)
    }
    setSavingCreds(true)
    const result = await updateClientCredentials(supabase, user.id, credForm)
    setSavingCreds(false)
    if (!result.success) return toast.error(result.error)
    if (result.email) updateSession({ email: result.email })
    toast.success(c.credentialsUpdated)
    setCredForm({ currentPassword: '', newEmail: '', newPassword: '' })
  }

  const submitRequest = async (form, categoryLabel) => {
    if (!form.description.trim() && !(form.kind === 'quote' && form.category)) return toast.error(c.requestDesc)
    const isQuote = form.kind === 'quote'
    const { error } = await supabase.from('client_requests').insert({
      client_id: user.client_id, client_user_id: user.id,
      location_name: form.location_name || user.location_name || null,
      description: form.description.trim() || categoryLabel, preferred_date: form.preferred_date || null,
      status: 'pending', ticket_number: `KP-${Date.now().toString(36).toUpperCase().slice(-6)}`,
      request_type: isQuote ? 'quote' : 'service',
      category: isQuote ? (categoryLabel || null) : null,
      quote_status: isQuote ? 'requested' : null,
    })
    if (error) return toast.error(error.message)
    toast.success(isQuote ? c.quoteSent : c.requestSent)
    setQuoteDefaults({})
    setShowRequestForm(false)
    loadAll({ silent: true })
  }

  const decideQuote = async (rq, decision) => {
    const { error } = await supabase.from('client_requests').update({ quote_status: decision, decided_at: new Date().toISOString() }).eq('id', rq.id)
    if (error) return toast.error(error.message)
    toast.success(decision === 'accepted' ? c.quoteAcceptedToast : c.quoteDeclinedToast)
    loadAll({ silent: true })
  }

  const openQuote = (location, key) => {
    setQuoteDefaults({ kind: 'quote', category: key, location_name: location || '', description: `${itemLabel(key, lang)} — ${location || ''}`.trim() })
    setShowRequestForm(true)
    setTab('requests')
  }

  const applyVisitPreset = (preset) => {
    setVisitPreset(preset)
    setVisitRange(visitRangeForPreset(preset, tokyoToday()))
  }

  const today = tokyoToday()
  const todayJobs = jobs.filter(j => j.scheduled_date === today)
  const upcoming = jobs.filter(j => j.scheduled_date > today && j.status !== 'cancelled').slice(0, 10)
  const completed = jobs.filter(j => j.status === 'completed')
  const locations = [...new Set([
    ...(user.location_name ? [user.location_name] : []),
    ...contracts.map(ct => ct.location_name).filter(Boolean),
    ...jobs.map(j => locationFromJob(j)).filter(Boolean),
  ])]

  const statusLabel = (s) => ({ assigned: tr.status.assigned, in_progress: tr.status.in_progress, completed: tr.status.completed, cancelled: tr.status.cancelled }[s] || s)
  const statusClass = (s) => ({ completed: 'done', in_progress: 'progress', assigned: 'pending' }[s] || 'pending')
  const cardStatusClass = (s) => ({ completed: 'status-completed', in_progress: 'status-progress', assigned: 'status-assigned' }[s] || 'status-assigned')
  const complaintCat = (k) => ({ quality: c.catQuality, missed: c.catMissed, damage: c.catDamage, late: c.catLate, other: c.catOther }[k] || k)
  const ratingForJob = (jobId) => ratings.find(r => r.job_id === jobId)

  const billingOverdue = invoices.filter(inv => !(inv.status === 'paid' || inv.paid_at) && inv.due_date && inv.due_date < today).length
  const storeNames = [...new Set([...locations, ...profiles.map(p => p.location_name)])].filter(Boolean)
  const maintAlerts = maintenanceAlertsFor({ locations: storeNames, jobs, records: maintRecords, today })
  const maintOverdue = maintAlerts.filter(a => a.state === 'overdue').length
  const monthKey = today.slice(0, 7)
  const monthDoneCount = completed.filter(j => j.scheduled_date?.startsWith(monthKey)).length
  const hour = Number(clock.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Tokyo' }))
  const greeting = hour < 12 ? c.greetMorning : hour < 18 ? c.greetAfternoon : c.greetEvening
  const basicSummary = summarizeCleaningMonth(jobs, deepProgressMonth, today, false)
  const deepSummary = (isOtpClient && deepProgress?.scope !== 'none' && deepSummaryFromPlan(deepProgress))
    || summarizeCleaningMonth(jobs, deepProgressMonth, today, true)
  const weeklyDone = weeklyCompleted(jobs, deepProgressMonth)

  const navItems = [
    { key: 'home', icon: <NavIcon name="home" />, label: c.home },
    { key: 'billing', icon: <NavIcon name="billing" />, label: c.billingTab, badge: billingOverdue },
    { key: 'stores', icon: <NavIcon name="store" />, label: c.storesTab, badge: maintOverdue },
    { key: 'requests', icon: <NavIcon name="requests" />, label: c.quotesTab },
    { key: 'chat', icon: <NavIcon name="chat" />, label: c.chat, badge: unreadMsgs },
    { key: 'visits', icon: <NavIcon name="visits" />, label: c.visits },
    { key: 'complaints', icon: <NavIcon name="complaints" />, label: c.complaints },
    { key: 'settings', icon: <NavIcon name="settings" />, label: c.settings },
  ]
  const bottomKeys = ['home', 'billing', 'stores', 'requests', 'chat']
  const moreItems = navItems.filter(n => !bottomKeys.includes(n.key))

  const avgRating = ratings.length
    ? (ratings.reduce((s, r) => s + r.stars, 0) / ratings.length).toFixed(1)
    : '—'

  return (
    <div className={`cp-shell ${desktopMode ? 'cp-desktop' : 'cp-mobile'}`}>
      {selectedVisit && (
        <div className="cp-overlay" onClick={() => setSelectedVisit(null)}>
          <div className="cp-sheet" onClick={e => e.stopPropagation()}>
            <div className="cp-sheet-handle" />
            <div className="cp-header-row" style={{ marginBottom: 16 }}>
              <div>
                <div className="cp-header-title">{locationFromJob(selectedVisit)}</div>
                <div className="cp-header-meta">{selectedVisit.scheduled_date}</div>
              </div>
              <button type="button" className="cp-logout" onClick={() => setSelectedVisit(null)}>✕</button>
            </div>
            <div className="cp-time-grid" style={{ marginBottom: 16 }}>
              {[
                [c.cleaner, selectedVisit.employee_name || '—'],
                [c.entryTime, fmtVisitTime(selectedVisit, lang)],
                [c.exitTime, fmtVisitEnd(selectedVisit, lang)],
                [c.duration, fmtDuration(selectedVisit.started_at && selectedVisit.completed_at ? Math.round((new Date(selectedVisit.completed_at) - new Date(selectedVisit.started_at)) / 60000) : selectedVisit.retro_time_min, lang)],
              ].map(([l, v]) => (
                <div key={l} className="cp-time-box">
                  <div className="cp-time-lbl">{l}</div>
                  <div className="cp-time-val" style={{ fontSize: 13 }}>{v}</div>
                </div>
              ))}
            </div>
            <div className="cp-field">
              <span className="cp-label">{c.comments}</span>
              <div className="cp-card" style={{ marginBottom: 0, fontSize: 14, lineHeight: 1.55 }}>
                {selectedVisit.notes_employee || selectedVisit.retro_report || c.noComments}
              </div>
            </div>
            {(selectedVisit.photo_start_url || selectedVisit.photo_end_url) && (
              <div className="cp-field">
                <span className="cp-label">{c.photos}</span>
                <JobPhotos
                  photoStartUrl={selectedVisit.photo_start_url}
                  photoEndUrl={selectedVisit.photo_end_url}
                  beforeLabel={c.before}
                  afterLabel={c.after}
                  variant="full"
                  onPhotoClick={setLightbox}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {selectedVisit.photo_start_url && (
                    <a href={viewablePhotoUrl(selectedVisit.photo_start_url)} target="_blank" rel="noreferrer" className="cp-btn" style={{ flex: 1, textAlign: 'center', fontSize: 12, textDecoration: 'none' }}>{c.openPhoto || 'Abrir foto'} ({c.before})</a>
                  )}
                  {selectedVisit.photo_end_url && (
                    <a href={viewablePhotoUrl(selectedVisit.photo_end_url)} target="_blank" rel="noreferrer" className="cp-btn" style={{ flex: 1, textAlign: 'center', fontSize: 12, textDecoration: 'none' }}>{c.openPhoto || 'Abrir foto'} ({c.after})</a>
                  )}
                </div>
              </div>
            )}
            <div className="cp-rating-box">
              <span className="cp-label">{c.rateService}</span>
              <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} type="button" className={`cp-star-btn ${n <= ratingForm.stars ? 'on' : 'off'}`}
                    onClick={() => setRatingForm(f => ({ ...f, stars: n }))}>★</button>
                ))}
              </div>
              <textarea className="cp-textarea" value={ratingForm.comment} onChange={e => setRatingForm(f => ({ ...f, comment: e.target.value }))} placeholder={c.ratingComment} rows={2} style={{ marginBottom: 12 }} />
              <FeedbackPhotoField
                label={c.ratingPhotoOptional}
                attachLabel={c.attachPhotoOptional}
                removeLabel={c.removePhoto}
                file={ratingPhoto}
                preview={ratingPhotoPreview}
                existingUrl={ratingForJob(selectedVisit.id)?.photo_url}
                onPick={pickRatingPhoto}
                onClear={clearRatingPhoto}
                onViewExisting={setLightbox}
              />
              <button type="button" className="cp-btn cp-btn-gold" onClick={() => submitRating(selectedVisit)} disabled={submittingRating}>
                {ratingForJob(selectedVisit.id) ? c.updateRating : c.submitRating}
              </button>
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} closeLabel={c.close} />
      )}

      <div className="cp-layout">
        {desktopMode && (
          <aside className="cp-sidebar">
            <div className="cp-brand">
              <div className="cp-brand-tag">KuriPuro</div>
              <div className="cp-brand-name">{user.client_name || user.name}</div>
              <div className="cp-brand-sub">{user.location_name || c.allLocations}</div>
            </div>
            <nav className="cp-side-nav">
              {navItems.map(n => (
                <button key={n.key} type="button" className={`cp-side-btn${tab === n.key ? ' active' : ''}`} onClick={() => setTab(n.key)}>
                  <span className="cp-side-icon">{n.icon}</span>
                  {n.label}
                  {n.badge > 0 && <span className="cp-nav-badge" style={{ position: 'static', marginLeft: 'auto' }}>{n.badge}</span>}
                </button>
              ))}
            </nav>
            <div className="cp-side-footer">
              <div style={{ marginBottom: 10 }}><LanguageToggle variant="light" /></div>
              <button type="button" className="cp-view-toggle" onClick={toggleView} style={{ width: '100%' }}>
                📱 {c.mobileView}
              </button>
              <button type="button" className="cp-logout" onClick={logout} style={{ width: '100%' }}>{c.logout}</button>
            </div>
          </aside>
        )}

        <div className="cp-main">
          <header className={`cp-header cpx-header${tab === 'home' ? ' is-home' : ''}`}>
            <div className="cp-header-row">
              <div className="cp-header-mobile-only cpx-brand">
                <span className="cpx-kp">KP</span>
                <span>KuriPuro · {c.portal}</span>
              </div>
              {desktopMode && tab !== 'home' && (
                <div>
                  <div className="cp-header-title">{navItems.find(n => n.key === tab)?.label || c.home}</div>
                  <div className="cp-header-meta">
                    {tab === 'visits' ? `${visitRange.from} — ${visitRange.to}` : today}
                  </div>
                </div>
              )}
              <div className="cp-header-actions">
                <LanguageToggle variant="light" />
                {!desktopMode && (
                  <button type="button" className="cpx-icon-btn" onClick={toggleView} title={c.desktopView} aria-label={c.desktopView}>
                    <NavIcon name="desktop" />
                  </button>
                )}
                {!desktopMode && (
                  <button type="button" className="cpx-icon-btn is-logout" onClick={logout} title={c.logout} aria-label={c.logout}>
                    <NavIcon name="logout" />
                  </button>
                )}
              </div>
            </div>
            {tab !== 'home' && !desktopMode && (
              <div className="cpx-hello is-tab"><h1>{navItems.find(n => n.key === tab)?.label}</h1></div>
            )}
            {tab === 'home' && (
              <div className="cpx-hello">
                <small>{greeting}{lang === 'ja' ? '' : ','}</small>
                <h1>{user.client_name || user.name}</h1>
                <div className="cpx-hello-meta">
                  <span className="cpx-chip"><NavIcon name="pin" />{user.location_name || c.allLocations}</span>
                  <span className="cpx-chip"><NavIcon name="calendar" />{clock.toLocaleDateString(dateLocale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Tokyo' })}</span>
                </div>
              </div>
            )}
            {tab === 'home' && !loading && (
              <div className="cpx-kpis">
                <div className="cpx-kpi" style={{ '--tone': '#3b62f0' }}>
                  <span>{c.statVisits}</span>
                  <strong>{completed.length}</strong>
                </div>
                <div className="cpx-kpi" style={{ '--tone': '#f59e0b' }}>
                  <span>{c.statRating}</span>
                  <strong>{avgRating}{avgRating !== '—' && <em>★</em>}</strong>
                </div>
                <div className="cpx-kpi" style={{ '--tone': '#16a34a' }}>
                  <span>{c.statToday}</span>
                  <strong>{todayJobs.length}</strong>
                </div>
                <div className="cpx-kpi" style={{ '--tone': '#0ea5a4' }}>
                  <span>{c.statMonth}</span>
                  <strong>{monthDoneCount}</strong>
                </div>
              </div>
            )}
          </header>

          <main className="cp-content">
            {loading ? (
              <div className="cp-loading">{c.loading}</div>
            ) : tab === 'home' && (
              <>
                <BillingAlerts invoices={invoices} today={today} labels={c} lang={lang} onOpen={() => setTab('billing')} />
                {maintAlerts.length > 0 && (
                  <button type="button" className={`cpx-alert ${maintOverdue ? 'is-warn' : 'is-info'}`} onClick={() => setTab('stores')}>
                    <b>🛠</b>
                    <span>
                      <strong>{fill(c.maintAlert, { count: maintAlerts.length })}</strong>
                      <small>{maintAlerts.slice(0, 3).map(a => `${lang === 'ja' ? a.ja : a.en} · ${a.location}`).join(' / ')}</small>
                    </span>
                  </button>
                )}
                <CleaningProgressCard
                  basic={basicSummary}
                  deep={deepSummary}
                  weeks={weeklyDone}
                  labels={c}
                  scopeLabel={deepProgress?.scope === 'location' ? deepProgress.location : (user.location_name || c.allLocations)}
                  monthLabel={deepProgressMonthLabel}
                  onPrev={() => setDeepProgressMonth(m => shiftMonth(m, -1))}
                  onNext={() => setDeepProgressMonth(m => shiftMonth(m, 1))}
                  canNext={deepProgressMonth < currentYearMonth()}
                />
                <ManagerCard client={clientRow} labels={c} compact />
                <div className="cp-section-title cpx-section">{c.today} <small>{today}</small></div>
                <div className="cp-visit-grid">
                  {todayJobs.length === 0
                    ? <PortalEmpty icon="✨" text={c.noVisitsToday} />
                    : todayJobs.map(j => (
                      <VisitCard
                        key={j.id}
                        job={j}
                        labels={c}
                        lang={lang}
                        statusLabel={statusLabel}
                        statusClass={statusClass}
                        cardStatusClass={cardStatusClass}
                        rating={ratingForJob(j.id)}
                        onPhotoClick={setLightbox}
                        onClick={j.status === 'completed' ? () => setSelectedVisit(j) : undefined}
                      />
                    ))}
                </div>
                {upcoming.length > 0 && (
                  <>
                    <div className="cp-section-title cpx-section" style={{ marginTop: 24 }}>{c.upcoming}</div>
                    <div className="cp-visit-grid">
                      {upcoming.map(j => (
                        <VisitCard
                          key={j.id}
                          job={j}
                          labels={c}
                          lang={lang}
                          statusLabel={statusLabel}
                          statusClass={statusClass}
                          cardStatusClass={cardStatusClass}
                          rating={ratingForJob(j.id)}
                          onPhotoClick={setLightbox}
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}

            {!loading && tab === 'visits' && (
              <>
                <div className="cp-period-bar">
                  <div className="cp-period-label">📅 {c.visitPeriod}</div>
                  <div className="cp-period-pills">
                    {[
                      ['month', c.visitThisMonth],
                      ['lastMonth', c.visitLastMonth],
                      ['90d', c.visitLast90],
                      ['all', c.visitAll],
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        className={`cp-period-pill${visitPreset === key ? ' active' : ''}`}
                        onClick={() => applyVisitPreset(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="cp-period-inputs">
                    <label>
                      {c.visitFrom}
                      <input
                        type="date"
                        className="cp-input"
                        value={visitRange.from}
                        max={visitRange.to}
                        onChange={e => {
                          setVisitPreset('custom')
                          setVisitRange(r => ({ ...r, from: e.target.value }))
                        }}
                      />
                    </label>
                    <label>
                      {c.visitTo}
                      <input
                        type="date"
                        className="cp-input"
                        value={visitRange.to}
                        min={visitRange.from}
                        max={today}
                        onChange={e => {
                          setVisitPreset('custom')
                          setVisitRange(r => ({ ...r, to: e.target.value }))
                        }}
                      />
                    </label>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <label className="cp-period-label" style={{ marginBottom: 6 }}>{c.visitPeriod}</label>
                    <input
                      type="month"
                      className="cp-input"
                      value={visitRange.from.slice(0, 7)}
                      max={today.slice(0, 7)}
                      onChange={e => {
                        const bounds = monthBounds(e.target.value)
                        const to = bounds.to > today ? today : bounds.to
                        setVisitPreset('custom')
                        setVisitRange({ from: bounds.from, to })
                      }}
                    />
                  </div>
                </div>

                <div className="cp-period-stats">
                  <div className="cp-period-stat">
                    <div className="cp-period-stat-val">{visitStats.count}</div>
                    <div className="cp-period-stat-lbl">{c.visitTotalVisits}</div>
                  </div>
                  <div className="cp-period-stat">
                    <div className="cp-period-stat-val">{fmtDuration(visitStats.minutes, lang)}</div>
                    <div className="cp-period-stat-lbl">{c.visitTotalHours}</div>
                  </div>
                  <div className="cp-period-stat">
                    <div className="cp-period-stat-val">{fmtDuration(visitStats.avg, lang)}</div>
                    <div className="cp-period-stat-lbl">{c.visitAvgDuration}</div>
                  </div>
                </div>

                <div className="cp-section-title"><span>📋</span> {c.visits}</div>
                <div className="cp-visit-grid">
                  {filteredVisits.length === 0
                    ? <PortalEmpty icon="📋" text={completed.length === 0 ? c.noVisits : c.noVisitsInPeriod} />
                    : filteredVisits.map(j => (
                      <VisitCard
                        key={j.id}
                        job={j}
                        labels={c}
                        lang={lang}
                        statusLabel={statusLabel}
                        statusClass={statusClass}
                        cardStatusClass={cardStatusClass}
                        rating={ratingForJob(j.id)}
                        onPhotoClick={setLightbox}
                        onClick={() => setSelectedVisit(j)}
                      />
                    ))}
                </div>
              </>
            )}

            {!loading && tab === 'billing' && (
              <BillingView invoices={invoices} today={today} labels={c} lang={lang} clientName={clientRow?.company_name || user.client_name} />
            )}
            {!loading && tab === 'stores' && (
              <StoresView clientId={user.client_id} locations={storeNames} jobs={jobs} profiles={profiles} records={maintRecords}
                today={today} labels={c} lang={lang} userName={user.contact_name || user.name} onChanged={() => loadAll({ silent: true })} onQuote={openQuote} />
            )}
            {!loading && tab === 'chat' && <ManagerCard client={clientRow} labels={c} />}
            {!loading && tab === 'chat' && (
              <div className="cp-chat">
                <div className="cp-chat-msgs">
                  {messages.length === 0 && <PortalEmpty icon="💬" text={c.noMessages} />}
                  {messages.map(m => (
                    <div key={m.id} className={`cp-bubble ${m.sender === 'client' ? 'client' : 'admin'}`}>
                      {m.content}
                      <div className="cp-bubble-time">
                        {new Date(m.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  ))}
                  <div ref={msgEndRef} />
                </div>
                <div className="cp-chat-input-row">
                  <input className="cp-input cp-chat-input" value={newMsg} onChange={e => setNewMsg(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendMessage()} placeholder={c.messagePlaceholder} />
                  <button type="button" className="cp-chat-send" onClick={sendMessage} disabled={!newMsg.trim()}>{c.sendMessage}</button>
                </div>
              </div>
            )}

            {!loading && tab === 'complaints' && (
              <>
                <div className="cp-pills">
                  <button type="button" className={`cp-pill${feedbackTab === 'complaints' ? ' active-red' : ''}`} onClick={() => setFeedbackTab('complaints')}>⚠️ {c.complaints}</button>
                  <button type="button" className={`cp-pill${feedbackTab === 'compliments' ? ' active-green' : ''}`} onClick={() => setFeedbackTab('compliments')}>👏 {c.compliments}</button>
                </div>
                {feedbackTab === 'complaints' && (
                  <>
                    <button type="button" className="cp-btn cp-btn-red" style={{ marginBottom: 16 }} onClick={() => setShowComplaintForm(!showComplaintForm)}>⚠️ {c.newComplaint}</button>
                    {showComplaintForm && (
                      <div className="cp-card" style={{ marginBottom: 16 }}>
                        <div className="cp-field">
                          <span className="cp-label">{c.complaintAbout}</span>
                          <select className="cp-select" value={complaintForm.job_id} onChange={e => setComplaintForm(f => ({ ...f, job_id: e.target.value }))}>
                            <option value="">{c.generalComplaint}</option>
                            {completed.map(j => <option key={j.id} value={j.id}>{locationFromJob(j)} · {j.scheduled_date}</option>)}
                          </select>
                        </div>
                        <div className="cp-field">
                          <span className="cp-label">{c.complaintCategory}</span>
                          <select className="cp-select" value={complaintForm.category} onChange={e => setComplaintForm(f => ({ ...f, category: e.target.value }))}>
                            <option value="quality">{c.catQuality}</option>
                            <option value="missed">{c.catMissed}</option>
                            <option value="damage">{c.catDamage}</option>
                            <option value="late">{c.catLate}</option>
                            <option value="other">{c.catOther}</option>
                          </select>
                        </div>
                        <div className="cp-field">
                          <span className="cp-label">{c.complaintDesc}</span>
                          <textarea className="cp-textarea" value={complaintForm.description} onChange={e => setComplaintForm(f => ({ ...f, description: e.target.value }))} rows={4} />
                        </div>
                        <FeedbackPhotoField
                          label={c.attachPhotoOptional}
                          attachLabel={c.attachPhotoOptional}
                          removeLabel={c.removePhoto}
                          file={complaintPhoto}
                          preview={complaintPhotoPreview}
                          onPick={pickComplaintPhoto}
                          onClear={clearComplaintPhoto}
                        />
                        <button type="button" className="cp-btn cp-btn-gold" onClick={submitComplaint} disabled={submittingComplaint}>
                          {submittingComplaint ? c.loading : c.submitComplaint}
                        </button>
                      </div>
                    )}
                    <div className="cp-section-title">{c.complaintHistory}</div>
                    {complaints.length === 0 ? <PortalEmpty icon="✅" text={c.noComplaints} /> : complaints.map(cp => (
                      <div key={cp.id} className="cp-card">
                        <div className="cp-card-top">
                          <span style={{ color: '#f87171', fontWeight: 700, fontSize: 12 }}>{complaintCat(cp.category)}</span>
                          <span className={`cp-badge ${cp.status === 'resolved' ? 'done' : 'progress'}`}>{cp.status === 'resolved' ? c.statusResolved : c.statusOpen}</span>
                        </div>
                        <div className="cp-card-date" style={{ margin: '8px 0' }}>{cp.location_name} · {new Date(cp.created_at).toLocaleDateString('ja-JP')}</div>
                        <div style={{ fontSize: 14, lineHeight: 1.5 }}>{cp.description}</div>
                        {cp.photo_url && (
                          <button type="button" onClick={() => setLightbox(cp.photo_url)} style={{ marginTop: 10, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}>
                            <img src={viewablePhotoUrl(cp.photo_url)} alt="" style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover' }} />
                          </button>
                        )}
                      </div>
                    ))}
                  </>
                )}
                {feedbackTab === 'compliments' && (
                  <>
                    <button type="button" className="cp-btn cp-btn-green" style={{ marginBottom: 16 }} onClick={() => setShowComplimentForm(!showComplimentForm)}>👏 {c.newCompliment}</button>
                    {showComplimentForm && (
                      <div className="cp-card" style={{ marginBottom: 16 }}>
                        <div className="cp-field">
                          <span className="cp-label">{c.complimentAbout}</span>
                          <select className="cp-select" value={complimentForm.job_id} onChange={e => setComplimentForm(f => ({ ...f, job_id: e.target.value }))}>
                            <option value="">{c.generalCompliment}</option>
                            {completed.map(j => <option key={j.id} value={j.id}>{locationFromJob(j)} · {j.scheduled_date}</option>)}
                          </select>
                        </div>
                        <div className="cp-field">
                          <span className="cp-label">{c.complimentDesc}</span>
                          <textarea className="cp-textarea" value={complimentForm.message} onChange={e => setComplimentForm(f => ({ ...f, message: e.target.value }))} rows={4} />
                        </div>
                        <button type="button" className="cp-btn cp-btn-gold" onClick={submitCompliment}>{c.submitCompliment}</button>
                      </div>
                    )}
                    <div className="cp-section-title">{c.complimentHistory}</div>
                    {compliments.length === 0 ? <PortalEmpty icon="👏" text={c.noCompliments} /> : compliments.map(cm => (
                      <div key={cm.id} className="cp-card status-completed">
                        <div className="cp-card-date" style={{ marginBottom: 8 }}>{cm.location_name} · {new Date(cm.created_at).toLocaleDateString('ja-JP')}</div>
                        <div style={{ fontSize: 14, lineHeight: 1.5 }}>👏 {cm.message}</div>
                      </div>
                    ))}
                  </>
                )}
              </>
            )}

            {!loading && tab === 'requests' && (
              <div className="cpx-stack">
                {!showRequestForm && (
                  <button type="button" className="cp-btn cp-btn-blue" onClick={() => { setQuoteDefaults({}); setShowRequestForm(true) }}>+ {c.newQuoteOrRequest}</button>
                )}
                {showRequestForm && (
                  <QuoteForm locations={storeNames} defaults={quoteDefaults} labels={c} lang={lang}
                    onSubmit={submitRequest} onCancel={() => { setShowRequestForm(false); setQuoteDefaults({}) }} />
                )}
                <div className="cp-section-title cpx-section">{c.requestHistory}</div>
                {requests.length === 0 ? <PortalEmpty icon="📝" text={c.noRequests} /> : requests.map(rq => (
                  <RequestCard key={rq.id} rq={rq} labels={c} lang={lang} onDecide={decideQuote} />
                ))}
              </div>
            )}

            {!loading && tab === 'settings' && (
              <>
                <div className="cp-section-title">{c.settingsTitle}</div>
                <div className="cp-card" style={{ marginBottom: 16 }}>
                  <div className="cp-field">
                    <span className="cp-label">{c.company}</span>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{user.client_name}</div>
                  </div>
                  {user.location_name && (
                    <div className="cp-field">
                      <span className="cp-label">{c.store}</span>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{user.location_name}</div>
                    </div>
                  )}
                  <div className="cp-field">
                    <span className="cp-label">{c.email}</span>
                    <div style={{ fontSize: 14 }}>{user.email}</div>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text3)', margin: '0 0 12px', lineHeight: 1.5 }}>{c.loginHint}</p>
                </div>
                <div className="cp-card">
                  <div className="cp-field">
                    <span className="cp-label">{c.currentPassword}</span>
                    <input type="password" className="cp-input" value={credForm.currentPassword} onChange={e => setCredForm(f => ({ ...f, currentPassword: e.target.value }))} autoComplete="current-password" />
                  </div>
                  <div className="cp-field">
                    <span className="cp-label">{c.newEmail}</span>
                    <input type="email" className="cp-input" value={credForm.newEmail} onChange={e => setCredForm(f => ({ ...f, newEmail: e.target.value }))} placeholder={user.email} autoComplete="email" />
                  </div>
                  <div className="cp-field">
                    <span className="cp-label">{c.newPassword}</span>
                    <input type="password" className="cp-input" value={credForm.newPassword} onChange={e => setCredForm(f => ({ ...f, newPassword: e.target.value }))} autoComplete="new-password" />
                  </div>
                  <button type="button" className="cp-btn cp-btn-gold" onClick={saveCredentials} disabled={savingCreds}>
                    {savingCreds ? c.loading : c.saveCredentials}
                  </button>
                </div>
              </>
            )}
          </main>

          {!desktopMode && (
            <>
            <nav className="cp-bottom-nav">
              <div className="cp-nav-pill">
                {navItems.filter(n => bottomKeys.includes(n.key)).map(n => (
                  <button key={n.key} type="button" className={`cp-nav-btn${tab === n.key ? ' active' : ''}`} onClick={() => setTab(n.key)}>
                    <span className="cp-nav-icon">{n.icon}</span>
                    {n.badge > 0 && <span className="cp-nav-badge">{n.badge}</span>}
                    <span className="cp-nav-label">{n.label}</span>
                  </button>
                ))}
                <button type="button" className={`cp-nav-btn${moreItems.some(n => n.key === tab) ? ' active' : ''}`} onClick={() => setMoreOpen(true)}>
                  <span className="cp-nav-icon"><NavIcon name="more" /></span>
                  <span className="cp-nav-label">{c.moreTab}</span>
                </button>
              </div>
            </nav>
            {moreOpen && (
              <div className="cp-overlay" onClick={() => setMoreOpen(false)}>
                <div className="cp-sheet cpx-more" onClick={e => e.stopPropagation()}>
                  <strong>{c.moreTab}</strong>
                  {moreItems.map(n => (
                    <button key={n.key} type="button" onClick={() => { setTab(n.key); setMoreOpen(false) }}>
                      <span>{n.icon}</span>{n.label}{n.badge > 0 && <b>{n.badge}</b>}
                    </button>
                  ))}
                  <button type="button" onClick={logout} className="is-logout"><span><NavIcon name="logout" /></span>{c.logout}</button>
                </div>
              </div>
            )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function FeedbackPhotoField({
  label,
  attachLabel,
  removeLabel,
  file,
  preview,
  existingUrl,
  onPick,
  onClear,
  onViewExisting,
}) {
  const thumb = preview || (existingUrl ? viewablePhotoUrl(existingUrl) : null)
  return (
    <div className="cp-field">
      <span className="cp-label">{label}</span>
      {thumb && (
        <button
          type="button"
          onClick={() => existingUrl && !file && onViewExisting?.(existingUrl)}
          style={{ display: 'block', marginBottom: 8, padding: 0, border: 'none', background: 'none', cursor: existingUrl && !file && onViewExisting ? 'pointer' : 'default' }}
        >
          <img src={thumb} alt="" style={{ width: 72, height: 72, borderRadius: 10, objectFit: 'cover' }} />
        </button>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'inline-block', padding: '10px 14px', borderRadius: 10, border: '1px dashed rgba(255,255,255,0.2)', color: file ? '#4ade80' : 'rgba(255,255,255,0.65)', cursor: 'pointer', fontSize: 13 }}>
          {file ? `✅ ${file.name.slice(0, 22)}` : `📷 ${attachLabel}`}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) onPick(f)
              e.target.value = ''
            }}
          />
        </label>
        {file && (
          <button type="button" className="cp-btn" onClick={onClear}>{removeLabel}</button>
        )}
      </div>
    </div>
  )
}

const ICON_PATHS = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  visits: 'M8 4h8M8 4a2 2 0 0 0-2 2v0H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-1v0a2 2 0 0 0-2-2M8 12l2.5 2.5L16 9',
  chat: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z',
  complaints: 'M12 3l9.5 17h-19zM12 10v4M12 17.5v.5',
  requests: 'M5 4h10l4 4v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 12h8M8 16h5',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4z',
  desktop: 'M3 5h18v11H3zM8 20h8M12 16v4',
  logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3',
  pin: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  billing: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  store: 'M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
}

function NavIcon({ name }) {
  return (
    <svg className="cpx-ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATHS[name]} />
    </svg>
  )
}

function ProgressRow({ title, summary, labels, tone }) {
  const { total, done, scheduled, missed, notScheduled, pct } = summary
  const seg = n => `${total ? (n / total) * 100 : 0}%`
  return (
    <div className="cpx-prog-row" style={{ '--tone': tone }}>
      <div className="cpx-prog-top">
        <div>
          <strong>{title}</strong>
          <small>{total ? fill(labels.progressDoneOf, { done, total }) : labels.noCleaningMonth}</small>
        </div>
        <b>{Math.min(100, pct)}%</b>
      </div>
      <div className="cpx-prog-bar" role="img" aria-label={`${title}: ${done}/${total}`}>
        <i className="is-done" style={{ width: seg(done) }} />
        <i className="is-sched" style={{ width: seg(scheduled) }} />
        <i className="is-missed" style={{ width: seg(missed) }} />
        <i className="is-none" style={{ width: seg(notScheduled) }} />
      </div>
      {total > 0 && (
        <div className="cpx-prog-legend">
          <span><i className="is-done" />{labels.segDone} {done}</span>
          {scheduled > 0 && <span><i className="is-sched" />{labels.segScheduled} {scheduled}</span>}
          {missed > 0 && <span><i className="is-missed" />{labels.segMissed} {missed}</span>}
          {notScheduled > 0 && <span><i className="is-none" />{labels.segNotScheduled} {notScheduled}</span>}
        </div>
      )}
    </div>
  )
}

function CleaningProgressCard({ basic, deep, weeks, labels, scopeLabel, monthLabel, onPrev, onNext, canNext }) {
  const max = Math.max(1, ...weeks.map(w => w.basic + w.deep))
  const showDeep = deep.total > 0
  return (
    <section className="cpx-progress">
      <header className="cpx-prog-head">
        <div>
          <h2>{labels.progressTitle}</h2>
          <small>{scopeLabel}</small>
        </div>
        <div className="cpx-month">
          <button type="button" onClick={onPrev} aria-label={labels.prevMonth}>‹</button>
          <span>{monthLabel}</span>
          <button type="button" onClick={onNext} disabled={!canNext} aria-label={labels.nextMonth}>›</button>
        </div>
      </header>
      <ProgressRow title={labels.basicCleaningLbl} summary={basic} labels={labels} tone="#3b62f0" />
      {showDeep && <ProgressRow title={labels.deepCleaningLbl} summary={deep} labels={labels} tone="#0c1c30" />}
      <div className="cpx-weeks">
        <div className="cpx-weeks-head">
          <span>{labels.weeklyTitle}</span>
          <span className="cpx-weeks-key"><i className="is-basic" />{labels.basicCleaningLbl}{showDeep && <><i className="is-deep" />{labels.deepCleaningLbl}</>}</span>
        </div>
        <div className="cpx-weeks-plot">
          {weeks.map(w => (
            <div key={w.from} className="cpx-week" title={`${fill(labels.weekDays, w)} · ${w.basic + w.deep}`}>
              <b>{w.basic + w.deep || ''}</b>
              <div className="cpx-week-bar">
                <i className="is-deep" style={{ height: `${(w.deep / max) * 100}%` }} />
                <i className="is-basic" style={{ height: `${(w.basic / max) * 100}%` }} />
              </div>
              <small>{fill(labels.weekDays, w)}</small>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function PortalEmpty({ icon, text }) {
  return (
    <div className="cp-empty">
      <div className="cp-empty-icon">{icon}</div>
      <div className="cp-empty-text">{text}</div>
    </div>
  )
}

function VisitCard({
  job,
  labels,
  lang,
  statusLabel,
  statusClass,
  cardStatusClass,
  rating,
  onClick,
  onPhotoClick,
}) {
  return (
    <div
      className={`cp-card ${cardStatusClass(job.status)}${onClick ? ' clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="cp-card-top">
        <div>
          <div className="cp-card-loc">{locationFromJob(job)}</div>
          <div className="cp-card-date">{job.scheduled_date} · {job.scheduled_time || '—'}</div>
        </div>
        <span className={`cp-badge ${statusClass(job.status)}`}>{statusLabel(job.status)}</span>
      </div>
      {job.employee_name && (
        <div className="cp-card-cleaner">👤 {labels.cleaner}: <b>{job.employee_name}</b></div>
      )}
      {(job.started_at || job.status === 'completed') && (
        <div className="cp-time-grid">
          <div className="cp-time-box">
            <div className="cp-time-lbl">{labels.entryTime}</div>
            <div className="cp-time-val">{fmtVisitTime(job, lang)}</div>
          </div>
          <div className="cp-time-box">
            <div className="cp-time-lbl">{labels.exitTime}</div>
            <div className="cp-time-val">{fmtVisitEnd(job, lang)}</div>
          </div>
        </div>
      )}
      {job.status === 'completed' && (job.photo_start_url || job.photo_end_url) && (
        <div style={{ marginTop: 10 }} onClick={e => e.stopPropagation()}>
          <JobPhotos
            photoStartUrl={job.photo_start_url}
            photoEndUrl={job.photo_end_url}
            beforeLabel={labels.before}
            afterLabel={labels.after}
            size={52}
            onPhotoClick={onPhotoClick}
          />
        </div>
      )}
      {onClick && <div className="cp-card-link">{labels.viewDetails} →</div>}
      {rating && <div className="cp-stars">{'★'.repeat(rating.stars)}{'☆'.repeat(5 - rating.stars)}</div>}
    </div>
  )
}
