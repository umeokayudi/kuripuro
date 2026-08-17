import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useLang } from '../hooks/useLang'
import { fmtDuration } from '../lib/jobReport'
import { viewablePhotoUrl } from '../lib/photoUrl'
import StorageImage from '../components/StorageImage'
import {
  jobMatchesClientUser, locationFromJob, fmtVisitTime, fmtVisitEnd,
} from '../lib/clientPortal'
import toast from 'react-hot-toast'

const tokyoToday = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).split(' ')[0]

const S = {
  page: { minHeight: '100vh', background: '#060d18', color: '#fff', fontFamily: 'inherit', paddingBottom: 80 },
  header: { padding: '16px 18px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(6,13,24,0.95)', position: 'sticky', top: 0, zIndex: 50 },
  card: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 16, marginBottom: 12 },
  label: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 4, display: 'block' },
  input: { width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#fff', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' },
  bottomNav: { position: 'fixed', bottom: 0, left: 0, right: 0, background: 'rgba(6,13,24,0.97)', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-around', padding: '8px 0 12px', zIndex: 100 },
  tabBtn: (active) => ({ flex: 1, textAlign: 'center', background: 'none', border: 'none', cursor: 'pointer', color: active ? '#c19c56' : 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 600, padding: '4px 0' }),
}

export default function ClientPortal() {
  const { user, logout } = useAuth()
  const { lang, switchLang, t: tr } = useLang()
  const c = tr.client
  const dateLocale = lang === 'ja' ? 'ja-JP' : 'en-GB'

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

  const msgEndRef = useRef()

  useEffect(() => {
    if (lang !== 'ja') switchLang('ja')
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

  const loadAll = async () => {
    if (!user?.client_id) return
    const today = tokyoToday()
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

    const allJobs = (jobsRes.data || []).filter(j => jobMatchesClientUser(j, user))
    setJobs(allJobs)
    setContracts(contractsRes.data || [])
    setMessages(msgsRes.data || [])
    setComplaints(compRes.data || [])
    setCompliments(cmplRes.data || [])
    setRatings(ratRes.data || [])
    setRequests(reqRes.data || [])
    setUnreadMsgs((msgsRes.data || []).filter(m => m.sender === 'admin' && !m.read).length)
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
      client_id: user.client_id,
      client_user_id: user.id,
      client_name: user.client_name,
      location_name: user.location_name,
      sender: 'client',
      content: newMsg.trim(),
      read: false,
    })
    if (error) return toast.error(error.message)
    setNewMsg('')
    loadAll()
  }

  const submitComplaint = async () => {
    if (!complaintForm.description.trim()) return toast.error(c.complaintDesc)
    const job = jobs.find(j => j.id === complaintForm.job_id)
    const { error } = await supabase.from('client_complaints').insert({
      client_id: user.client_id,
      client_user_id: user.id,
      job_id: complaintForm.job_id || null,
      location_name: job ? locationFromJob(job) : (user.location_name || requestForm.location_name),
      employee_name: job?.employee_name || null,
      category: complaintForm.category,
      description: complaintForm.description.trim(),
      status: 'open',
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
      client_id: user.client_id,
      client_user_id: user.id,
      job_id: job.id,
      employee_name: job.employee_name,
      location_name: locationFromJob(job),
      stars: ratingForm.stars,
      comment: ratingForm.comment.trim() || null,
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
      client_id: user.client_id,
      client_user_id: user.id,
      job_id: complimentForm.job_id || null,
      location_name: job ? locationFromJob(job) : user.location_name,
      employee_name: job?.employee_name || null,
      message: complimentForm.message.trim(),
      status: 'new',
    })
    if (error) return toast.error(error.message)
    toast.success(c.complimentSent)
    setComplimentForm({ job_id: '', message: '' })
    setShowComplimentForm(false)
    loadAll()
  }

  const submitRequest = async () => {
    if (!requestForm.description.trim()) return toast.error(c.requestDesc)
    const ticket_number = `KP-${Date.now().toString(36).toUpperCase().slice(-6)}`
    const { error } = await supabase.from('client_requests').insert({
      client_id: user.client_id,
      client_user_id: user.id,
      location_name: requestForm.location_name || user.location_name || null,
      description: requestForm.description.trim(),
      preferred_date: requestForm.preferred_date || null,
      status: 'pending',
      ticket_number,
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
  const complaintCat = (k) => ({ quality: c.catQuality, missed: c.catMissed, damage: c.catDamage, late: c.catLate, other: c.catOther }[k] || k)

  const bottomTabs = [
    { key: 'home', icon: '🏠', label: c.home },
    { key: 'visits', icon: '📋', label: c.visits },
    { key: 'chat', icon: '💬', label: c.chat, badge: unreadMsgs },
    { key: 'complaints', icon: '⚠️', label: c.complaints },
    { key: 'requests', icon: '📝', label: c.requests },
  ]

  const VisitCard = ({ job, onClick }) => (
    <div onClick={onClick} style={{ ...S.card, cursor: onClick ? 'pointer' : 'default', borderLeft: `4px solid ${job.status === 'completed' ? '#4ade80' : job.status === 'in_progress' ? '#fbbf24' : '#60a5fa'}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{locationFromJob(job)}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>{job.scheduled_date} · {job.scheduled_time || '—'}</div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: job.status === 'completed' ? '#4ade80' : job.status === 'in_progress' ? '#fbbf24' : '#60a5fa' }}>
          {statusLabel(job.status)}
        </span>
      </div>
      {job.employee_name && (
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 10 }}>
          👤 {c.cleaner}: <b style={{ color: '#fff' }}>{job.employee_name}</b>
        </div>
      )}
      {(job.started_at || job.status === 'completed') && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
          <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '8px 10px' }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{c.entryTime}</div>
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace' }}>{fmtVisitTime(job, lang)}</div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '8px 10px' }}>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{c.exitTime}</div>
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace' }}>{fmtVisitEnd(job, lang)}</div>
          </div>
        </div>
      )}
      {onClick && <div style={{ fontSize: 11, color: '#c19c56', marginTop: 10, fontWeight: 600 }}>{c.viewDetails} →</div>}
      {job.status === 'completed' && ratingForJob(job.id) && (
        <div style={{ fontSize: 11, color: '#EF9F27', marginTop: 8 }}>{'★'.repeat(ratingForJob(job.id).stars)}{'☆'.repeat(5 - ratingForJob(job.id).stars)}</div>
      )}
    </div>
  )

  useEffect(() => {
    if (!selectedVisit) return
    const existing = ratings.find(r => r.job_id === selectedVisit.id)
    if (existing) setRatingForm({ stars: existing.stars, comment: existing.comment || '' })
    else setRatingForm({ stars: 5, comment: '' })
  }, [selectedVisit?.id, ratings])

  const ratingForJob = (jobId) => ratings.find(r => r.job_id === jobId)

  const VisitDetail = () => {
    if (!selectedVisit) return null
    const j = selectedVisit
    const notes = j.notes_employee || j.retro_report || ''
    const existingRating = ratingForJob(j.id)
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 300, display: 'flex', alignItems: 'flex-end' }} onClick={() => setSelectedVisit(null)}>
        <div style={{ background: '#0a1525', borderRadius: '20px 20px 0 0', padding: '20px 18px 32px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{locationFromJob(j)}</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>{j.scheduled_date}</div>
            </div>
            <button onClick={() => setSelectedVisit(null)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer' }}>✕</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
            {[
              [c.cleaner, j.employee_name || '—'],
              [c.entryTime, fmtVisitTime(j, lang)],
              [c.exitTime, fmtVisitEnd(j, lang)],
              [c.duration, fmtDuration(j.started_at && j.completed_at ? Math.round((new Date(j.completed_at) - new Date(j.started_at)) / 60000) : j.retro_time_min, lang)],
            ].map(([l, v]) => (
              <div key={l} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{l}</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={S.label}>{c.comments}</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '12px 14px' }}>
              {notes || c.noComments}
            </div>
          </div>

          {(j.photo_start_url || j.photo_end_url) && (
            <div style={{ marginBottom: 14 }}>
              <div style={S.label}>{c.photos}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {j.photo_start_url && (
                  <div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>{c.before}</div>
                    <StorageImage url={j.photo_start_url} alt={c.before} onClick={() => setLightbox(j.photo_start_url)} />
                  </div>
                )}
                {j.photo_end_url && (
                  <div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 4 }}>{c.after}</div>
                    <StorageImage url={j.photo_end_url} alt={c.after} onClick={() => setLightbox(j.photo_end_url)} />
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{ background: 'rgba(193,156,86,0.08)', borderRadius: 12, padding: '14px 16px', border: '1px solid rgba(193,156,86,0.2)' }}>
            <div style={S.label}>{c.rateService}</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} type="button" onClick={() => setRatingForm(f => ({ ...f, stars: n }))}
                  style={{ fontSize: 28, background: 'none', border: 'none', cursor: 'pointer', color: n <= ratingForm.stars ? '#EF9F27' : 'rgba(255,255,255,0.2)', padding: 0 }}>
                  ★
                </button>
              ))}
            </div>
            <textarea value={ratingForm.comment} onChange={e => setRatingForm(f => ({ ...f, comment: e.target.value }))} placeholder={c.ratingComment} rows={2} style={{ ...S.input, resize: 'none', marginBottom: 10 }} />
            <button onClick={() => submitRating(j)} disabled={submittingRating} style={{ width: '100%', padding: 12, borderRadius: 10, border: 'none', background: '#c19c56', color: '#0a1929', fontWeight: 700, cursor: 'pointer' }}>
              {existingRating ? c.updateRating : c.submitRating}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={S.page}>
      <VisitDetail />
      {lightbox && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setLightbox(null)}>
          <button onClick={() => setLightbox(null)} style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}>✕ {c.close}</button>
          <img src={viewablePhotoUrl(lightbox)} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '90vh', borderRadius: 8, objectFit: 'contain' }} />
        </div>
      )}

      <header style={S.header}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, color: '#c19c56', fontWeight: 700, letterSpacing: 1 }}>KuriPuro · {c.portal}</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>{user.client_name || user.name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
              {user.location_name || c.allLocations} · {clock.toLocaleDateString(dateLocale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Tokyo' })}
            </div>
          </div>
          <button onClick={logout} style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)', fontSize: 12, cursor: 'pointer' }}>{c.logout}</button>
        </div>
      </header>

      <main style={{ padding: '16px 18px' }}>
        {loading && <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center', padding: 40 }}>{c.loading}</div>}

        {!loading && tab === 'home' && (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 10 }}>📅 {c.today} — {today}</div>
            {todayJobs.length === 0 ? (
              <div style={{ ...S.card, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>{c.noVisitsToday}</div>
            ) : todayJobs.map(j => <VisitCard key={j.id} job={j} onClick={j.status === 'completed' ? () => setSelectedVisit(j) : undefined} />)}

            {upcoming.length > 0 && (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.5)', margin: '20px 0 10px' }}>🗓 {c.upcoming}</div>
                {upcoming.map(j => <VisitCard key={j.id} job={j} />)}
              </>
            )}
          </>
        )}

        {!loading && tab === 'visits' && (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 10 }}>📋 {c.visits}</div>
            {completed.length === 0 ? (
              <div style={{ ...S.card, textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>{c.noVisits}</div>
            ) : completed.map(j => <VisitCard key={j.id} job={j} onClick={() => setSelectedVisit(j)} />)}
          </>
        )}

        {!loading && tab === 'chat' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 180px)' }}>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 12 }}>
              {messages.length === 0 && <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13, paddingTop: 40 }}>{c.noMessages}</div>}
              {messages.map(m => (
                <div key={m.id} style={{ display: 'flex', justifyContent: m.sender === 'client' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '82%', padding: '10px 14px', borderRadius: m.sender === 'client' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                    background: m.sender === 'client' ? 'linear-gradient(135deg,#c19c56,#a8844a)' : 'rgba(255,255,255,0.08)',
                    color: m.sender === 'client' ? '#0a1929' : '#fff',
                  }}>
                    <div style={{ fontSize: 13, lineHeight: 1.5, wordBreak: 'break-word' }}>{m.content}</div>
                    <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4, textAlign: 'right' }}>
                      {new Date(m.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={msgEndRef} />
            </div>
            <div style={{ display: 'flex', gap: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <input value={newMsg} onChange={e => setNewMsg(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMessage()} placeholder={c.messagePlaceholder} style={{ ...S.input, flex: 1, borderRadius: 20 }} />
              <button onClick={sendMessage} disabled={!newMsg.trim()} style={{ padding: '0 18px', borderRadius: 20, border: 'none', background: newMsg.trim() ? '#c19c56' : 'rgba(255,255,255,0.08)', color: newMsg.trim() ? '#0a1929' : 'rgba(255,255,255,0.3)', fontWeight: 700, cursor: 'pointer' }}>{c.sendMessage}</button>
            </div>
          </div>
        )}

        {!loading && tab === 'complaints' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <button onClick={() => setFeedbackTab('complaints')} style={{ flex: 1, padding: 10, borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: feedbackTab === 'complaints' ? 'rgba(248,113,113,0.2)' : 'rgba(255,255,255,0.04)', color: feedbackTab === 'complaints' ? '#f87171' : 'rgba(255,255,255,0.5)' }}>
                ⚠️ {c.complaints}
              </button>
              <button onClick={() => setFeedbackTab('compliments')} style={{ flex: 1, padding: 10, borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, background: feedbackTab === 'compliments' ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.04)', color: feedbackTab === 'compliments' ? '#4ade80' : 'rgba(255,255,255,0.5)' }}>
                👏 {c.compliments}
              </button>
            </div>

            {feedbackTab === 'complaints' && <>
            <button onClick={() => setShowComplaintForm(!showComplaintForm)} style={{ width: '100%', padding: 14, borderRadius: 14, border: 'none', background: 'linear-gradient(135deg,#f87171,#ef4444)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', marginBottom: 14 }}>
              ⚠️ {c.newComplaint}
            </button>

            {showComplaintForm && (
              <div style={{ ...S.card, marginBottom: 16 }}>
                <div style={{ marginBottom: 10 }}>
                  <span style={S.label}>{c.complaintAbout}</span>
                  <select value={complaintForm.job_id} onChange={e => setComplaintForm(f => ({ ...f, job_id: e.target.value }))} style={S.input}>
                    <option value="">{c.generalComplaint}</option>
                    {completed.map(j => <option key={j.id} value={j.id}>{locationFromJob(j)} · {j.scheduled_date}</option>)}
                  </select>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <span style={S.label}>{c.complaintCategory}</span>
                  <select value={complaintForm.category} onChange={e => setComplaintForm(f => ({ ...f, category: e.target.value }))} style={S.input}>
                    <option value="quality">{c.catQuality}</option>
                    <option value="missed">{c.catMissed}</option>
                    <option value="damage">{c.catDamage}</option>
                    <option value="late">{c.catLate}</option>
                    <option value="other">{c.catOther}</option>
                  </select>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <span style={S.label}>{c.complaintDesc}</span>
                  <textarea value={complaintForm.description} onChange={e => setComplaintForm(f => ({ ...f, description: e.target.value }))} rows={4} style={{ ...S.input, resize: 'none' }} />
                </div>
                <button onClick={submitComplaint} style={{ width: '100%', padding: 12, borderRadius: 12, border: 'none', background: '#c19c56', color: '#0a1929', fontWeight: 700, cursor: 'pointer' }}>{c.submitComplaint}</button>
              </div>
            )}

            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 10 }}>{c.complaintHistory}</div>
            {complaints.length === 0 ? <div style={{ ...S.card, color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center' }}>{c.noComplaints}</div> : complaints.map(cp => (
              <div key={cp.id} style={S.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#f87171' }}>{complaintCat(cp.category)}</span>
                  <span style={{ fontSize: 11, color: cp.status === 'resolved' ? '#4ade80' : '#fbbf24' }}>{cp.status === 'resolved' ? c.statusResolved : c.statusOpen}</span>
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>{cp.location_name} · {cp.employee_name || '—'} · {new Date(cp.created_at).toLocaleDateString('ja-JP')}</div>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>{cp.description}</div>
                {cp.admin_response && <div style={{ marginTop: 10, fontSize: 12, background: 'rgba(193,156,86,0.1)', borderRadius: 8, padding: '8px 10px' }}><b>{c.adminResponse}:</b> {cp.admin_response}</div>}
              </div>
            ))}
            </>}

            {feedbackTab === 'compliments' && <>
            <button onClick={() => setShowComplimentForm(!showComplimentForm)} style={{ width: '100%', padding: 14, borderRadius: 14, border: 'none', background: 'linear-gradient(135deg,#4ade80,#22c55e)', color: '#0a1929', fontWeight: 700, fontSize: 14, cursor: 'pointer', marginBottom: 14 }}>
              👏 {c.newCompliment}
            </button>
            {showComplimentForm && (
              <div style={{ ...S.card, marginBottom: 16 }}>
                <div style={{ marginBottom: 10 }}>
                  <span style={S.label}>{c.complimentAbout}</span>
                  <select value={complimentForm.job_id} onChange={e => setComplimentForm(f => ({ ...f, job_id: e.target.value }))} style={S.input}>
                    <option value="">{c.generalComplaint}</option>
                    {completed.map(j => <option key={j.id} value={j.id}>{locationFromJob(j)} · {j.scheduled_date}</option>)}
                  </select>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <span style={S.label}>{c.complimentDesc}</span>
                  <textarea value={complimentForm.message} onChange={e => setComplimentForm(f => ({ ...f, message: e.target.value }))} rows={4} style={{ ...S.input, resize: 'none' }} />
                </div>
                <button onClick={submitCompliment} style={{ width: '100%', padding: 12, borderRadius: 12, border: 'none', background: '#c19c56', color: '#0a1929', fontWeight: 700, cursor: 'pointer' }}>{c.submitCompliment}</button>
              </div>
            )}
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 10 }}>{c.complimentHistory}</div>
            {compliments.length === 0 ? <div style={{ ...S.card, color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center' }}>{c.noCompliments}</div> : compliments.map(cm => (
              <div key={cm.id} style={{ ...S.card, borderLeft: '4px solid #4ade80' }}>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>{cm.location_name} · {cm.employee_name || '—'} · {new Date(cm.created_at).toLocaleDateString('ja-JP')}</div>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>👏 {cm.message}</div>
                {cm.admin_response && <div style={{ marginTop: 10, fontSize: 12, background: 'rgba(193,156,86,0.1)', borderRadius: 8, padding: '8px 10px' }}><b>{c.adminResponse}:</b> {cm.admin_response}</div>}
              </div>
            ))}
            </>}
          </>
        )}

        {!loading && tab === 'requests' && (
          <>
            <button onClick={() => setShowRequestForm(!showRequestForm)} style={{ width: '100%', padding: 14, borderRadius: 14, border: 'none', background: 'linear-gradient(135deg,#60a5fa,#3b82f6)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', marginBottom: 14 }}>
              📝 {c.newRequest}
            </button>

            {showRequestForm && (
              <div style={{ ...S.card, marginBottom: 16 }}>
                {locations.length > 1 && (
                  <div style={{ marginBottom: 10 }}>
                    <span style={S.label}>{c.requestLocation}</span>
                    <select value={requestForm.location_name} onChange={e => setRequestForm(f => ({ ...f, location_name: e.target.value }))} style={S.input}>
                      <option value="">{c.allLocations}</option>
                      {locations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                    </select>
                  </div>
                )}
                <div style={{ marginBottom: 10 }}>
                  <span style={S.label}>{c.requestDesc}</span>
                  <textarea value={requestForm.description} onChange={e => setRequestForm(f => ({ ...f, description: e.target.value }))} rows={4} placeholder={lang === 'ja' ? '例：キッチン換気扇の深層清掃をお願いします' : 'e.g. Please deep clean the kitchen hood'} style={{ ...S.input, resize: 'none' }} />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <span style={S.label}>{c.requestDate}</span>
                  <input type="date" value={requestForm.preferred_date} onChange={e => setRequestForm(f => ({ ...f, preferred_date: e.target.value }))} style={S.input} />
                </div>
                <button onClick={submitRequest} style={{ width: '100%', padding: 12, borderRadius: 12, border: 'none', background: '#c19c56', color: '#0a1929', fontWeight: 700, cursor: 'pointer' }}>{c.submitRequest}</button>
              </div>
            )}

            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 10 }}>{c.requestHistory}</div>
            {requests.length === 0 ? <div style={{ ...S.card, color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center' }}>{c.noRequests}</div> : requests.map(rq => (
              <div key={rq.id} style={S.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{rq.ticket_number || `#${rq.id.slice(0, 8)}`} · {rq.location_name || c.allLocations}</span>
                  <span style={{ fontSize: 11, color: rq.status === 'completed' ? '#4ade80' : '#fbbf24' }}>{rq.status === 'completed' ? c.statusDone : c.statusPending}</span>
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>{new Date(rq.created_at).toLocaleDateString('ja-JP')}{rq.preferred_date ? ` · ${c.requestDate}: ${rq.preferred_date}` : ''}</div>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>{rq.description}</div>
                {rq.admin_notes && <div style={{ marginTop: 10, fontSize: 12, background: 'rgba(193,156,86,0.1)', borderRadius: 8, padding: '8px 10px' }}><b>{c.adminResponse}:</b> {rq.admin_notes}</div>}
              </div>
            ))}
          </>
        )}
      </main>

      <nav style={S.bottomNav}>
        {bottomTabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={S.tabBtn(tab === t.key)}>
            <div style={{ fontSize: 20, position: 'relative' }}>
              {t.icon}
              {t.badge > 0 && <span style={{ position: 'absolute', top: -4, right: -8, background: '#f87171', color: '#fff', fontSize: 9, fontWeight: 800, borderRadius: 10, padding: '1px 5px', minWidth: 14 }}>{t.badge}</span>}
            </div>
            <div style={{ marginTop: 2 }}>{t.label}</div>
          </button>
        ))}
      </nav>
    </div>
  )
}
