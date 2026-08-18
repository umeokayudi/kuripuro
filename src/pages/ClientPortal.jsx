import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useLang } from '../hooks/useLang'
import { fmtDuration } from '../lib/jobReport'
import { viewablePhotoUrl } from '../lib/photoUrl'
import StorageImage from '../components/StorageImage'
import {
  jobMatchesClientUser, locationFromJob, fmtVisitTime, fmtVisitEnd, ratingMatchesClientUser,
} from '../lib/clientPortal'
import { updateClientCredentials } from '../lib/clientCredentials'
import toast from 'react-hot-toast'
import './client-portal.css'

const tokyoToday = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).split(' ')[0]

export default function ClientPortal() {
  const { user, logout, updateSession } = useAuth()
  const { lang, switchLang, t: tr } = useLang()
  const c = tr.client
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

  const [complaintForm, setComplaintForm] = useState({ job_id: '', category: 'quality', description: '' })
  const [requestForm, setRequestForm] = useState({ location_name: '', description: '', preferred_date: '' })
  const [showComplaintForm, setShowComplaintForm] = useState(false)
  const [showComplimentForm, setShowComplimentForm] = useState(false)
  const [showRequestForm, setShowRequestForm] = useState(false)
  const [ratingForm, setRatingForm] = useState({ stars: 5, comment: '' })
  const [complimentForm, setComplimentForm] = useState({ job_id: '', message: '' })
  const [submittingRating, setSubmittingRating] = useState(false)
  const [credForm, setCredForm] = useState({ currentPassword: '', newEmail: '', newPassword: '' })
  const [savingCreds, setSavingCreds] = useState(false)

  const msgEndRef = useRef()

  const toggleView = () => {
    const next = !desktopMode
    setDesktopMode(next)
    localStorage.setItem('cp_view_mode', next ? 'desktop' : 'mobile')
  }

  useEffect(() => {
    if (!localStorage.getItem('kp_lang') && lang !== 'ja') switchLang('ja')
  }, [])

  useEffect(() => {
    loadAll()
    const tick = setInterval(() => setClock(new Date()), 1000)
    const refresh = setInterval(loadAll, 20000)
    return () => { clearInterval(tick); clearInterval(refresh) }
  }, [user?.id])

  useEffect(() => {
    if (tab === 'chat') {
      markMessagesRead()
      setTimeout(() => msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 150)
    }
  }, [tab, messages])

  useEffect(() => {
    if (!selectedVisit) return
    const existing = ratings.find(r => r.job_id === selectedVisit.id)
    if (existing) setRatingForm({ stars: existing.stars, comment: existing.comment || '' })
    else setRatingForm({ stars: 5, comment: '' })
  }, [selectedVisit?.id, ratings])

  const filterByLocation = (rows) => {
    if (!user?.location_name) return rows || []
    return (rows || []).filter(r => !r.location_name || r.location_name === user.location_name)
  }

  const loadAll = async () => {
    if (!user?.client_id) return
    const since = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0]

    const [jobsRes, contractsRes, msgsRes, compRes, cmplRes, ratRes, reqRes] = await Promise.all([
      supabase.from('jobs').select('*').eq('client_id', user.client_id).gte('scheduled_date', since).order('scheduled_date', { ascending: false }).limit(200),
      supabase.from('service_contracts').select('location_name').eq('client_id', user.client_id).eq('is_active', true),
      supabase.from('client_messages').select('*').eq('client_id', user.client_id).order('created_at').limit(100),
      supabase.from('client_complaints').select('*').eq('client_id', user.client_id).order('created_at', { ascending: false }).limit(30),
      supabase.from('client_compliments').select('*').eq('client_id', user.client_id).order('created_at', { ascending: false }).limit(30),
      supabase.from('client_ratings').select('*').eq('client_id', user.client_id).order('created_at', { ascending: false }).limit(100),
      supabase.from('client_requests').select('*').eq('client_id', user.client_id).order('created_at', { ascending: false }).limit(30),
    ])

    setJobs((jobsRes.data || []).filter(j => jobMatchesClientUser(j, user)))
    setContracts(contractsRes.data || [])
    setMessages(filterByLocation(msgsRes.data))
    setComplaints(filterByLocation(compRes.data))
    setCompliments(filterByLocation(cmplRes.data))
    setRatings((ratRes.data || []).filter(r => ratingMatchesClientUser(r, user)))
    setRequests(filterByLocation(reqRes.data))
    setUnreadMsgs(filterByLocation(msgsRes.data).filter(m => m.sender === 'admin' && !m.read).length)
    setLoading(false)
    await supabase.from('client_users').update({ last_seen: new Date().toISOString() }).eq('id', user.id)
  }

  const markMessagesRead = async () => {
    await supabase.from('client_messages').update({ read: true }).eq('client_id', user.client_id).eq('sender', 'admin').eq('read', false)
    setUnreadMsgs(0)
  }

  const sendMessage = async () => {
    if (!newMsg.trim()) return
    const { error } = await supabase.from('client_messages').insert({
      client_id: user.client_id, client_user_id: user.id, client_name: user.client_name,
      location_name: user.location_name, sender: 'client', content: newMsg.trim(), read: false,
    })
    if (error) return toast.error(error.message)
    setNewMsg('')
    loadAll()
  }

  const submitComplaint = async () => {
    if (!complaintForm.description.trim()) return toast.error(c.complaintDesc)
    const job = jobs.find(j => j.id === complaintForm.job_id)
    const { error } = await supabase.from('client_complaints').insert({
      client_id: user.client_id, client_user_id: user.id, job_id: complaintForm.job_id || null,
      location_name: job ? locationFromJob(job) : user.location_name, employee_name: job?.employee_name || null,
      category: complaintForm.category, description: complaintForm.description.trim(), status: 'open',
    })
    if (error) return toast.error(error.message)
    toast.success(c.complaintSent)
    setComplaintForm({ job_id: '', category: 'quality', description: '' })
    setShowComplaintForm(false)
    loadAll()
  }

  const submitRating = async (job) => {
    if (!ratingForm.stars) return
    setSubmittingRating(true)
    const { error } = await supabase.from('client_ratings').upsert({
      client_id: user.client_id, client_user_id: user.id, job_id: job.id,
      employee_name: job.employee_name, location_name: locationFromJob(job),
      stars: ratingForm.stars, comment: ratingForm.comment.trim() || null,
    }, { onConflict: 'job_id' })
    setSubmittingRating(false)
    if (error) return toast.error(error.message)
    toast.success(c.ratingSent)
    setRatingForm({ stars: 5, comment: '' })
    loadAll()
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
    loadAll()
  }

  const saveCredentials = async () => {
    if (!credForm.currentPassword.trim()) return toast.error(c.currentPassword)
    if (!credForm.newEmail.trim() && !credForm.newPassword.trim()) {
      return toast.error(c.newEmail)
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
    setShowRequestForm(false)
    loadAll()
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

  const VisitCard = ({ job, onClick }) => {
    const rating = ratingForJob(job.id)
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
          <div className="cp-card-cleaner">👤 {c.cleaner}: <b>{job.employee_name}</b></div>
        )}
        {(job.started_at || job.status === 'completed') && (
          <div className="cp-time-grid">
            <div className="cp-time-box">
              <div className="cp-time-lbl">{c.entryTime}</div>
              <div className="cp-time-val">{fmtVisitTime(job, lang)}</div>
            </div>
            <div className="cp-time-box">
              <div className="cp-time-lbl">{c.exitTime}</div>
              <div className="cp-time-val">{fmtVisitEnd(job, lang)}</div>
            </div>
          </div>
        )}
        {onClick && <div className="cp-card-link">{c.viewDetails} →</div>}
        {rating && <div className="cp-stars">{'★'.repeat(rating.stars)}{'☆'.repeat(5 - rating.stars)}</div>}
      </div>
    )
  }

  const Empty = ({ icon, text }) => (
    <div className="cp-empty">
      <div className="cp-empty-icon">{icon}</div>
      <div className="cp-empty-text">{text}</div>
    </div>
  )

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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {selectedVisit.photo_start_url && (
                    <div>
                      <div className="cp-time-lbl" style={{ marginBottom: 6 }}>{c.before}</div>
                      <StorageImage url={selectedVisit.photo_start_url} alt={c.before} onClick={() => setLightbox(selectedVisit.photo_start_url)} />
                      <a href={viewablePhotoUrl(selectedVisit.photo_start_url)} target="_blank" rel="noreferrer" className="cp-btn" style={{ marginTop: 8, display: 'block', textAlign: 'center', fontSize: 12, textDecoration: 'none' }}>{c.openPhoto || 'Abrir foto'}</a>
                    </div>
                  )}
                  {selectedVisit.photo_end_url && (
                    <div>
                      <div className="cp-time-lbl" style={{ marginBottom: 6 }}>{c.after}</div>
                      <StorageImage url={selectedVisit.photo_end_url} alt={c.after} onClick={() => setLightbox(selectedVisit.photo_end_url)} />
                      <a href={viewablePhotoUrl(selectedVisit.photo_end_url)} target="_blank" rel="noreferrer" className="cp-btn" style={{ marginTop: 8, display: 'block', textAlign: 'center', fontSize: 12, textDecoration: 'none' }}>{c.openPhoto || 'Abrir foto'}</a>
                    </div>
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
              <button type="button" className="cp-btn cp-btn-gold" onClick={() => submitRating(selectedVisit)} disabled={submittingRating}>
                {ratingForJob(selectedVisit.id) ? c.updateRating : c.submitRating}
              </button>
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <div className="cp-lightbox" onClick={() => setLightbox(null)}>
          <button type="button" className="cp-logout" style={{ position: 'absolute', top: 16, right: 16 }} onClick={() => setLightbox(null)}>✕ {c.close}</button>
          <img src={viewablePhotoUrl(lightbox)} alt="" onClick={e => e.stopPropagation()} />
        </div>
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
              <button type="button" className="cp-view-toggle" onClick={toggleView} style={{ width: '100%' }}>
                📱 {lang === 'ja' ? 'モバイル表示' : 'Mobile view'}
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
                  <div className="cp-header-meta">{today}</div>
                </div>
              )}
              <div className="cp-header-actions">
                {!desktopMode && (
                  <button type="button" className="cp-view-toggle" onClick={toggleView}>
                    🖥 {lang === 'ja' ? 'PC' : 'PC'}
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
                  <div className="cp-stat-val">{completed.length}</div>
                  <div className="cp-stat-lbl">{c.visits}</div>
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
            {loading && <div className="cp-loading">{c.loading}</div>}

            {!loading && tab === 'home' && (
              <>
                <div className="cp-section-title"><span>📅</span> {c.today} — {today}</div>
                <div className="cp-visit-grid">
                  {todayJobs.length === 0
                    ? <Empty icon="✨" text={c.noVisitsToday} />
                    : todayJobs.map(j => <VisitCard key={j.id} job={j} onClick={j.status === 'completed' ? () => setSelectedVisit(j) : undefined} />)}
                </div>
                {upcoming.length > 0 && (
                  <>
                    <div className="cp-section-title" style={{ marginTop: 24 }}><span>🗓</span> {c.upcoming}</div>
                    <div className="cp-visit-grid">
                      {upcoming.map(j => <VisitCard key={j.id} job={j} />)}
                    </div>
                  </>
                )}
              </>
            )}

            {!loading && tab === 'visits' && (
              <>
                <div className="cp-section-title"><span>📋</span> {c.visits}</div>
                <div className="cp-visit-grid">
                  {completed.length === 0
                    ? <Empty icon="📋" text={c.noVisits} />
                    : completed.map(j => <VisitCard key={j.id} job={j} onClick={() => setSelectedVisit(j)} />)}
                </div>
              </>
            )}

            {!loading && tab === 'chat' && (
              <div className="cp-chat">
                <div className="cp-chat-msgs">
                  {messages.length === 0 && <Empty icon="💬" text={c.noMessages} />}
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
                        <button type="button" className="cp-btn cp-btn-gold" onClick={submitComplaint}>{c.submitComplaint}</button>
                      </div>
                    )}
                    <div className="cp-section-title">{c.complaintHistory}</div>
                    {complaints.length === 0 ? <Empty icon="✅" text={c.noComplaints} /> : complaints.map(cp => (
                      <div key={cp.id} className="cp-card">
                        <div className="cp-card-top">
                          <span style={{ color: '#f87171', fontWeight: 700, fontSize: 12 }}>{complaintCat(cp.category)}</span>
                          <span className={`cp-badge ${cp.status === 'resolved' ? 'done' : 'progress'}`}>{cp.status === 'resolved' ? c.statusResolved : c.statusOpen}</span>
                        </div>
                        <div className="cp-card-date" style={{ margin: '8px 0' }}>{cp.location_name} · {new Date(cp.created_at).toLocaleDateString('ja-JP')}</div>
                        <div style={{ fontSize: 14, lineHeight: 1.5 }}>{cp.description}</div>
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
                            <option value="">{c.generalComplaint}</option>
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
                    {compliments.length === 0 ? <Empty icon="👏" text={c.noCompliments} /> : compliments.map(cm => (
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
              <>
                <button type="button" className="cp-btn cp-btn-blue" style={{ marginBottom: 16 }} onClick={() => setShowRequestForm(!showRequestForm)}>📝 {c.newRequest}</button>
                {showRequestForm && (
                  <div className="cp-card" style={{ marginBottom: 16 }}>
                    {locations.length > 1 && (
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
                <div className="cp-section-title">{c.requestHistory}</div>
                {requests.length === 0 ? <Empty icon="📝" text={c.noRequests} /> : requests.map(rq => (
                  <div key={rq.id} className="cp-card">
                    <div className="cp-card-top">
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{rq.ticket_number || `#${rq.id.slice(0, 8)}`}</span>
                      <span className={`cp-badge ${rq.status === 'completed' ? 'done' : 'progress'}`}>{rq.status === 'completed' ? c.statusDone : c.statusPending}</span>
                    </div>
                    <div className="cp-card-date" style={{ margin: '8px 0' }}>{rq.location_name || c.allLocations}</div>
                    <div style={{ fontSize: 14, lineHeight: 1.5 }}>{rq.description}</div>
                  </div>
                ))}
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
