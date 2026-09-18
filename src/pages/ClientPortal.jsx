import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useLang, fill } from '../hooks/useLang'
import LanguageToggle from '../components/LanguageToggle'
import {
  buildDaySummaries,
  buildDeepCleanProgressForUser,
  currentYearMonth,
  deepComponentLabel,
  filterDeepCleanProgressByLocation,
  formatScheduleDate,
  monthCalendarCells,
  ONTHEPLANET_CLIENT_ID,
  parseDeepComponents,
  storeProgressRows,
  tuesdaySlotInfo,
  getCleaningType,
} from '../lib/cleaningType'
import { fmtDuration, jobDurationMin } from '../lib/jobReport'
import { viewablePhotoUrl } from '../lib/photoUrl'
import JobPhotos from '../components/JobPhotos'
import PhotoLightbox from '../components/PhotoLightbox'
import {
  jobMatchesClientUser, locationFromJob, fmtVisitTime, fmtVisitEnd, ratingMatchesClientUser,
  filterClientVisits, monthCompletedCount, visibleInvoices, unpaidInvoices,
} from '../lib/clientPortal'
import { extrasForLocation, extraLabel, extraHint, formatYen, packExtraRequest, packPaymentNotice, parseExtraRequest } from '../lib/clientExtras'
import { updateClientCredentials } from '../lib/clientCredentials'
import toast from 'react-hot-toast'
import { tokyoToday, addCalendarDays } from '../lib/dates'
import { uploadJobPhoto } from '../lib/uploadPhoto'
import './client-portal.css'

function sanitizePostgrestToken(value) {
  return String(value || '').replace(/[%(),.\\]/g, '').trim()
}

const filterByLocation = (rows, locationName) => {
  if (!locationName) return rows || []
  return (rows || []).filter(r => r.location_name === locationName)
}

function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number)
  const from = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { from, to }
}

function shiftYearMonth(ym, delta) {
  const [y, m] = String(ym || '').split('-').map(Number)
  if (!y || !m) return ym
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function mergeJobLists(prev, incoming) {
  const map = new Map()
  ;(prev || []).forEach(j => { if (j?.id) map.set(j.id, j) })
  ;(incoming || []).forEach(j => { if (j?.id) map.set(j.id, j) })
  return [...map.values()].sort((a, b) => String(b.scheduled_date || '').localeCompare(String(a.scheduled_date || '')))
}

function visitRangeForPreset(preset, today) {
  if (preset === 'all') return { from: '2000-01-01', to: today }
  if (preset === '90d') {
    const from = addCalendarDays(today, -90)
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
  const [feedbackTab, setFeedbackTab] = useState('complaints')
  const [newMsg, setNewMsg] = useState('')
  const [selectedVisit, setSelectedVisit] = useState(null)
  const [lightbox, setLightbox] = useState(null)
  const [unreadMsgs, setUnreadMsgs] = useState(0)
  const [loading, setLoading] = useState(true)
  const [clock, setClock] = useState(new Date())
  const [visitPreset, setVisitPreset] = useState('month')
  const [visitRange, setVisitRange] = useState(() => visitRangeForPreset('month', tokyoToday()))
  const [visitType, setVisitType] = useState('all')
  const [visitStore, setVisitStore] = useState('')
  const [visitUnratedOnly, setVisitUnratedOnly] = useState(false)
  const [requestTab, setRequestTab] = useState('extras')
  const [extraNotes, setExtraNotes] = useState('')
  const [extraDate, setExtraDate] = useState('')
  const [extraLocation, setExtraLocation] = useState('')
  const [bookingExtra, setBookingExtra] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [deepProgressMonth, setDeepProgressMonth] = useState(currentYearMonth)
  const [deepProgressStore, setDeepProgressStore] = useState('')
  const loadedOnceRef = useRef(false)

  const [complaintForm, setComplaintForm] = useState({ job_id: '', category: 'quality', description: '' })
  const [requestForm, setRequestForm] = useState({ location_name: '', description: '', preferred_date: '' })
  const [showComplaintForm, setShowComplaintForm] = useState(false)
  const [showComplimentForm, setShowComplimentForm] = useState(false)
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
    const since = addCalendarDays(tokyoToday(), -365)
    if (!silent && !loadedOnceRef.current) setLoading(true)

    try {
      const locToken = sanitizePostgrestToken(user.location_name)
      const locOrFilter = locToken
        ? `client_id.eq.${user.client_id},and(client_id.is.null,title.ilike.%${locToken}%)`
        : `client_id.eq.${user.client_id},and(client_id.is.null,client_name.eq.On The Planet)`
      const monthRange = monthBounds(deepProgressMonth)
      const [jobsMonthRes, jobsRecentRes, contractsRes, msgsRes, compRes, cmplRes, ratRes, reqRes, invRes] = await Promise.all([
        supabase.from('jobs').select('*').or(locOrFilter).gte('scheduled_date', monthRange.from).lte('scheduled_date', monthRange.to).limit(800),
        supabase.from('jobs').select('*').or(locOrFilter).gte('scheduled_date', since).order('scheduled_date', { ascending: false }).limit(250),
        supabase.from('service_contracts').select('location_name').eq('client_id', user.client_id).eq('is_active', true),
        supabase.from('client_messages').select('*').eq('client_id', user.client_id).order('created_at').limit(100),
        supabase.from('client_complaints').select('*').eq('client_id', user.client_id).order('created_at', { ascending: false }).limit(30),
        supabase.from('client_compliments').select('*').eq('client_id', user.client_id).order('created_at', { ascending: false }).limit(30),
        supabase.from('client_ratings').select('*').eq('client_id', user.client_id).order('created_at', { ascending: false }).limit(100),
        supabase.from('client_requests').select('*').eq('client_id', user.client_id).order('created_at', { ascending: false }).limit(30),
        supabase.from('faturas').select('*').eq('client_id', user.client_id).order('issue_date', { ascending: false }).limit(24),
      ])

      const firstErr = [jobsMonthRes, jobsRecentRes, contractsRes, msgsRes, compRes, cmplRes, ratRes, reqRes]
        .map(r => r.error?.message)
        .find(Boolean)
      if (firstErr?.includes('client_') || firstErr?.includes('PGRST205')) {
        toast.error('Portal tables missing. Ask admin to run portal setup in Clients.')
      } else if (firstErr) {
        toast.error(firstErr)
      }

      setJobs(mergeJobLists(
        (jobsRecentRes.data || []).filter(j => jobMatchesClientUser(j, user)),
        (jobsMonthRes.data || []).filter(j => jobMatchesClientUser(j, user)),
      ))
      setContracts(contractsRes.data || [])
      setMessages(filterByLocation(msgsRes.data, user.location_name))
      setComplaints(filterByLocation(compRes.data, user.location_name))
      setCompliments(filterByLocation(cmplRes.data, user.location_name))
      setRatings((ratRes.data || []).filter(r => ratingMatchesClientUser(r, user)))
      setRequests(filterByLocation(reqRes.data, user.location_name))
      setInvoices(visibleInvoices(invRes.error ? [] : (invRes.data || [])))
      setUnreadMsgs(filterByLocation(msgsRes.data, user.location_name).filter(m => m.sender === 'admin' && !m.read).length)
      await supabase.from('client_users').update({ last_seen: new Date().toISOString() }).eq('id', user.id)
    } catch (err) {
      toast.error(err?.message || 'Failed to load portal data')
    } finally {
      setLoading(false)
      loadedOnceRef.current = true
    }
  }, [user, c?.sessionExpired, deepProgressMonth])

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
    loadAll({ silent: loadedOnceRef.current })
    const refresh = setInterval(() => loadAll({ silent: true }), 20000)
    return () => clearInterval(refresh)
  }, [user?.id, c, loadAll])

  useEffect(() => {
    const tick = setInterval(() => setClock(new Date()), 60000)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    if (!selectedVisit && !lightbox) return
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (lightbox) {
        setLightbox(null)
        return
      }
      setSelectedVisit(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedVisit, lightbox])

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
    const ratedJobIds = new Set(ratings.map(r => r.job_id).filter(Boolean))
    return filterClientVisits(jobs, {
      from: visitRange.from,
      to: visitRange.to,
      type: visitType,
      store: visitStore,
      unratedOnly: visitUnratedOnly,
      ratedJobIds,
    })
  }, [jobs, visitRange.from, visitRange.to, visitType, visitStore, visitUnratedOnly, ratings])

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
  const canSelectDeepStore = isOtpClient && !user?.location_name
  const deepProgressAll = useMemo(() => {
    if (!isOtpClient) return null
    return buildDeepCleanProgressForUser(jobs, deepProgressMonth, {
      ...user,
      location_name: user?.location_name || '',
    })
  }, [jobs, deepProgressMonth, user, isOtpClient])
  const deepProgress = useMemo(() => {
    if (!deepProgressAll) return null
    if (!canSelectDeepStore || !deepProgressStore) return deepProgressAll
    return filterDeepCleanProgressByLocation(deepProgressAll, deepProgressStore)
  }, [deepProgressAll, canSelectDeepStore, deepProgressStore])
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

  const submitRequest = async () => {
    if (!requestForm.description.trim()) return toast.error(c.requestDesc)
    const { error } = await supabase.from('client_requests').insert({
      client_id: user.client_id, client_user_id: user.id,
      location_name: requestForm.location_name || user.location_name || null,
      description: requestForm.description.trim(), preferred_date: requestForm.preferred_date || null,
      status: 'pending', ticket_number: `KP-${Date.now().toString(36).toUpperCase().slice(-6)}`,
    })
    if (error) return toast.error(error.message)
    toast.success(c.requestSent)
    setRequestForm({ location_name: user.location_name || '', description: '', preferred_date: '' })
    loadAll({ silent: true })
  }

  const bookExtra = async (extra) => {
    const loc = extraLocation || user.location_name || ''
    if (!loc) return toast.error(c.requestLocation)
    const description = packExtraRequest({
      extraId: extra.id,
      price: extra.price,
      locationName: loc,
      notes: extraNotes,
    })
    const { error } = await supabase.from('client_requests').insert({
      client_id: user.client_id, client_user_id: user.id,
      location_name: loc,
      description,
      preferred_date: extraDate || null,
      status: 'pending', ticket_number: `KP-${Date.now().toString(36).toUpperCase().slice(-6)}`,
    })
    if (error) return toast.error(error.message)
    toast.success(c.extraBooked)
    setExtraNotes('')
    setBookingExtra(null)
    setRequestTab('history')
    loadAll({ silent: true })
  }

  const markInvoicePaid = async (invoice) => {
    const { error } = await supabase.from('client_requests').insert({
      client_id: user.client_id, client_user_id: user.id,
      location_name: user.location_name || null,
      description: packPaymentNotice({
        faturaId: invoice.id,
        total: invoice.total,
        period: `${invoice.period_start || ''} – ${invoice.period_end || invoice.issue_date || ''}`,
      }),
      status: 'pending', ticket_number: `KP-${Date.now().toString(36).toUpperCase().slice(-6)}`,
    })
    if (error) return toast.error(error.message)
    toast.success(c.invoicePaidSent)
    setRequestTab('history')
    setTab('requests')
    loadAll({ silent: true })
  }

  const downloadVisitPdf = async (job) => {
    const preview = typeof window !== 'undefined' ? window.open('', '_blank') : null
    const toastId = toast.loading(c.generatingPdf)
    try {
      const { saveServiceReportPdf } = await import('../lib/generatePDF')
      await saveServiceReportPdf(job, { lang, labels: c, previewWindow: preview })
      toast.success(c.pdfReady, { id: toastId })
    } catch (err) {
      try { preview?.close() } catch {}
      toast.error(err?.message || c.pdfFailed, { id: toastId })
    }
  }

  const applyVisitPreset = (preset) => {
    setVisitPreset(preset)
    setVisitRange(visitRangeForPreset(preset, tokyoToday()))
  }

  const today = tokyoToday()
  const todayJobs = jobs.filter(j => j.scheduled_date === today && j.status !== 'cancelled')
  const upcoming = jobs.filter(j => j.scheduled_date > today && j.status !== 'cancelled').slice(0, 10)
  const completed = jobs.filter(j => j.status === 'completed')
  const monthDone = monthCompletedCount(jobs, today.slice(0, 7))
  const ratedIds = new Set(ratings.map(r => r.job_id).filter(Boolean))
  const unratedCount = completed.filter(j => !ratedIds.has(j.id)).length
  const billsDue = unpaidInvoices(invoices)
  const locations = [...new Set([
    ...(user.location_name ? [user.location_name] : []),
    ...contracts.map(ct => ct.location_name).filter(Boolean),
    ...jobs.map(j => locationFromJob(j)).filter(Boolean),
  ])]
  const extraLoc = extraLocation || user.location_name || locations[0] || ''
  const extraCatalog = extrasForLocation(extraLoc)

  const statusLabel = (s) => ({ assigned: tr.status.assigned, in_progress: tr.status.in_progress, completed: tr.status.completed, cancelled: tr.status.cancelled }[s] || s)
  const statusClass = (s) => ({ completed: 'done', in_progress: 'progress', assigned: 'pending', cancelled: 'cancelled' }[s] || 'pending')
  const cardStatusClass = (s) => ({ completed: 'status-completed', in_progress: 'status-progress', assigned: 'status-assigned', cancelled: 'status-cancelled' }[s] || 'status-assigned')
  const complaintCat = (k) => ({ quality: c.catQuality, missed: c.catMissed, damage: c.catDamage, late: c.catLate, other: c.catOther }[k] || k)
  const ratingForJob = (jobId) => ratings.find(r => r.job_id === jobId)

  const navItems = [
    { key: 'home', icon: '🏠', label: c.home },
    { key: 'visits', icon: '📋', label: c.visits },
    { key: 'chat', icon: '💬', label: c.chat, badge: unreadMsgs },
    { key: 'complaints', icon: '⚠️', label: c.complaints },
    { key: 'requests', icon: '📝', label: c.requests },
    { key: 'settings', icon: '⚙️', label: c.settings },
  ]

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
                <div className="cp-header-meta">{selectedVisit.scheduled_date} · {getCleaningType(selectedVisit) === 'deep' ? c.filterDeep : c.filterBasic}</div>
              </div>
              <button type="button" className="cp-logout" onClick={() => setSelectedVisit(null)}>✕</button>
            </div>
            <div className="cp-time-grid" style={{ marginBottom: 16 }}>
              {[
                [c.cleaner, selectedVisit.employee_name || '—'],
                [c.entryTime, fmtVisitTime(selectedVisit, lang)],
                [c.exitTime, fmtVisitEnd(selectedVisit, lang)],
                [c.duration, fmtDuration(jobDurationMin(selectedVisit), lang)],
              ].map(([l, v]) => (
                <div key={l} className="cp-time-box">
                  <div className="cp-time-lbl">{l}</div>
                  <div className="cp-time-val" style={{ fontSize: 13 }}>{v}</div>
                </div>
              ))}
            </div>
            {['completed', 'in_progress'].includes(selectedVisit.status) && parseDeepComponents(selectedVisit).length > 0 && (
              <div className="cp-field">
                <span className="cp-label">{c.deepCleanParts}</span>
                <div className="cp-comp-row">
                  {parseDeepComponents(selectedVisit).map(id => (
                    <span key={id} className="cp-comp-chip">{deepComponentLabel(id, lang)}</span>
                  ))}
                </div>
              </div>
            )}
            {selectedVisit.checklist_total > 0 && (
              <div className="cp-field">
                <span className="cp-label">{c.checklist}</span>
                <div className="cp-card" style={{ marginBottom: 0, fontSize: 13 }}>
                  {fill(c.deepCleanChecklistLine, {
                    done: selectedVisit.checklist_done || 0,
                    total: selectedVisit.checklist_total,
                  })}
                </div>
              </div>
            )}
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
                    <a href={viewablePhotoUrl(selectedVisit.photo_start_url)} target="_blank" rel="noreferrer" className="cp-btn" style={{ flex: 1, textAlign: 'center', fontSize: 12, textDecoration: 'none' }}>{c.openPhoto} ({c.before})</a>
                  )}
                  {selectedVisit.photo_end_url && (
                    <a href={viewablePhotoUrl(selectedVisit.photo_end_url)} target="_blank" rel="noreferrer" className="cp-btn" style={{ flex: 1, textAlign: 'center', fontSize: 12, textDecoration: 'none' }}>{c.openPhoto} ({c.after})</a>
                  )}
                </div>
              </div>
            )}
            <button type="button" className="cp-btn cp-btn-gold" style={{ width: '100%', marginBottom: 14 }} onClick={() => downloadVisitPdf(selectedVisit)}>
              📄 {c.downloadPdf}
            </button>
            {selectedVisit.status === 'completed' && (
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
            )}
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
              <div style={{ marginBottom: 10 }}><LanguageToggle variant="dark" /></div>
              <button type="button" className="cp-view-toggle" onClick={toggleView} style={{ width: '100%' }}>
                📱 {c.mobileView}
              </button>
              <button type="button" className="cp-logout" onClick={logout} style={{ width: '100%' }}>{c.logout}</button>
            </div>
          </aside>
        )}

        <div className="cp-main">
          <header className="cp-header">
            <div className="cp-header-row">
              <div className="cp-header-mobile-only">
                <div className="cp-brand-tag">KuriPuro · {c.portal}</div>
                <div className="cp-header-title">{user.client_name || user.name}</div>
                <div className="cp-header-meta">
                  {user.location_name || c.allLocations} · {clock.toLocaleDateString(dateLocale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Tokyo' })}
                </div>
              </div>
              {desktopMode && (
                <div>
                  <div className="cp-header-title">{navItems.find(n => n.key === tab)?.label || c.home}</div>
                  <div className="cp-header-meta">
                    {tab === 'visits' ? `${visitRange.from} — ${visitRange.to}` : today}
                  </div>
                </div>
              )}
              <div className="cp-header-actions">
                <LanguageToggle variant="dark" />
                {desktopMode && (
                  <button type="button" className="cp-view-toggle" onClick={toggleView}>
                    📱 {c.mobileView}
                  </button>
                )}
                {!desktopMode && (
                  <button type="button" className="cp-view-toggle" onClick={toggleView}>
                    🖥 {c.desktopView}
                  </button>
                )}
                {!desktopMode && (
                  <button type="button" className="cp-logout" onClick={logout}>{c.logout}</button>
                )}
              </div>
            </div>
            {tab === 'home' && !loading && (
              <div className="cp-stats">
                <div className="cp-stat">
                  <div className="cp-stat-val">{monthDone}</div>
                  <div className="cp-stat-lbl">{c.visitThisMonth}</div>
                </div>
                <div className="cp-stat">
                  <div className="cp-stat-val">{avgRating}</div>
                  <div className="cp-stat-lbl">★ {lang === 'ja' ? '評価' : 'Rating'}</div>
                </div>
                <div className="cp-stat">
                  <div className="cp-stat-val">{todayJobs.length}</div>
                  <div className="cp-stat-lbl">{c.today}</div>
                </div>
              </div>
            )}
          </header>

          <main className="cp-content">
            {loading ? (
              <div className="cp-loading">{c.loading}</div>
            ) : tab === 'home' && (
              <>
                <div className="cp-quick-row">
                  <button type="button" className="cp-quick" onClick={() => { setTab('requests'); setRequestTab('extras') }}>
                    <span>✨</span>
                    <b>{c.bookExtra}</b>
                    <small>{c.bookExtraHint}</small>
                  </button>
                  <button type="button" className="cp-quick" onClick={() => { setTab('visits'); setVisitUnratedOnly(true); applyVisitPreset('month') }}>
                    <span>★</span>
                    <b>{unratedCount}</b>
                    <small>{c.unratedVisits}</small>
                  </button>
                  <button type="button" className="cp-quick" onClick={() => { setTab('requests'); setRequestTab('bills') }}>
                    <span>💴</span>
                    <b>{billsDue.length}</b>
                    <small>{c.invoicesDue}</small>
                  </button>
                </div>
                {isOtpClient && deepProgress?.scope !== 'none' && deepProgress.totals.expected > 0 && (
                  <DeepCleanProgressCard
                    progress={deepProgress}
                    allByLocation={canSelectDeepStore ? deepProgressAll?.byLocation : null}
                    labels={c}
                    lang={lang}
                    today={today}
                    monthLabel={deepProgressMonthLabel}
                    progressMonth={deepProgressMonth}
                    onMonthChange={setDeepProgressMonth}
                    canSelectStore={canSelectDeepStore}
                    selectedStore={deepProgressStore}
                    onStoreChange={setDeepProgressStore}
                    onVisitClick={j => setSelectedVisit(j)}
                    onPhotoClick={setLightbox}
                  />
                )}
                <div className="cp-section-title"><span>📅</span> {c.today} — {today}</div>
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
                    <div className="cp-section-title" style={{ marginTop: 24 }}><span>🗓</span> {c.upcoming}</div>
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
                  <div className="cp-period-pills" style={{ marginTop: 12 }}>
                    {[
                      ['all', c.visitAll],
                      ['basic', c.filterBasic],
                      ['deep', c.filterDeep],
                    ].map(([key, label]) => (
                      <button key={key} type="button" className={`cp-period-pill${visitType === key ? ' active' : ''}`} onClick={() => setVisitType(key)}>
                        {label}
                      </button>
                    ))}
                    <button type="button" className={`cp-period-pill${visitUnratedOnly ? ' active' : ''}`} onClick={() => setVisitUnratedOnly(v => !v)}>
                      ★ {c.unratedVisits}
                    </button>
                  </div>
                  {locations.length > 1 && (
                    <div style={{ marginTop: 10 }}>
                      <select className="cp-select" value={visitStore} onChange={e => setVisitStore(e.target.value)}>
                        <option value="">{c.allLocations}</option>
                        {locations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                      </select>
                    </div>
                  )}
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
                        {cp.admin_response && (
                          <div className="cp-admin-reply">
                            <div className="cp-label">{c.adminResponse}</div>
                            <div>{cp.admin_response}</div>
                          </div>
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
                        {cm.admin_response && (
                          <div className="cp-admin-reply">
                            <div className="cp-label">{c.adminResponse}</div>
                            <div>{cm.admin_response}</div>
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </>
            )}

            {!loading && tab === 'requests' && (
              <>
                <div className="cp-pills">
                  <button type="button" className={`cp-pill${requestTab === 'extras' ? ' active-green' : ''}`} onClick={() => setRequestTab('extras')}>✨ {c.bookExtra}</button>
                  <button type="button" className={`cp-pill${requestTab === 'custom' ? ' active-green' : ''}`} onClick={() => setRequestTab('custom')}>📝 {c.newRequest}</button>
                  <button type="button" className={`cp-pill${requestTab === 'bills' ? ' active-green' : ''}`} onClick={() => setRequestTab('bills')}>💴 {c.invoices}{billsDue.length ? ` (${billsDue.length})` : ''}</button>
                  <button type="button" className={`cp-pill${requestTab === 'history' ? ' active-green' : ''}`} onClick={() => setRequestTab('history')}>{c.requestHistory}</button>
                </div>

                {requestTab === 'extras' && (
                  <>
                    <p className="cp-muted-copy">{c.bookExtraIntro}</p>
                    {locations.length > 1 && (
                      <div className="cp-field">
                        <span className="cp-label">{c.requestLocation}</span>
                        <select className="cp-select" value={extraLoc} onChange={e => setExtraLocation(e.target.value)}>
                          {locations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                        </select>
                      </div>
                    )}
                    <div className="cp-extra-grid">
                      {extraCatalog.map(ex => (
                        <button
                          key={ex.id}
                          type="button"
                          className={`cp-extra-card${bookingExtra?.id === ex.id ? ' on' : ''}`}
                          onClick={() => setBookingExtra(ex)}
                        >
                          <div className="cp-extra-icon">{ex.icon}</div>
                          <div className="cp-extra-name">{extraLabel(ex.id, lang)}</div>
                          <div className="cp-extra-price">{formatYen(ex.price)}</div>
                          <div className="cp-extra-hint">{extraHint(ex.id, lang)}</div>
                        </button>
                      ))}
                    </div>
                    {bookingExtra && (
                      <div className="cp-card" style={{ marginTop: 12 }}>
                        <div className="cp-label">{extraLabel(bookingExtra.id, lang)} · {formatYen(bookingExtra.price)}</div>
                        <div className="cp-field" style={{ marginTop: 10 }}>
                          <span className="cp-label">{c.requestDate}</span>
                          <input type="date" className="cp-input" min={today} value={extraDate} onChange={e => setExtraDate(e.target.value)} />
                        </div>
                        <div className="cp-field">
                          <span className="cp-label">{c.extraNotes}</span>
                          <textarea className="cp-textarea" rows={3} value={extraNotes} onChange={e => setExtraNotes(e.target.value)} placeholder={c.extraNotesPh} />
                        </div>
                        <button type="button" className="cp-btn cp-btn-gold" onClick={() => bookExtra(bookingExtra)}>{c.confirmExtra} · {formatYen(bookingExtra.price)}</button>
                      </div>
                    )}
                  </>
                )}

                {requestTab === 'custom' && (
                  <div className="cp-card" style={{ marginBottom: 16 }}>
                    {locations.length > 1 && !user.location_name && (
                      <div className="cp-field">
                        <span className="cp-label">{c.requestLocation}</span>
                        <select className="cp-select" value={requestForm.location_name} onChange={e => setRequestForm(f => ({ ...f, location_name: e.target.value }))}>
                          <option value="">{c.allLocations}</option>
                          {locations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                        </select>
                      </div>
                    )}
                    <div className="cp-field">
                      <span className="cp-label">{c.requestDesc}</span>
                      <textarea className="cp-textarea" value={requestForm.description} onChange={e => setRequestForm(f => ({ ...f, description: e.target.value }))} rows={4} />
                    </div>
                    <div className="cp-field">
                      <span className="cp-label">{c.requestDate}</span>
                      <input type="date" className="cp-input" value={requestForm.preferred_date} onChange={e => setRequestForm(f => ({ ...f, preferred_date: e.target.value }))} />
                    </div>
                    <button type="button" className="cp-btn cp-btn-gold" onClick={submitRequest}>{c.submitRequest}</button>
                  </div>
                )}

                {requestTab === 'bills' && (
                  <>
                    <p className="cp-muted-copy">{c.invoicesHint}</p>
                    {invoices.length === 0 ? <PortalEmpty icon="💴" text={c.noInvoices} /> : invoices.map(inv => (
                      <div key={inv.id} className="cp-card">
                        <div className="cp-card-top">
                          <div>
                            <div className="cp-card-loc">{inv.period_start && inv.period_end ? `${inv.period_start} – ${inv.period_end}` : inv.issue_date}</div>
                            <div className="cp-card-date">{c.invoiceIssued}: {inv.issue_date || '—'}{inv.due_date ? ` · ${c.invoiceDue}: ${inv.due_date}` : ''}</div>
                          </div>
                          <span className={`cp-badge ${inv.status === 'paid' ? 'done' : 'progress'}`}>
                            {inv.status === 'paid' ? c.invoicePaid : c.invoiceSent}
                          </span>
                        </div>
                        <div className="cp-extra-price" style={{ margin: '8px 0' }}>{formatYen(inv.total)}</div>
                        {inv.status === 'sent' && (
                          <button type="button" className="cp-btn cp-btn-gold" onClick={() => markInvoicePaid(inv)}>{c.markInvoicePaid}</button>
                        )}
                      </div>
                    ))}
                  </>
                )}

                {requestTab === 'history' && (
                  <>
                    {requests.length === 0 ? <PortalEmpty icon="📝" text={c.noRequests} /> : requests.map(rq => {
                      const extra = parseExtraRequest(rq.description)
                      return (
                        <div key={rq.id} className="cp-card">
                          <div className="cp-card-top">
                            <span style={{ fontWeight: 700, fontSize: 13 }}>{rq.ticket_number || `#${rq.id.slice(0, 8)}`}</span>
                            <span className={`cp-badge ${rq.status === 'completed' ? 'done' : 'progress'}`}>{rq.status === 'completed' ? c.statusDone : c.statusPending}</span>
                          </div>
                          <div className="cp-card-date" style={{ margin: '8px 0' }}>
                            {rq.location_name || extra?.locationName || c.allLocations}
                            {rq.preferred_date ? ` · ${rq.preferred_date}` : ''}
                          </div>
                          {extra ? (
                            <div>
                              <div style={{ fontWeight: 700 }}>{extraLabel(extra.extraId, lang)} · {formatYen(extra.price)}</div>
                              {extra.notes && <div style={{ fontSize: 14, lineHeight: 1.5, marginTop: 6 }}>{extra.notes}</div>}
                            </div>
                          ) : (
                            <div style={{ fontSize: 14, lineHeight: 1.5 }}>{rq.description}</div>
                          )}
                          {rq.admin_notes && (
                            <div className="cp-admin-reply">
                              <div className="cp-label">{c.adminNotes}</div>
                              <div>{rq.admin_notes}</div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </>
                )}
              </>
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
            <nav className="cp-bottom-nav">
              <div className="cp-nav-pill">
                {navItems.map(n => (
                  <button key={n.key} type="button" className={`cp-nav-btn${tab === n.key ? ' active' : ''}`} onClick={() => setTab(n.key)}>
                    <span className="cp-nav-icon">{n.icon}</span>
                    {n.badge > 0 && <span className="cp-nav-badge">{n.badge}</span>}
                    <span className="cp-nav-label">{n.label}</span>
                  </button>
                ))}
              </div>
            </nav>
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

function DeepCleanProgressCard({
  progress,
  allByLocation,
  labels,
  lang,
  today,
  monthLabel,
  progressMonth,
  onMonthChange,
  canSelectStore,
  selectedStore,
  onStoreChange,
  onVisitClick,
  onPhotoClick,
}) {
  const { scope, location } = progress
  const daySummaries = buildDaySummaries(progress.byLocation)
  const dayByDate = Object.fromEntries(daySummaries.map(d => [d.date, d]))
  const cells = monthCalendarCells(progressMonth)
  const expectedDays = daySummaries.length
  const completedDays = daySummaries.filter(d => d.state === 'done').length
  const partialDays = daySummaries.filter(d => d.state === 'partial').length
  const lateDays = daySummaries.filter(d => d.state === 'late').length
  const missingDays = daySummaries.filter(d => d.state === 'missing').length
  const remainingDays = daySummaries.filter(d => !d.past && d.state !== 'done').length
  const donePct = expectedDays ? Math.round((completedDays / expectedDays) * 100) : 0
  const doneShare = expectedDays ? (completedDays / expectedDays) * 100 : 0
  const partialShare = expectedDays ? (partialDays / expectedDays) * 100 : 0
  const lateShare = expectedDays ? (lateDays / expectedDays) * 100 : 0
  const missingShare = expectedDays ? (missingDays / expectedDays) * 100 : 0
  const scopeLabel = scope === 'location' ? location : labels.deepCleanAllStores
  const storeRows = storeProgressRows(allByLocation || {}, today, lang)
  const storeNames = Object.keys(allByLocation || {}).sort((a, b) => a.localeCompare(b))
  const weekdays = lang === 'ja'
    ? ['日', '月', '火', '水', '木', '金', '土']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const slotLabels = {
    slotMissing: labels.deepCleanMissing,
    slotDone: labels.deepCleanDone,
    slotProgress: labels.deepCleanPending,
    slotPending: labels.deepCleanPending,
  }
  const serviceDates = daySummaries.map(d => d.date)

  const [selectedDay, setSelectedDay] = useState(null)
  useEffect(() => {
    const dates = buildDaySummaries(progress.byLocation).map(d => d.date).sort()
    const dateSet = new Set(dates)
    setSelectedDay(prev => {
      if (prev && dateSet.has(prev)) return prev
      if (today && dateSet.has(today)) return today
      const past = dates.filter(d => d <= (today || ''))
      return past[past.length - 1] || dates[0] || null
    })
  }, [progress, today, progressMonth, selectedStore])

  const moveSelectedDay = (delta) => {
    if (!serviceDates.length) return
    const idx = selectedDay ? serviceDates.indexOf(selectedDay) : (delta > 0 ? -1 : serviceDates.length)
    const next = serviceDates[Math.min(serviceDates.length - 1, Math.max(0, idx + delta))]
    if (next) setSelectedDay(next)
  }

  const pickStore = (name) => {
    if (!onStoreChange) return
    onStoreChange(selectedStore === name ? '' : name)
  }

  const selected = selectedDay ? dayByDate[selectedDay] : null
  const selectedLabel = selected
    ? formatScheduleDate(selected.date, lang)
    : monthLabel
  const todaySummary = today && today.startsWith(progressMonth) ? dayByDate[today] : null
  const printSummary = () => window.print()
  const visitDone = progress?.totals?.completed || 0

  return (
    <div className="cp-deep-progress">
      <div className="cp-deep-progress-head">
        <div>
          <div className="cp-deep-progress-title">✨ {labels.deepCleanProgress}</div>
          <div className="cp-deep-progress-sub">
            {scopeLabel} · {fill(labels.deepCleanDaysHint, {
              month: monthLabel,
              days: expectedDays,
              done: completedDays,
              pct: donePct,
            })}
          </div>
        </div>
        <div className="cp-deep-controls">
          {canSelectStore && storeNames.length > 0 && (
            <label className="cp-deep-store-wrap">
              <span className="cp-deep-store-lbl">{labels.store}</span>
              <select
                className="cp-deep-store"
                value={selectedStore || ''}
                onChange={e => onStoreChange(e.target.value)}
                aria-label={labels.deepCleanSelectStore || labels.store}
              >
                <option value="">{labels.deepCleanAllStores}</option>
                {storeNames.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
          )}
          <div className="cp-deep-month-nav" role="group" aria-label={labels.deepCleanProgress}>
            <button
              type="button"
              className="cp-deep-month-btn"
              onClick={() => onMonthChange(shiftYearMonth(progressMonth, -1))}
              aria-label={labels.deepCleanPrevMonth}
            >
              ‹
            </button>
            <span className="cp-deep-month-label">{monthLabel}</span>
            <button
              type="button"
              className="cp-deep-month-btn"
              onClick={() => onMonthChange(shiftYearMonth(progressMonth, 1))}
              aria-label={labels.deepCleanNextMonth}
            >
              ›
            </button>
          </div>
          {today?.startsWith(progressMonth) && todaySummary && selectedDay !== today && (
            <button type="button" className="cp-deep-today" onClick={() => setSelectedDay(today)}>
              {labels.today}
            </button>
          )}
          <button type="button" className="cp-deep-print" onClick={printSummary}>
            {labels.deepCleanPrint}
          </button>
        </div>
      </div>

      <div className="cp-deep-headline">
        <div className="cp-deep-headline-main">
          {fill(labels.deepCleanOfDays, { done: completedDays, expected: expectedDays })}
        </div>
        <div className="cp-deep-headline-pct">{fill(labels.deepCleanPctDone, { pct: donePct })}</div>
        {lateDays > 0 && (
          <div className="cp-deep-headline-pct late">{labels.deepCleanLate} {lateDays}</div>
        )}
        {visitDone > 0 && (
          <div className="cp-deep-headline-visits">
            {fill(labels.deepCleanVisitsDone, { done: visitDone })}
          </div>
        )}
        {remainingDays > 0 && (
          <div className="cp-deep-headline-left">
            {fill(labels.deepCleanRemaining, { n: remainingDays })}
          </div>
        )}
      </div>

      {todaySummary && (
        <button type="button" className={`cp-deep-alert ${todaySummary.state}`} onClick={() => setSelectedDay(today)}>
          <strong>{labels.today}</strong>
          <span>
            {todaySummary.state === 'missing'
              ? fill(labels.deepCleanTodayMissing, { expected: todaySummary.expected })
              : fill(labels.deepCleanTodayLine, {
                  done: todaySummary.done,
                  expected: todaySummary.expected,
                  late: todaySummary.overdueCount,
                })}
          </span>
        </button>
      )}

      <div className="cp-cal-weekdays">
        {weekdays.map(w => (
          <div key={w} className="cp-cal-wd">{w}</div>
        ))}
      </div>
      <div
        className="cp-cal"
        role="grid"
        tabIndex={0}
        aria-label={labels.deepCleanProgress}
        onKeyDown={e => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault()
            moveSelectedDay(1)
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault()
            moveSelectedDay(-1)
          } else if (e.key === 'Home' && serviceDates[0]) {
            e.preventDefault()
            setSelectedDay(serviceDates[0])
          } else if (e.key === 'End' && serviceDates.length) {
            e.preventDefault()
            setSelectedDay(serviceDates[serviceDates.length - 1])
          }
        }}
      >
        {cells.map((date, i) => {
          if (!date) return <div key={`pad-${i}`} className="cp-cal-cell pad" />
          const day = dayByDate[date]
          const state = day?.state || 'empty'
          const isToday = date === today
          const isSel = date === selectedDay
          const dayNum = Number(date.slice(-2))
          return (
            <button
              key={date}
              type="button"
              className={`cp-cal-cell ${state}${isToday ? ' today' : ''}${isSel ? ' selected' : ''}`}
              disabled={!day}
              onClick={() => day && setSelectedDay(date)}
              aria-pressed={isSel}
              aria-current={isToday ? 'date' : undefined}
              aria-label={day
                ? `${date} · ${day.done}/${day.expected}`
                : date}
            >
              <span className="cp-cal-num">{dayNum}</span>
              {day && (
                <span className="cp-cal-count">
                  {day.done}/{day.expected}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="cp-cal-legend">
        <span><span className="cp-deep-dot done" /> {labels.deepCleanDone} {completedDays}</span>
        <span><span className="cp-deep-dot pending" /> {labels.deepCleanPending} {partialDays}</span>
        <span><span className="cp-deep-dot late" /> {labels.deepCleanLate} {lateDays}</span>
        <span><span className="cp-deep-dot missing" /> {labels.deepCleanMissing} {missingDays}</span>
      </div>

      <div className="cp-deep-bar stacked" aria-hidden="true">
        <div className="cp-deep-bar-seg done" style={{ width: `${doneShare}%` }} />
        <div className="cp-deep-bar-seg pending" style={{ width: `${partialShare}%` }} />
        <div className="cp-deep-bar-seg late" style={{ width: `${lateShare}%` }} />
        <div className="cp-deep-bar-seg missing" style={{ width: `${missingShare}%` }} />
      </div>

      <div className={`cp-cal-day${selected ? ` ${selected.state}` : ''}`}>
        <div className="cp-cal-day-title">
          {selectedLabel}
          {selected && (
            <span className="cp-cal-day-frac">
              {selected.state === 'late' ? `${labels.deepCleanLate} · ` : ''}
              {selected.done}/{selected.expected} · {selected.pct}%
            </span>
          )}
        </div>
        {!selected && (
          <div className="cp-cal-day-empty">{labels.deepCleanPickDay}</div>
        )}
        {selected && (
          <div className="cp-cal-store-list">
            {selected.stores.map(row => {
              const slot = row.job
                ? tuesdaySlotInfo(row.job, slotLabels)
                : {
                    label: row.past ? labels.deepCleanLate : labels.deepCleanMissing,
                    icon: row.past ? '❌' : '·',
                    color: row.past ? '#f87171' : '#fbbf24',
                  }
              const comps = row.job && ['completed', 'in_progress'].includes(row.job.status)
                ? parseDeepComponents(row.job)
                : []
              const statusText = row.overdue && row.job?.status !== 'completed'
                ? labels.deepCleanLate
                : slot.label
              const canOpen = Boolean(row.job && onVisitClick)
              return (
                <div key={row.name} className={`cp-cal-store${row.job ? ' has-job' : ''}${row.overdue ? ' late' : ''}${canOpen ? '' : ' locked'}`}>
                  <button
                    type="button"
                    className="cp-cal-store-main"
                    disabled={!canOpen}
                    onClick={() => {
                      if (canOpen) onVisitClick(row.job)
                    }}
                  >
                    <span className="cp-cal-store-icon" style={{ color: slot.color }}>{slot.icon}</span>
                    <span className="cp-cal-store-body">
                      <span className="cp-cal-store-name">{row.name}</span>
                      <span className="cp-cal-store-meta">
                        {row.job
                          ? `${row.job.employee_name || '—'} · ${row.job.scheduled_time || '—'}`
                          : row.past ? labels.deepCleanLate : labels.deepCleanMissing}
                      </span>
                      {comps.length > 0 && (
                        <span className="cp-cal-store-comps">
                          {comps.map(id => deepComponentLabel(id, lang)).join(' · ')}
                        </span>
                      )}
                      {row.job?.checklist_total > 0 && (
                        <span className="cp-cal-store-meta">
                          {fill(labels.deepCleanChecklistLine, {
                            done: row.job.checklist_done || 0,
                            total: row.job.checklist_total,
                          })}
                        </span>
                      )}
                    </span>
                    <span className="cp-cal-store-status" style={{ color: row.overdue ? '#f87171' : slot.color }}>{statusText}</span>
                  </button>
                  {row.job?.status === 'completed' && (row.job.photo_start_url || row.job.photo_end_url) && (
                    <div className="cp-cal-store-photos" onClick={e => e.stopPropagation()}>
                      <JobPhotos
                        photoStartUrl={row.job.photo_start_url}
                        photoEndUrl={row.job.photo_end_url}
                        beforeLabel={labels.before}
                        afterLabel={labels.after}
                        size={44}
                        onPhotoClick={onPhotoClick}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {canSelectStore && storeRows.length > 0 && (
        <div className="cp-deep-stores">
          <div className="cp-deep-stores-title">{labels.deepCleanByStore}</div>
          <div className="cp-deep-store-grid">
            {storeRows.map(row => {
              const active = selectedStore === row.name
              return (
                <button
                  key={row.name}
                  type="button"
                  className={`cp-deep-store-card${active ? ' active' : ''}${row.pct >= 100 ? ' ok' : ''}${row.late > 0 ? ' late' : ''}`}
                  onClick={() => pickStore(row.name)}
                >
                  <div className="cp-deep-store-card-top">
                    <span className="cp-deep-store-card-name">{row.name}</span>
                    <span className="cp-deep-store-card-pct">{row.pct}%</span>
                  </div>
                  <div className="cp-deep-store-card-meta">
                    {row.schedule ? `${row.schedule} · ` : ''}
                    {fill(labels.deepCleanOfDays, { done: row.completed, expected: row.expected })}
                    {row.late > 0 ? ` · ${labels.deepCleanLate} ${row.late}` : ''}
                  </div>
                  <div className="cp-deep-store-mini">
                    <div className="cp-deep-store-mini-fill" style={{ width: `${row.pct}%` }} />
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <span className={`cp-badge ${statusClass(job.status)}`}>{statusLabel(job.status)}</span>
          <span className={`cp-type-chip ${getCleaningType(job) === 'deep' ? 'deep' : 'basic'}`}>
            {getCleaningType(job) === 'deep' ? (labels.filterDeep || 'Deep') : (labels.filterBasic || 'Basic')}
          </span>
        </div>
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
