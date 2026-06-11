import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { distanceMeters, getCurrentPosition } from '../lib/geocode'
import toast from 'react-hot-toast'

const BADGE_DEFS = [
  { key:'first_job', name:'First Job', icon:'🎯', desc:'Complete your first job' },
  { key:'jobs_5', name:'5 Jobs', icon:'⭐', desc:'Complete 5 jobs' },
  { key:'jobs_10', name:'10 Jobs', icon:'🌟', desc:'Complete 10 jobs' },
  { key:'jobs_25', name:'25 Jobs', icon:'🏆', desc:'Complete 25 jobs' },
  { key:'perfect_week', name:'Perfect Week', icon:'🔥', desc:'5 jobs in one week' },
  { key:'spot_master', name:'Spot Master', icon:'⚡', desc:'Accept 5 spot jobs' },
]

export default function EmployeePortal() {
  const { user, logout } = useAuth()
  const [tab, setTab] = useState('home')
  const [menuOpen, setMenuOpen] = useState(false)
  const [jobs, setJobs] = useState([])
  const [allJobs, setAllJobs] = useState([])
  const [spotJobs, setSpotJobs] = useState([])
  const [activeJob, setActiveJob] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [checklist, setChecklist] = useState([])
  const [notes, setNotes] = useState('')
  const [jobPhotos, setJobPhotos] = useState([]) // array of {file, preview, slot}
  const [submitting, setSubmitting] = useState(false)
  const [gpsStatus, setGpsStatus] = useState('')
  const [gpsBlocked, setGpsBlocked] = useState(false)
  const [salaryData, setSalaryData] = useState(null)
  const [payments, setPayments] = useState([])
  const [advances, setAdvances] = useState([])
  const [claims, setClaims] = useState([])
  const [messages, setMessages] = useState([])
  const [newMsg, setNewMsg] = useState('')
  const [badges, setBadges] = useState([])
  const [clock, setClock] = useState(new Date())
  const [empScore, setEmpScore] = useState(user.score||100)
  const [empData, setEmpData] = useState(null)
  const [historyFilter, setHistoryFilter] = useState('all')
  const [selectedJob, setSelectedJob] = useState(null)
  const [claimForm, setClaimForm] = useState({ job_id:'', amount:'', route:'', description:'' })
  const [claimPhoto, setClaimPhoto] = useState(null)
  const [claimReceipt, setClaimReceipt] = useState(null)
  const [claimPhotoPreview, setClaimPhotoPreview] = useState(null)
  const [claimReceiptPreview, setClaimReceiptPreview] = useState(null)
  const [submittingClaim, setSubmittingClaim] = useState(false)
  const [unreadMsgs, setUnreadMsgs] = useState(0)
  const timerRef = useRef()
  const clockRef = useRef()
  const photoInputRef = useRef()
  const claimPhotoRef = useRef()
  const claimReceiptRef = useRef()
  const msgEndRef = useRef()

  useEffect(() => {
    loadAll()
    clockRef.current = setInterval(() => setClock(new Date()), 1000)
    const msgInterval = setInterval(() => loadMessages(), 15000)
    return () => { clearInterval(clockRef.current); clearInterval(timerRef.current); clearInterval(msgInterval) }
  }, [])

  useEffect(() => {
    if (activeJob?.started_at) {
      const start = new Date(activeJob.started_at)
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now()-start)/1000)), 1000)
    }
    return () => clearInterval(timerRef.current)
  }, [activeJob])

  useEffect(() => {
    if (tab==='chat') { markMessagesRead(); setTimeout(()=>msgEndRef.current?.scrollIntoView({behavior:'smooth'}),100) }
  }, [tab, messages])

  const loadAll = async () => {
    // Get today accounting for night shift (jobs starting after 22:00 belong to next calendar day display)
    const now = new Date()
    const today = now.toISOString().split('T')[0]
    const [active, all, emp, pay, adv, clm, bdg] = await Promise.all([
      supabase.from('jobs').select('*').eq('employee_id',user.id).in('status',['assigned','in_progress']).order('scheduled_date').order('scheduled_time'),
      supabase.from('jobs').select('*').eq('employee_id',user.id).order('scheduled_date',{ascending:false}).limit(200),
      supabase.from('employees').select('*').eq('id',user.id).single(),
      supabase.from('salary_payments').select('*').eq('employee_id',user.id).gte('payment_date',today).order('payment_date').limit(5),
      supabase.from('salary_advances').select('*').eq('employee_id',user.id).order('created_at',{ascending:false}).limit(10),
      supabase.from('transport_claims').select('*').eq('employee_id',user.id).order('created_at',{ascending:false}).limit(20),
      supabase.from('badges').select('*').eq('employee_id',user.id),
    ])
    const regular = (active.data||[]).filter(j=>j.job_category!=='spot'||j.spot_status==='accepted')
    const spots = (active.data||[]).filter(j=>j.job_category==='spot'&&j.spot_status==='pending')
    setJobs(regular); setSpotJobs(spots); setAllJobs(all.data||[])
    setPayments(pay.data||[]); setAdvances(adv.data||[]); setClaims(clm.data||[])
    setBadges(bdg.data||[])
    if (emp.data) { setEmpScore(emp.data.score||100); setEmpData(emp.data) }
    const inProgress = regular.find(j=>j.status==='in_progress')
    if (inProgress) {
      setActiveJob(inProgress)
      const cl = inProgress.checklist_template?inProgress.checklist_template.split('\n').filter(Boolean).map(l=>({label:l,done:false})):[]
      setChecklist(cl)
    }
    calcSalary(all.data||[], emp.data)
    loadMessages()
    checkAndAwardBadges(all.data||[], bdg.data||[])
  }

  const loadMessages = async () => {
    const { data } = await supabase.from('messages').select('*').eq('employee_id',user.id).order('created_at').limit(50)
    setMessages(data||[])
    setUnreadMsgs((data||[]).filter(m=>m.sender==='admin'&&!m.read).length)
  }

  const markMessagesRead = async () => {
    await supabase.from('messages').update({read:true}).eq('employee_id',user.id).eq('sender','admin').eq('read',false)
    setUnreadMsgs(0)
  }

  const sendMessage = async () => {
    if (!newMsg.trim()) return
    await supabase.from('messages').insert({ employee_id:user.id, employee_name:user.name, sender:'employee', content:newMsg.trim(), read:false })
    setNewMsg(''); loadMessages()
  }

  const calcSalary = (allData, empInfo) => {
    const month = new Date().toISOString().slice(0,7)
    const completed = allData.filter(j=>j.status==='completed'&&j.scheduled_date?.startsWith(month))
    const totalMins = completed.reduce((s,j)=>{ if(!j.started_at||!j.completed_at) return s; return s+(new Date(j.completed_at)-new Date(j.started_at))/60000 },0)
    const spotEarned = completed.filter(j=>j.job_category==='spot').reduce((s,j)=>s+Number(j.spot_value||0),0)
    // Count unique work days — night shifts (00:00-06:00) count as previous calendar day
    const workedDaySet = new Set()
    completed.filter(j=>j.counts_as_work_day!==false).forEach(j=>{
      if (!j.scheduled_date) return
      const time = j.scheduled_time||'12:00'
      const hour = parseInt(time.split(':')[0])
      if (hour < 6) {
        // Night shift — count as previous day
        const d = new Date(j.scheduled_date+'T12:00:00')
        d.setDate(d.getDate()-1)
        workedDaySet.add(d.toISOString().split('T')[0])
      } else {
        workedDaySet.add(j.scheduled_date)
      }
    })
    const workedDays = workedDaySet.size
    const fixedMax = empInfo?.fixed_salary || 0
    const monthlyDays = empInfo?.monthly_work_days || 22
    const dailyRate = fixedMax / monthlyDays
    let base = 0
    if (empInfo?.salary_type==='fixed') base = Math.min(Math.round(dailyRate * workedDays), fixedMax)
    else if (empInfo?.salary_type==='hourly') base = Math.round((totalMins/60)*(empInfo?.hourly_rate||0))
    else base = Math.round(fixedMax + (totalMins/60)*(empInfo?.hourly_rate||0))
    const now = new Date()
    const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate()
    let remainWorkDays = 0
    for (let d=now.getDate()+1; d<=daysInMonth; d++) { const day = new Date(now.getFullYear(), now.getMonth(), d).getDay(); if(day!==0&&day!==6) remainWorkDays++ }
    const projected = Math.min(base + Math.round(dailyRate * remainWorkDays), fixedMax)
    setSalaryData({ jobs:completed.length, hours:(totalMins/60).toFixed(1), base, spotEarned, total:base+spotEarned, workedDays, fixedMax, dailyRate:Math.round(dailyRate), projected, remainWorkDays })
  }

  const checkAndAwardBadges = async (allData, existingBadges) => {
    const earned = existingBadges.map(b=>b.badge_key)
    const completed = allData.filter(j=>j.status==='completed')
    const toAward = []
    if (completed.length>=1&&!earned.includes('first_job')) toAward.push('first_job')
    if (completed.length>=5&&!earned.includes('jobs_5')) toAward.push('jobs_5')
    if (completed.length>=10&&!earned.includes('jobs_10')) toAward.push('jobs_10')
    if (completed.length>=25&&!earned.includes('jobs_25')) toAward.push('jobs_25')
    for (const key of toAward) {
      const def = BADGE_DEFS.find(b=>b.key===key)
      await supabase.from('badges').insert({ employee_id:user.id, badge_key:key, badge_name:def?.name })
      toast.success(`🏆 Badge: ${def?.name}!`)
    }
  }

  const checkGPS = async (job) => {
    if (!job.gps_lat||!job.gps_lng) return true
    setGpsStatus('📍 Checking location...')
    setGpsBlocked(true)
    try {
      const pos = await getCurrentPosition()
      const dist = distanceMeters(pos.lat, pos.lng, Number(job.gps_lat), Number(job.gps_lng))
      if (dist > 100) {
        setGpsStatus(`🚫 ${Math.round(dist)}m away — must be within 100m`)
        setGpsBlocked(false)
        toast.error(`You are ${Math.round(dist)}m away. Must be at the location.`, { duration:5000 })
        return false
      }
      setGpsStatus(`✅ ${Math.round(dist)}m — location confirmed`)
      setGpsBlocked(false)
      return true
    } catch(e) {
      setGpsStatus('⚠️ GPS unavailable')
      setGpsBlocked(false)
      toast.error('Cannot get your location. Enable GPS and try again.', { duration:5000 })
      return false
    }
  }

  const handleAcceptSpot = async (job) => {
    await supabase.from('jobs').update({ spot_status:'accepted',status:'assigned',spot_responded_at:new Date().toISOString() }).eq('id',job.id)
    toast.success(`Accepted! +¥${Number(job.spot_value||0).toLocaleString()}`); loadAll()
  }
  const handleDeclineSpot = async (job) => {
    await supabase.from('jobs').update({ spot_status:'declined',status:'cancelled',spot_responded_at:new Date().toISOString() }).eq('id',job.id)
    toast('Declined.'); loadAll()
  }

  const handleStart = async (job) => {
    setSubmitting(true)
    const ok = await checkGPS(job)
    if (!ok) { setSubmitting(false); return }
    // Upload start photos
    let startPhotoUrl = null
    const startPhotos = jobPhotos.filter(p=>p.slot==='start')
    if (startPhotos.length > 0) {
      const ext = startPhotos[0].file.name.split('.').pop()
      await supabase.storage.from('service-photos').upload(`jobs/${job.id}/start_0.${ext}`, startPhotos[0].file, {upsert:true})
      const { data:pd } = supabase.storage.from('service-photos').getPublicUrl(`jobs/${job.id}/start_0.${ext}`)
      startPhotoUrl = pd.publicUrl
      // Upload additional start photos
      for (let i=1; i<startPhotos.length; i++) {
        const e2 = startPhotos[i].file.name.split('.').pop()
        await supabase.storage.from('service-photos').upload(`jobs/${job.id}/start_${i}.${e2}`, startPhotos[i].file, {upsert:true})
      }
    }
    const { data, error } = await supabase.from('jobs').update({ status:'in_progress', started_at:new Date().toISOString(), photo_start_url:startPhotoUrl }).eq('id',job.id).select().single()
    if (error) { toast.error(error.message); setSubmitting(false); return }
    const cl = job.checklist_template?job.checklist_template.split('\n').filter(Boolean).map(l=>({label:l,done:false})):[]
    setChecklist(cl); setActiveJob(data); setJobPhotos([])
    toast.success('✅ Started!'); setSubmitting(false)
  }

  const handleComplete = async () => {
    const endPhotos = jobPhotos.filter(p=>p.slot==='end')
    if (activeJob.photo_required && endPhotos.length === 0) return toast.error('📷 At least 1 photo required!')
    setSubmitting(true)
    const ok = await checkGPS(activeJob)
    if (!ok) { setSubmitting(false); return }
    let endPhotoUrl = null
    const allEndPhotoUrls = []
    for (let i=0; i<endPhotos.length; i++) {
      const ext = endPhotos[i].file.name.split('.').pop()
      const path = `jobs/${activeJob.id}/end_${i}.${ext}`
      await supabase.storage.from('service-photos').upload(path, endPhotos[i].file, {upsert:true})
      const { data:pd } = supabase.storage.from('service-photos').getPublicUrl(path)
      allEndPhotoUrls.push(pd.publicUrl)
      if (i===0) endPhotoUrl = pd.publicUrl
    }
    await supabase.from('jobs').update({
      status:'completed', completed_at:new Date().toISOString(),
      notes_employee:notes, photo_end_url:endPhotoUrl,
      checklist_template:JSON.stringify(checklist),
    }).eq('id',activeJob.id)
    clearInterval(timerRef.current)
    setActiveJob(null); setElapsed(0); setChecklist([]); setNotes(''); setJobPhotos([])
    toast.success('🎉 Job completed!'); loadAll(); setTab('home'); setSubmitting(false)
  }

  const addPhoto = (slot, files) => {
    const newPhotos = Array.from(files).map(file => ({ file, preview: URL.createObjectURL(file), slot, id: Date.now()+Math.random() }))
    setJobPhotos(p => [...p, ...newPhotos])
  }

  const removePhoto = (id) => setJobPhotos(p => p.filter(ph => ph.id !== id))

  const uploadFile = async (file, path) => {
    await supabase.storage.from('service-photos').upload(path, file, {upsert:true})
    const { data } = supabase.storage.from('service-photos').getPublicUrl(path)
    return data.publicUrl
  }

  const handleSubmitClaim = async () => {
    if (!claimForm.amount) return toast.error('Enter amount')
    setSubmittingClaim(true)
    const id = Date.now()
    const photoUrl = claimPhoto ? await uploadFile(claimPhoto, `claims/${user.id}/${id}_photo.${claimPhoto.name.split('.').pop()}`) : null
    const receiptUrl = claimReceipt ? await uploadFile(claimReceipt, `claims/${user.id}/${id}_receipt.${claimReceipt.name.split('.').pop()}`) : null
    const job = allJobs.find(j=>j.id===claimForm.job_id)
    await supabase.from('transport_claims').insert({ employee_id:user.id, employee_name:user.name, job_id:claimForm.job_id||null, job_title:job?.title||null, amount:parseFloat(claimForm.amount), route:claimForm.route, description:claimForm.description, photo_url:photoUrl, receipt_url:receiptUrl, status:'pending' })
    toast.success('Claim submitted!')
    setClaimForm({ job_id:'', amount:'', route:'', description:'' })
    setClaimPhoto(null); setClaimReceipt(null); setClaimPhotoPreview(null); setClaimReceiptPreview(null)
    loadAll(); setSubmittingClaim(false)
  }

  const fmt = s=>`${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`
  const scoreColor = s=>s>=90?'#4ade80':s>=70?'#fbbf24':'#f87171'
  const today = new Date().toISOString().split('T')[0]

  // Calendar grouping — night shifts show on correct date
  const jobsForCalendar = (filter) => {
    return allJobs.filter(j=>{
      if (filter==='upcoming') return j.status==='assigned'&&j.scheduled_date>=today
      if (filter==='past') return j.status==='completed'
      if (filter==='cancelled') return j.status==='cancelled'
      return true
    })
  }

  const displayDate = (job) => {
    const time = job.scheduled_time||'12:00'
    const hour = parseInt(time.split(':')[0])
    if (hour < 6) {
      const d = new Date(job.scheduled_date+'T12:00:00')
      d.setDate(d.getDate()-1)
      return d.toISOString().split('T')[0]
    }
    return job.scheduled_date
  }

  const S = {
    card: { background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:18, padding:16, marginBottom:12 },
    label: { fontSize:10, color:'rgba(255,255,255,0.4)', letterSpacing:1.2, textTransform:'uppercase', marginBottom:7, display:'block' },
    input: { width:'100%', padding:'12px 14px', fontSize:14, borderRadius:12, border:'1px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.06)', color:'#fff', fontFamily:'inherit', boxSizing:'border-box' },
  }

  const PhotoGrid = ({ slot, label }) => {
    const photos = jobPhotos.filter(p=>p.slot===slot)
    return (
      <div style={{marginBottom:14}}>
        <span style={S.label}>{label} ({photos.length}/10)</span>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:8}}>
          {photos.map(p=>(
            <div key={p.id} style={{position:'relative',aspectRatio:'1',borderRadius:10,overflow:'hidden'}}>
              <img src={p.preview} style={{width:'100%',height:'100%',objectFit:'cover'}} />
              <button onClick={()=>removePhoto(p.id)} style={{position:'absolute',top:4,right:4,width:22,height:22,borderRadius:'50%',background:'rgba(0,0,0,0.7)',border:'none',color:'#fff',fontSize:12,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
            </div>
          ))}
          {photos.length < 10 && (
            <div onClick={()=>{ photoInputRef.current.dataset.slot=slot; photoInputRef.current.click() }}
              style={{aspectRatio:'1',borderRadius:10,border:'2px dashed rgba(255,255,255,0.15)',background:'rgba(255,255,255,0.03)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',gap:4}}>
              <span style={{fontSize:22}}>📷</span>
              <span style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>Add</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  const menuItems = [
    {key:'home',icon:'🏠',label:'Dashboard'},
    {key:'jobs',icon:'📋',label:'My Jobs'},
    {key:'spots',icon:'⚡',label:'Spot Jobs',badge:spotJobs.length},
    {key:'history',icon:'📅',label:'All Jobs'},
    {key:'salary',icon:'💴',label:'Salary'},
    {key:'transport',icon:'🚃',label:'Transport'},
    {key:'chat',icon:'💬',label:'Chat',badge:unreadMsgs},
    {key:'achievements',icon:'🏆',label:'Achievements'},
  ]

  const JobModal = ({ job, onClose }) => {
    const duration = job.started_at&&job.completed_at?Math.round((new Date(job.completed_at)-new Date(job.started_at))/60000):null
    const cl = (() => { try { return JSON.parse(job.checklist_template||'[]') } catch { return [] } })()
    const mats = job.materials?job.materials.split('\n').filter(Boolean):[]
    const dDate = displayDate(job)
    return (
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.9)',zIndex:200,display:'flex',flexDirection:'column',justifyContent:'flex-end'}} onClick={onClose}>
        <div style={{background:'#0d1f35',borderRadius:'24px 24px 0 0',padding:'20px 20px 40px',maxHeight:'92vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
          <div style={{width:40,height:4,background:'rgba(255,255,255,0.15)',borderRadius:2,margin:'0 auto 18px'}} />
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
            <div style={{flex:1,marginRight:12}}>
              <div style={{display:'flex',gap:6,marginBottom:6,alignItems:'center',flexWrap:'wrap'}}>
                {job.job_category==='spot'&&<span style={{fontSize:9,background:'#c19c56',color:'#0a1929',padding:'2px 8px',borderRadius:20,fontWeight:800}}>SPOT</span>}
                <span style={{fontSize:{completed:'#4ade80',assigned:'#60a5fa',in_progress:'#fbbf24',cancelled:'rgba(255,255,255,0.3)'}[job.status]||'#fff',fontSize:9,fontWeight:700,textTransform:'uppercase'}}>{job.status}</span>
              </div>
              <div style={{fontSize:18,fontWeight:700,color:'#fff',lineHeight:1.3,marginBottom:4}}>{job.title}</div>
              <div style={{fontSize:11,color:'rgba(255,255,255,0.4)'}}>{job.client_name}</div>
            </div>
            <div style={{fontSize:19,fontWeight:800,color:'#c19c56',flexShrink:0}}>¥{Number(job.spot_value||job.value||0).toLocaleString()}</div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:16}}>
            {[
              ['📅 Date', dDate],
              ['🕐 Start', job.scheduled_time||'—'],
              ['▶ Check-in', job.started_at?new Date(job.started_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):'—'],
              ['🏁 Check-out', job.completed_at?new Date(job.completed_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):'—'],
              ['⏱ Duration', duration?`${Math.floor(duration/60)}h ${duration%60}m`:'—'],
              ['📍 Location', job.address?.startsWith('http')?'Link below':job.address||'—'],
            ].map(([l,v])=>(
              <div key={l} style={{background:'rgba(255,255,255,0.06)',borderRadius:12,padding:'10px 12px'}}>
                <div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:3}}>{l}</div>
                <div style={{fontSize:12,fontWeight:500,color:'#fff',wordBreak:'break-all'}}>{v}</div>
              </div>
            ))}
          </div>

          {job.description&&<div style={{background:'rgba(255,255,255,0.05)',borderRadius:12,padding:'12px 14px',marginBottom:12}}>
            <div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:5}}>📋 Instructions / Key Box</div>
            <div style={{fontSize:13,color:'rgba(255,255,255,0.75)',lineHeight:1.7,whiteSpace:'pre-line'}}>{job.description}</div>
          </div>}

          {mats.length>0&&<div style={{marginBottom:12}}>
            <div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:6,letterSpacing:1,textTransform:'uppercase'}}>🧹 Materials</div>
            {mats.map((m,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}><div style={{width:5,height:5,borderRadius:'50%',background:'#c19c56',flexShrink:0}} /><span style={{fontSize:13,color:'rgba(255,255,255,0.65)'}}>{m}</span></div>)}
          </div>}

          {cl.length>0&&<div style={{marginBottom:12}}>
            <div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:7,letterSpacing:1,textTransform:'uppercase'}}>Checklist — {cl.filter(t=>t.done).length}/{cl.length}</div>
            {cl.map((t,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}><div style={{width:20,height:20,borderRadius:6,background:t.done?'#4ade80':'rgba(255,255,255,0.08)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{t.done&&<span style={{fontSize:12,color:'#080f1a',fontWeight:900}}>✓</span>}</div><span style={{fontSize:13,color:t.done?'rgba(255,255,255,0.35)':'rgba(255,255,255,0.75)',textDecoration:t.done?'line-through':'none'}}>{t.label}</span></div>)}
          </div>}

          {job.notes_employee&&<div style={{background:'rgba(255,255,255,0.05)',borderRadius:12,padding:'10px 12px',marginBottom:12}}>
            <div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:3}}>Your Notes</div>
            <div style={{fontSize:13,color:'rgba(255,255,255,0.65)',lineHeight:1.5}}>{job.notes_employee}</div>
          </div>}

          {(job.photo_start_url||job.photo_end_url)&&<div style={{marginBottom:14}}>
            <div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:8,letterSpacing:1,textTransform:'uppercase'}}>Photos</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              {job.photo_start_url&&<div><div style={{fontSize:9,color:'rgba(255,255,255,0.25)',marginBottom:3}}>START</div><img src={job.photo_start_url} style={{width:'100%',borderRadius:10,objectFit:'cover',aspectRatio:'4/3'}} /></div>}
              {job.photo_end_url&&<div><div style={{fontSize:9,color:'rgba(255,255,255,0.25)',marginBottom:3}}>END</div><img src={job.photo_end_url} style={{width:'100%',borderRadius:10,objectFit:'cover',aspectRatio:'4/3'}} /></div>}
            </div>
          </div>}

          {job.address?.startsWith('http')&&<a href={job.address} target="_blank" rel="noreferrer" style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,background:'rgba(96,165,250,0.1)',border:'1px solid rgba(96,165,250,0.2)',borderRadius:14,padding:'13px',textAlign:'center',color:'#60a5fa',fontSize:14,fontWeight:600,textDecoration:'none',marginBottom:10}}>🗺 Open in Google Maps</a>}

          <button onClick={onClose} style={{width:'100%',padding:'14px',borderRadius:14,border:'none',background:'rgba(255,255,255,0.07)',color:'rgba(255,255,255,0.5)',fontSize:14,fontWeight:600,cursor:'pointer'}}>Close</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{minHeight:'100vh',background:'#060d18',display:'flex',flexDirection:'column',maxWidth:430,margin:'0 auto',WebkitTapHighlightColor:'transparent',fontFamily:'-apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif'}}>
      <input type="file" ref={photoInputRef} accept="image/*" capture="environment" multiple style={{display:'none'}}
        onChange={e=>{ const slot=photoInputRef.current.dataset.slot||'end'; addPhoto(slot, e.target.files); e.target.value='' }} />
      <input type="file" ref={claimPhotoRef} accept="image/*" capture="environment" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(f){setClaimPhoto(f);setClaimPhotoPreview(URL.createObjectURL(f))}}} />
      <input type="file" ref={claimReceiptRef} accept="image/*,application/pdf" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(f){setClaimReceipt(f);setClaimReceiptPreview(URL.createObjectURL(f))}}} />

      {selectedJob&&<JobModal job={selectedJob} onClose={()=>setSelectedJob(null)} />}

      {/* Ambient glow */}
      <div style={{position:'fixed',top:-100,left:-50,width:300,height:300,background:'radial-gradient(circle,rgba(193,156,86,0.08) 0%,transparent 70%)',pointerEvents:'none',zIndex:0}} />
      <div style={{position:'fixed',bottom:-80,right:-80,width:280,height:280,background:'radial-gradient(circle,rgba(96,165,250,0.05) 0%,transparent 70%)',pointerEvents:'none',zIndex:0}} />

      {/* HEADER */}
      <div style={{position:'sticky',top:0,zIndex:50,background:'rgba(6,13,24,0.97)',backdropFilter:'blur(24px)',WebkitBackdropFilter:'blur(24px)',borderBottom:'1px solid rgba(255,255,255,0.06)',padding:'16px 16px 12px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
          <div>
            <div style={{fontSize:9,color:'rgba(255,255,255,0.2)',letterSpacing:2.5,textTransform:'uppercase',marginBottom:2}}>KuriPuro by JBM</div>
            <div style={{fontSize:22,fontWeight:700,color:'#fff',letterSpacing:-0.5,lineHeight:1}}>{user.name.split(' ')[0]}</div>
            <div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:3}}>{clock.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'short'})}</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{background:`rgba(${empScore>=90?'74,222,128':empScore>=70?'251,191,36':'248,113,113'},0.1)`,border:`1px solid rgba(${empScore>=90?'74,222,128':empScore>=70?'251,191,36':'248,113,113'},0.2)`,borderRadius:14,padding:'7px 12px',textAlign:'center'}}>
              <div style={{fontSize:20,fontWeight:800,color:scoreColor(empScore),lineHeight:1}}>{empScore}</div>
              <div style={{fontSize:8,color:'rgba(255,255,255,0.2)',textTransform:'uppercase',letterSpacing:1,marginTop:1}}>Score</div>
            </div>
            <button onClick={()=>setMenuOpen(!menuOpen)} style={{width:40,height:40,borderRadius:12,background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.08)',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,position:'relative',flexShrink:0}}>
              {[0,1,2].map(i=><div key={i} style={{width:4,height:4,borderRadius:'50%',background:'rgba(255,255,255,0.5)'}} />)}
              {(unreadMsgs>0||spotJobs.length>0)&&<div style={{position:'absolute',top:4,right:4,width:8,height:8,borderRadius:'50%',background:'#f87171',border:'2px solid #060d18'}} />}
            </button>
          </div>
        </div>

        {/* Big clock */}
        <div style={{marginTop:10,display:'flex',alignItems:'baseline',gap:4}}>
          <span style={{fontSize:46,fontWeight:700,color:'#fff',fontFamily:'monospace',letterSpacing:-3,lineHeight:1}}>{clock.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</span>
          <span style={{fontSize:22,color:'rgba(255,255,255,0.2)',fontFamily:'monospace',fontWeight:300}}>{String(clock.getSeconds()).padStart(2,'0')}</span>
        </div>

        {/* Status pills */}
        <div style={{display:'flex',gap:6,marginTop:10,flexWrap:'wrap'}}>
          {gpsStatus&&<div style={{background:gpsStatus.includes('✅')?'rgba(74,222,128,0.1)':gpsStatus.includes('🚫')?'rgba(248,113,113,0.1)':'rgba(255,255,255,0.06)',border:`1px solid rgba(${gpsStatus.includes('✅')?'74,222,128':gpsStatus.includes('🚫')?'248,113,113':'255,255,255'},0.2)`,borderRadius:20,padding:'4px 10px',fontSize:10,color:gpsStatus.includes('✅')?'#4ade80':gpsStatus.includes('🚫')?'#f87171':'rgba(255,255,255,0.4)',fontWeight:500}}>{gpsStatus}</div>}
          {activeJob&&<div style={{background:'rgba(74,222,128,0.1)',border:'1px solid rgba(74,222,128,0.2)',borderRadius:20,padding:'4px 12px',fontSize:12,color:'#4ade80',fontWeight:700,fontFamily:'monospace'}}>▶ {fmt(elapsed)}</div>}
          {spotJobs.length>0&&<div onClick={()=>setTab('spots')} style={{background:'rgba(193,156,86,0.1)',border:'1px solid rgba(193,156,86,0.2)',borderRadius:20,padding:'4px 10px',fontSize:10,color:'#c19c56',cursor:'pointer',fontWeight:600}}>⚡ {spotJobs.length}</div>}
          {unreadMsgs>0&&<div onClick={()=>setTab('chat')} style={{background:'rgba(248,113,113,0.1)',border:'1px solid rgba(248,113,113,0.2)',borderRadius:20,padding:'4px 10px',fontSize:10,color:'#f87171',cursor:'pointer',fontWeight:600}}>💬 {unreadMsgs}</div>}
        </div>
      </div>

      {/* 3-dot menu */}
      {menuOpen&&(
        <div style={{position:'fixed',inset:0,zIndex:100}} onClick={()=>setMenuOpen(false)}>
          <div style={{position:'absolute',top:136,right:12,background:'#0d1f35',border:'1px solid rgba(255,255,255,0.08)',borderRadius:20,overflow:'hidden',minWidth:200,boxShadow:'0 28px 80px rgba(0,0,0,0.7)'}} onClick={e=>e.stopPropagation()}>
            {menuItems.map(item=>(
              <button key={item.key} onClick={()=>{setTab(item.key);setMenuOpen(false)}} style={{width:'100%',padding:'14px 18px',border:'none',background:tab===item.key?'rgba(193,156,86,0.1)':'none',color:tab===item.key?'#c19c56':'rgba(255,255,255,0.7)',fontSize:14,fontWeight:tab===item.key?600:400,cursor:'pointer',display:'flex',alignItems:'center',gap:12,borderBottom:'1px solid rgba(255,255,255,0.04)',textAlign:'left'}}>
                <span style={{fontSize:18}}>{item.icon}</span>
                <span style={{flex:1}}>{item.label}</span>
                {item.badge>0&&<span style={{background:item.key==='chat'?'#f87171':'#c19c56',color:'#0a1929',borderRadius:20,padding:'2px 8px',fontSize:10,fontWeight:800}}>{item.badge}</span>}
              </button>
            ))}
            <div style={{height:1,background:'rgba(255,255,255,0.05)'}} />
            <button onClick={logout} style={{width:'100%',padding:'14px 18px',border:'none',background:'none',color:'#f87171',fontSize:14,cursor:'pointer',display:'flex',alignItems:'center',gap:12,textAlign:'left'}}>
              <span style={{fontSize:18}}>🚪</span> Logout
            </button>
          </div>
        </div>
      )}

      {/* CONTENT */}
      <div style={{flex:1,padding:'16px 14px 50px',overflowY:'auto',position:'relative',zIndex:1}}>

        {/* HOME */}
        {tab==='home'&&(
          <div>
            {activeJob&&<div onClick={()=>setTab('jobs')} style={{background:'linear-gradient(135deg,rgba(74,222,128,0.12),rgba(74,222,128,0.03))',border:'1px solid rgba(74,222,128,0.2)',borderRadius:20,padding:16,marginBottom:12,cursor:'pointer'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div><div style={{fontSize:9,color:'#4ade80',fontWeight:700,letterSpacing:1,marginBottom:4}}>● ACTIVE SHIFT</div><div style={{fontSize:15,fontWeight:700,color:'#fff'}}>{activeJob.title}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginTop:2}}>Tap to continue →</div></div>
                <div style={{fontSize:26,fontWeight:700,color:'#4ade80',fontFamily:'monospace'}}>{fmt(elapsed)}</div>
              </div>
            </div>}

            {payments.length>0&&<div onClick={()=>setTab('salary')} style={{background:'linear-gradient(135deg,rgba(96,165,250,0.08),rgba(96,165,250,0.02))',border:'1px solid rgba(96,165,250,0.15)',borderRadius:20,padding:16,marginBottom:12,cursor:'pointer'}}>
              <div style={{fontSize:9,color:'#60a5fa',fontWeight:700,letterSpacing:1,marginBottom:5}}>💴 NEXT PAYMENT</div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div><div style={{fontSize:22,fontWeight:800,color:'#fff'}}>¥{Number(payments[0].amount).toLocaleString()}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:2}}>{payments[0].payment_date} · {payments[0].description||'Salary'}</div></div>
                <div style={{fontSize:14,color:'#60a5fa'}}>View all →</div>
              </div>
            </div>}

            <div style={{fontSize:9,color:'rgba(255,255,255,0.3)',letterSpacing:1.5,textTransform:'uppercase',marginBottom:10}}>Today's Jobs</div>
            {jobs.filter(j=>j.scheduled_date===today&&j.status==='assigned').length===0&&!activeJob&&<div style={{background:'rgba(255,255,255,0.03)',borderRadius:14,padding:18,textAlign:'center',color:'rgba(255,255,255,0.2)',fontSize:13,marginBottom:12}}>No jobs today</div>}
            {jobs.filter(j=>j.scheduled_date===today&&j.status==='assigned').map(j=>(
              <div key={j.id} style={S.card}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div style={{flex:1,marginRight:10}}>
                    <div style={{fontSize:14,fontWeight:600,color:'#fff'}}>{j.title}</div>
                    <div style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginTop:2}}>{j.scheduled_time||'—'}</div>
                  </div>
                  <button onClick={()=>handleStart(j)} disabled={submitting||!!activeJob} style={{padding:'8px 16px',borderRadius:10,border:'none',background:activeJob?'rgba(255,255,255,0.05)':'linear-gradient(135deg,#0F6E56,#16a37e)',color:activeJob?'rgba(255,255,255,0.2)':'#fff',fontSize:12,fontWeight:700,cursor:activeJob?'not-allowed':'pointer',flexShrink:0}}>
                    {activeJob?'Busy':'▶ Start'}
                  </button>
                </div>
              </div>
            ))}

            {/* Monthly stats */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:4,marginBottom:14}}>
              {[['📋',salaryData?.jobs||0,'Jobs'],['⏱',(salaryData?.hours||0)+'h','Hours'],['💴','¥'+(salaryData?.total||0).toLocaleString(),'Earned']].map(([icon,v,l])=>(
                <div key={l} style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:14,padding:'12px 8px',textAlign:'center'}}>
                  <div style={{fontSize:18,marginBottom:4}}>{icon}</div>
                  <div style={{fontSize:14,fontWeight:700,color:'#fff'}}>{v}</div>
                  <div style={{fontSize:9,color:'rgba(255,255,255,0.3)',marginTop:2,textTransform:'uppercase',letterSpacing:0.5}}>{l}</div>
                </div>
              ))}
            </div>

            {/* Salary progress */}
            {salaryData&&salaryData.fixedMax>0&&<div style={S.card}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                <span style={{fontSize:12,color:'rgba(255,255,255,0.5)',fontWeight:500}}>Monthly Salary</span>
                <span style={{fontSize:14,fontWeight:800,color:'#c19c56'}}>¥{salaryData.base.toLocaleString()} <span style={{fontSize:10,color:'rgba(255,255,255,0.2)'}}>/ ¥{salaryData.fixedMax.toLocaleString()}</span></span>
              </div>
              <div style={{height:6,background:'rgba(255,255,255,0.07)',borderRadius:3,overflow:'hidden',marginBottom:6}}>
                <div style={{height:'100%',width:Math.min((salaryData.base/salaryData.fixedMax)*100,100)+'%',borderRadius:3,background:'linear-gradient(90deg,#c19c56,#e8c47a)',transition:'width 0.6s'}} />
              </div>
              <div style={{fontSize:9,color:'rgba(255,255,255,0.25)'}}>{salaryData.workedDays} days worked · ¥{salaryData.dailyRate.toLocaleString()}/day · projected ¥{salaryData.projected?.toLocaleString()}</div>
            </div>}

            {/* Score */}
            <div style={S.card}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}><span style={{fontSize:12,color:'rgba(255,255,255,0.5)'}}>Performance</span><span style={{fontSize:15,fontWeight:800,color:scoreColor(empScore)}}>{empScore}/100</span></div>
              <div style={{height:5,background:'rgba(255,255,255,0.06)',borderRadius:3,overflow:'hidden'}}><div style={{height:'100%',width:empScore+'%',borderRadius:3,background:scoreColor(empScore)}} /></div>
              <div style={{fontSize:9,color:'rgba(255,255,255,0.2)',marginTop:5}}>{empScore>=90?'🌟 Excellent':empScore>=70?'👍 Good':'⚠️ Needs improvement'}</div>
            </div>

            {badges.length>0&&<div style={S.card}>
              <span style={S.label}>Badges earned</span>
              <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                {badges.slice(0,8).map(b=>{ const def=BADGE_DEFS.find(d=>d.key===b.badge_key); return <span key={b.id} style={{fontSize:24}} title={def?.name}>{def?.icon||'🏅'}</span> })}
              </div>
            </div>}

            {spotJobs.length>0&&<div onClick={()=>setTab('spots')} style={{background:'rgba(193,156,86,0.07)',border:'1px solid rgba(193,156,86,0.15)',borderRadius:18,padding:'14px 16px',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div><div style={{fontSize:13,fontWeight:700,color:'#c19c56'}}>⚡ {spotJobs.length} Spot Job{spotJobs.length>1?'s':''}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:2}}>Tap to respond</div></div>
              <div style={{fontSize:22,color:'#c19c56'}}>›</div>
            </div>}
          </div>
        )}

        {/* JOBS */}
        {tab==='jobs'&&(
          <div>
            {activeJob&&(
              <div style={{background:'rgba(10,28,50,0.95)',border:'1px solid rgba(74,222,128,0.2)',borderRadius:22,padding:18,marginBottom:16}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                  <div>
                    <div style={{fontSize:9,color:'#4ade80',fontWeight:700,letterSpacing:1}}>IN PROGRESS</div>
                    <div style={{fontSize:17,fontWeight:700,color:'#fff',marginTop:3,lineHeight:1.3}}>{activeJob.title}</div>
                    {activeJob.address?.startsWith('http')&&<a href={activeJob.address} target="_blank" rel="noreferrer" style={{fontSize:10,color:'#60a5fa',textDecoration:'none',display:'block',marginTop:3}}>🗺 Open Maps</a>}
                  </div>
                  <div style={{fontSize:28,fontWeight:700,color:'#4ade80',fontFamily:'monospace',flexShrink:0}}>{fmt(elapsed)}</div>
                </div>

                {activeJob.description&&<div style={{background:'rgba(255,255,255,0.04)',borderRadius:10,padding:'10px 12px',marginBottom:12,fontSize:12,color:'rgba(255,255,255,0.6)',lineHeight:1.6,whiteSpace:'pre-line'}}>{activeJob.description}</div>}

                {checklist.length>0&&<div style={{marginBottom:14}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                    <span style={S.label}>Checklist</span>
                    <span style={{fontSize:10,color:'#4ade80',fontWeight:600}}>{checklist.filter(t=>t.done).length}/{checklist.length}</span>
                  </div>
                  <div style={{height:3,background:'rgba(255,255,255,0.07)',borderRadius:2,marginBottom:10,overflow:'hidden'}}>
                    <div style={{height:'100%',width:(checklist.length?checklist.filter(t=>t.done).length/checklist.length*100:0)+'%',background:'#4ade80',borderRadius:2,transition:'width 0.3s'}} />
                  </div>
                  {checklist.map((t,i)=>(
                    <div key={i} onClick={()=>setChecklist(c=>c.map((x,j)=>j===i?{...x,done:!x.done}:x))} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 0',borderBottom:'1px solid rgba(255,255,255,0.04)',cursor:'pointer',userSelect:'none',WebkitUserSelect:'none'}}>
                      <div style={{width:22,height:22,borderRadius:7,border:'1.5px solid',flexShrink:0,borderColor:t.done?'#4ade80':'rgba(255,255,255,0.15)',background:t.done?'#4ade80':'transparent',display:'flex',alignItems:'center',justifyContent:'center',transition:'all 0.15s'}}>
                        {t.done&&<span style={{fontSize:13,color:'#080f1a',fontWeight:900}}>✓</span>}
                      </div>
                      <span style={{fontSize:14,color:t.done?'rgba(255,255,255,0.25)':'#fff',textDecoration:t.done?'line-through':'none',lineHeight:1.3}}>{t.label}</span>
                    </div>
                  ))}
                </div>}

                <div style={{marginBottom:14}}>
                  <span style={S.label}>Service Notes</span>
                  <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="What was done, any issues..." style={{...S.input,resize:'vertical',minHeight:80,lineHeight:1.6}} />
                </div>

                <PhotoGrid slot="end" label={`End Photos ${activeJob.photo_required?'(required)':''}`} />

                <button onClick={handleComplete} disabled={submitting} style={{width:'100%',padding:'17px',borderRadius:16,border:'none',background:submitting?'rgba(255,255,255,0.07)':'linear-gradient(135deg,#c19c56,#e8c47a)',color:submitting?'rgba(255,255,255,0.25)':'#0a1929',fontSize:17,fontWeight:800,cursor:submitting?'not-allowed':'pointer',letterSpacing:0.3}}>
                  {submitting?'Saving...':'🏁 Complete Job'}
                </button>
              </div>
            )}

            {jobs.filter(j=>j.status==='assigned').map(j=>(
              <div key={j.id} style={S.card}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                  <div style={{flex:1,marginRight:10}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                      {j.job_category==='spot'&&<span style={{fontSize:9,background:'#c19c56',color:'#0a1929',padding:'2px 7px',borderRadius:20,fontWeight:800}}>SPOT</span>}
                      <span style={{fontSize:15,fontWeight:700,color:'#fff'}}>{j.title}</span>
                    </div>
                    <div style={{fontSize:10,color:'rgba(255,255,255,0.35)'}}>📅 {displayDate(j)} · {j.scheduled_time}</div>
                    {j.address?.startsWith('http')&&<a href={j.address} target="_blank" rel="noreferrer" style={{fontSize:10,color:'#60a5fa',textDecoration:'none',display:'block',marginTop:2}}>🗺 Maps</a>}
                  </div>
                  <div style={{fontSize:13,fontWeight:700,color:'#c19c56',flexShrink:0}}>¥{Number(j.spot_value||j.value||0).toLocaleString()}</div>
                </div>

                {j.description&&<div style={{fontSize:12,color:'rgba(255,255,255,0.5)',background:'rgba(255,255,255,0.03)',borderRadius:10,padding:'10px 12px',marginBottom:10,lineHeight:1.6,whiteSpace:'pre-line'}}>{j.description}</div>}

                {!activeJob&&<PhotoGrid slot="start" label="Start Photos" />}

                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                  <button onClick={()=>setSelectedJob(j)} style={{padding:'11px',borderRadius:12,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.6)',fontSize:13,cursor:'pointer',fontWeight:500}}>Details</button>
                  <button onClick={()=>handleStart(j)} disabled={submitting||!!activeJob} style={{padding:'11px',borderRadius:12,border:'none',background:activeJob?'rgba(255,255,255,0.04)':'linear-gradient(135deg,#0F6E56,#16a37e)',color:activeJob?'rgba(255,255,255,0.2)':'#fff',fontSize:13,fontWeight:700,cursor:activeJob?'not-allowed':'pointer'}}>
                    {activeJob?'Finish first':'▶ Start'}
                  </button>
                </div>
              </div>
            ))}

            {!activeJob&&jobs.filter(j=>j.status==='assigned').length===0&&<div style={{textAlign:'center',paddingTop:60}}><div style={{fontSize:52}}>☀️</div><div style={{fontSize:16,color:'rgba(255,255,255,0.35)',marginTop:12}}>No pending jobs</div></div>}
          </div>
        )}

        {/* SPOTS */}
        {tab==='spots'&&(
          <div>
            {spotJobs.length===0?<div style={{textAlign:'center',paddingTop:60}}><div style={{fontSize:48}}>⚡</div><div style={{fontSize:15,color:'rgba(255,255,255,0.3)',marginTop:12}}>No spot jobs pending</div></div>
            :spotJobs.map(j=>(
              <div key={j.id} style={{background:'rgba(193,156,86,0.06)',border:'1px solid rgba(193,156,86,0.15)',borderRadius:22,padding:18,marginBottom:14}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
                  <div style={{flex:1,marginRight:12}}>
                    <div style={{fontSize:17,fontWeight:700,color:'#fff',marginBottom:5}}>{j.title}</div>
                    <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:1}}>📅 {displayDate(j)} · {j.scheduled_time}</div>
                    {j.address?.startsWith('http')&&<a href={j.address} target="_blank" rel="noreferrer" style={{fontSize:10,color:'#60a5fa',textDecoration:'none'}}>🗺 Maps</a>}
                  </div>
                  <div style={{background:'rgba(193,156,86,0.15)',border:'1px solid rgba(193,156,86,0.25)',borderRadius:14,padding:'10px 14px',textAlign:'center',flexShrink:0}}>
                    <div style={{fontSize:9,color:'#c19c56',fontWeight:700,letterSpacing:1}}>EXTRA</div>
                    <div style={{fontSize:22,fontWeight:800,color:'#c19c56'}}>+¥{Number(j.spot_value||0).toLocaleString()}</div>
                  </div>
                </div>
                {j.description&&<div style={{fontSize:13,color:'rgba(255,255,255,0.5)',background:'rgba(255,255,255,0.03)',borderRadius:10,padding:'10px 12px',marginBottom:14,lineHeight:1.6}}>{j.description}</div>}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                  <button onClick={()=>handleAcceptSpot(j)} style={{padding:'15px',borderRadius:14,border:'none',background:'linear-gradient(135deg,#0F6E56,#16a37e)',color:'#fff',fontSize:15,fontWeight:700,cursor:'pointer'}}>✅ Accept</button>
                  <button onClick={()=>handleDeclineSpot(j)} style={{padding:'15px',borderRadius:14,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.45)',fontSize:15,fontWeight:700,cursor:'pointer'}}>✕ Decline</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* HISTORY */}
        {tab==='history'&&(
          <div>
            <div style={{display:'flex',gap:6,marginBottom:14,overflowX:'auto',paddingBottom:2}}>
              {[['all','All'],['upcoming','Upcoming'],['past','Done'],['cancelled','Cancelled']].map(([k,l])=>(
                <button key={k} onClick={()=>setHistoryFilter(k)} style={{padding:'7px 14px',borderRadius:20,border:'1px solid',flexShrink:0,borderColor:historyFilter===k?'#c19c56':'rgba(255,255,255,0.08)',background:historyFilter===k?'rgba(193,156,86,0.12)':'rgba(255,255,255,0.03)',color:historyFilter===k?'#c19c56':'rgba(255,255,255,0.4)',fontSize:12,fontWeight:historyFilter===k?600:400,cursor:'pointer'}}>
                  {l}
                </button>
              ))}
            </div>
            {(() => {
              const filtered = jobsForCalendar(historyFilter)
              if (filtered.length===0) return <div style={{textAlign:'center',paddingTop:40,color:'rgba(255,255,255,0.25)',fontSize:13}}>No jobs</div>
              const byDate = {}
              filtered.forEach(j=>{ const d=displayDate(j); if(!byDate[d]) byDate[d]=[]; byDate[d].push(j) })
              return Object.keys(byDate).sort((a,b)=>historyFilter==='upcoming'?a.localeCompare(b):b.localeCompare(a)).map(date=>(
                <div key={date} style={{marginBottom:18}}>
                  <div style={{fontSize:11,fontWeight:600,color:'rgba(255,255,255,0.4)',marginBottom:8,display:'flex',alignItems:'center',gap:10}}>
                    <div style={{height:1,flex:1,background:'rgba(255,255,255,0.06)'}} />
                    {new Date(date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})}
                    <div style={{height:1,flex:1,background:'rgba(255,255,255,0.06)'}} />
                  </div>
                  {byDate[date].map(j=>{
                    const duration = j.started_at&&j.completed_at?Math.round((new Date(j.completed_at)-new Date(j.started_at))/60000):null
                    const sc = {assigned:'#60a5fa',in_progress:'#fbbf24',completed:'#4ade80',cancelled:'rgba(255,255,255,0.2)'}[j.status]
                    return (
                      <div key={j.id} onClick={()=>setSelectedJob(j)} style={{...S.card,cursor:'pointer',marginBottom:8}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
                          <div style={{flex:1,marginRight:8}}>
                            <div style={{display:'flex',alignItems:'center',gap:5,marginBottom:3}}>
                              {j.job_category==='spot'&&<span style={{fontSize:8,background:'#c19c56',color:'#0a1929',padding:'1px 5px',borderRadius:20,fontWeight:800}}>SPOT</span>}
                              <span style={{fontSize:13,fontWeight:600,color:'#fff'}}>{j.title}</span>
                            </div>
                            <div style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>{j.scheduled_time}</div>
                          </div>
                          <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:3}}>
                            <div style={{fontSize:12,fontWeight:700,color:'#c19c56'}}>¥{Number(j.spot_value||j.value||0).toLocaleString()}</div>
                            <div style={{fontSize:8,color:sc,fontWeight:600,textTransform:'uppercase'}}>{j.status}</div>
                          </div>
                        </div>
                        <div style={{display:'flex',gap:12,fontSize:9,color:'rgba(255,255,255,0.25)'}}>
                          {j.started_at&&<span>▶ {new Date(j.started_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</span>}
                          {j.completed_at&&<span>🏁 {new Date(j.completed_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</span>}
                          {duration&&<span>⏱ {duration}m</span>}
                          <span style={{marginLeft:'auto'}}>details ›</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))
            })()}
          </div>
        )}

        {/* SALARY */}
        {tab==='salary'&&(
          <div>
            <div style={{background:'linear-gradient(135deg,rgba(193,156,86,0.15),rgba(193,156,86,0.03))',border:'1px solid rgba(193,156,86,0.2)',borderRadius:24,padding:'26px 20px',textAlign:'center',marginBottom:16}}>
              <div style={{fontSize:9,color:'rgba(255,255,255,0.3)',letterSpacing:2,textTransform:'uppercase',marginBottom:6}}>Earned This Month</div>
              <div style={{fontSize:46,fontWeight:800,color:'#c19c56',letterSpacing:-2,lineHeight:1}}>¥{(salaryData?.total||0).toLocaleString()}</div>
              <div style={{fontSize:11,color:'rgba(255,255,255,0.25)',marginTop:5}}>of ¥{(salaryData?.fixedMax||0).toLocaleString()} max</div>
              <div style={{height:5,background:'rgba(255,255,255,0.08)',borderRadius:3,margin:'12px 16px 6px',overflow:'hidden'}}>
                <div style={{height:'100%',borderRadius:3,background:'linear-gradient(90deg,#c19c56,#e8c47a)',width:Math.min(((salaryData?.base||0)/(salaryData?.fixedMax||1))*100,100)+'%',transition:'width 0.6s'}} />
              </div>
              <div style={{fontSize:10,color:'rgba(255,255,255,0.25)'}}>{salaryData?.workedDays||0} days · ¥{(salaryData?.dailyRate||0).toLocaleString()}/day</div>
              {(salaryData?.spotEarned||0)>0&&<div style={{fontSize:11,color:'rgba(193,156,86,0.6)',marginTop:6}}>+¥{salaryData.spotEarned.toLocaleString()} from ⚡ spot</div>}
              {salaryData?.projected&&<div style={{fontSize:10,color:'rgba(255,255,255,0.2)',marginTop:4}}>Projected if full month: ¥{salaryData.projected.toLocaleString()}</div>}
            </div>

            {advances.length>0&&<div style={{marginBottom:16}}>
              <span style={S.label}>Advances Received</span>
              {advances.map(a=>(
                <div key={a.id} style={{...S.card,display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <div><div style={{fontSize:13,fontWeight:600,color:'#fff'}}>¥{Number(a.amount).toLocaleString()}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:1}}>{a.created_at?.slice(0,10)} · {a.description}</div></div>
                  <span style={{fontSize:9,background:'rgba(248,113,113,0.1)',color:'#f87171',border:'1px solid rgba(248,113,113,0.2)',borderRadius:20,padding:'3px 9px',fontWeight:600}}>advance</span>
                </div>
              ))}
            </div>}

            {payments.length>0&&<div style={{marginBottom:16}}>
              <span style={S.label}>Upcoming Payments</span>
              {payments.map(p=>(
                <div key={p.id} style={{...S.card,display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <div><div style={{fontSize:15,fontWeight:700,color:'#fff'}}>¥{Number(p.amount).toLocaleString()}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:1}}>{p.payment_date} · {p.description||'Salary'}</div></div>
                  <span style={{fontSize:9,background:'rgba(96,165,250,0.1)',color:'#60a5fa',border:'1px solid rgba(96,165,250,0.2)',borderRadius:20,padding:'3px 9px',fontWeight:600,textTransform:'uppercase'}}>{p.status}</span>
                </div>
              ))}
            </div>}

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              {[['📋','Jobs',salaryData?.jobs||0],['⏱','Hours',(salaryData?.hours||0)+'h'],['💴','Base','¥'+(salaryData?.base||0).toLocaleString()],['⚡','Spot','¥'+(salaryData?.spotEarned||0).toLocaleString()]].map(([icon,l,v])=>(
                <div key={l} style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:16,padding:'14px 12px'}}>
                  <div style={{fontSize:22,marginBottom:8}}>{icon}</div>
                  <div style={{fontSize:20,fontWeight:700,color:'#fff'}}>{v}</div>
                  <div style={{fontSize:9,color:'rgba(255,255,255,0.3)',marginTop:3,textTransform:'uppercase',letterSpacing:0.5}}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TRANSPORT */}
        {tab==='transport'&&(
          <div>
            <div style={{marginBottom:16}}>
              <span style={S.label}>Submit Transport Claim</span>
              <div style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:20,padding:18}}>
                <div style={{marginBottom:12}}><span style={S.label}>Related Job</span><select value={claimForm.job_id} onChange={e=>setClaimForm(f=>({...f,job_id:e.target.value}))} style={{...S.input,appearance:'none'}}><option value="">No specific job</option>{allJobs.slice(0,30).map(j=><option key={j.id} value={j.id}>{j.title} · {j.scheduled_date}</option>)}</select></div>
                <div style={{marginBottom:12}}><span style={S.label}>Amount (¥) *</span><input type="number" value={claimForm.amount} onChange={e=>setClaimForm(f=>({...f,amount:e.target.value}))} placeholder="e.g. 280" style={S.input} /></div>
                <div style={{marginBottom:12}}><span style={S.label}>Route</span><input value={claimForm.route} onChange={e=>setClaimForm(f=>({...f,route:e.target.value}))} placeholder="Shibuya → Shinjuku" style={S.input} /></div>
                <div style={{marginBottom:16}}><span style={S.label}>Notes</span><input value={claimForm.description} onChange={e=>setClaimForm(f=>({...f,description:e.target.value}))} style={S.input} /></div>
                <div style={{marginBottom:16}}>
                  <span style={S.label}>Photos & Receipt</span>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                    <div>
                      <div style={{fontSize:9,color:'rgba(255,255,255,0.25)',marginBottom:5}}>PHOTO</div>
                      <div onClick={()=>claimPhotoRef.current.click()} style={{aspectRatio:'1',borderRadius:12,overflow:'hidden',cursor:'pointer',border:claimPhotoPreview?'2px solid #4ade80':'2px dashed rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.03)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:5,color:'rgba(255,255,255,0.3)'}}>
                        {claimPhotoPreview?<img src={claimPhotoPreview} style={{width:'100%',height:'100%',objectFit:'cover'}} />:<><span style={{fontSize:26}}>📷</span><span style={{fontSize:10}}>Photo</span></>}
                      </div>
                    </div>
                    <div>
                      <div style={{fontSize:9,color:'rgba(255,255,255,0.25)',marginBottom:5}}>RECEIPT</div>
                      <div onClick={()=>claimReceiptRef.current.click()} style={{aspectRatio:'1',borderRadius:12,overflow:'hidden',cursor:'pointer',border:claimReceiptPreview?'2px solid #4ade80':'2px dashed rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.03)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:5,color:'rgba(255,255,255,0.3)'}}>
                        {claimReceiptPreview?<img src={claimReceiptPreview} style={{width:'100%',height:'100%',objectFit:'cover'}} />:<><span style={{fontSize:26}}>🧾</span><span style={{fontSize:10}}>Receipt</span></>}
                      </div>
                    </div>
                  </div>
                </div>
                <button onClick={handleSubmitClaim} disabled={submittingClaim} style={{width:'100%',padding:'15px',borderRadius:14,border:'none',background:submittingClaim?'rgba(255,255,255,0.07)':'linear-gradient(135deg,#0F6E56,#16a37e)',color:submittingClaim?'rgba(255,255,255,0.25)':'#fff',fontSize:15,fontWeight:700,cursor:submittingClaim?'not-allowed':'pointer'}}>
                  {submittingClaim?'Submitting...':'📤 Submit Claim'}
                </button>
              </div>
            </div>
            <span style={S.label}>My Claims</span>
            {claims.length===0&&<div style={{textAlign:'center',color:'rgba(255,255,255,0.25)',fontSize:13,padding:'20px 0'}}>No claims yet</div>}
            {claims.map(c=>(
              <div key={c.id} style={S.card}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:5}}>
                  <div><div style={{fontSize:13,fontWeight:600,color:'#fff'}}>¥{Number(c.amount).toLocaleString()}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:1}}>{c.claim_date}{c.route&&` · ${c.route}`}</div></div>
                  <span style={{fontSize:9,borderRadius:20,padding:'3px 9px',fontWeight:600,textTransform:'uppercase',background:c.status==='approved'?'rgba(74,222,128,0.12)':c.status==='rejected'?'rgba(248,113,113,0.12)':'rgba(251,191,36,0.12)',color:c.status==='approved'?'#4ade80':c.status==='rejected'?'#f87171':'#fbbf24',border:`1px solid rgba(${c.status==='approved'?'74,222,128':c.status==='rejected'?'248,113,113':'251,191,36'},0.2)`}}>{c.status}</span>
                </div>
                {c.admin_note&&<div style={{fontSize:10,color:'rgba(255,255,255,0.35)',background:'rgba(255,255,255,0.03)',borderRadius:8,padding:'6px 8px',marginTop:4}}>Admin: {c.admin_note}</div>}
              </div>
            ))}
          </div>
        )}

        {/* CHAT */}
        {tab==='chat'&&(
          <div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 280px)'}}>
            <div style={{flex:1,overflowY:'auto',marginBottom:12}}>
              {messages.length===0&&<div style={{textAlign:'center',paddingTop:40,color:'rgba(255,255,255,0.25)',fontSize:13}}>No messages yet</div>}
              {messages.map(m=>(
                <div key={m.id} style={{display:'flex',justifyContent:m.sender==='employee'?'flex-end':'flex-start',marginBottom:10}}>
                  <div style={{maxWidth:'78%',background:m.sender==='employee'?'rgba(193,156,86,0.18)':'rgba(255,255,255,0.08)',border:`1px solid rgba(${m.sender==='employee'?'193,156,86':'255,255,255'},0.12)`,borderRadius:m.sender==='employee'?'18px 18px 4px 18px':'18px 18px 18px 4px',padding:'11px 15px'}}>
                    {m.sender==='admin'&&<div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:3,fontWeight:600}}>Admin</div>}
                    <div style={{fontSize:14,color:'#fff',lineHeight:1.5}}>{m.content}</div>
                    <div style={{fontSize:9,color:'rgba(255,255,255,0.25)',marginTop:4,textAlign:'right'}}>{new Date(m.created_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</div>
                  </div>
                </div>
              ))}
              <div ref={msgEndRef} />
            </div>
            <div style={{display:'flex',gap:8}}>
              <input value={newMsg} onChange={e=>setNewMsg(e.target.value)} onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&sendMessage()} placeholder="Message admin..." style={{...S.input,flex:1,borderRadius:22,padding:'12px 18px'}} />
              <button onClick={sendMessage} disabled={!newMsg.trim()} style={{width:46,height:46,borderRadius:'50%',border:'none',background:newMsg.trim()?'#c19c56':'rgba(255,255,255,0.07)',color:newMsg.trim()?'#0a1929':'rgba(255,255,255,0.3)',fontSize:20,cursor:newMsg.trim()?'pointer':'default',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700}}>›</button>
            </div>
          </div>
        )}

        {/* ACHIEVEMENTS */}
        {tab==='achievements'&&(
          <div>
            <div style={{fontSize:9,color:'rgba(255,255,255,0.3)',letterSpacing:1.5,textTransform:'uppercase',marginBottom:14}}>Badges — {badges.length}/{BADGE_DEFS.length} earned</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:20}}>
              {BADGE_DEFS.map(def=>{
                const earned = badges.find(b=>b.badge_key===def.key)
                return (
                  <div key={def.key} style={{background:earned?'rgba(193,156,86,0.08)':'rgba(255,255,255,0.03)',border:`1px solid rgba(${earned?'193,156,86':'255,255,255'},${earned?'0.18':'0.05'})`,borderRadius:16,padding:'16px 14px',opacity:earned?1:0.45}}>
                    <div style={{fontSize:30,marginBottom:8}}>{def.icon}</div>
                    <div style={{fontSize:13,fontWeight:600,color:earned?'#c19c56':'rgba(255,255,255,0.5)'}}>{def.name}</div>
                    <div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:3,lineHeight:1.4}}>{def.desc}</div>
                    {earned&&<div style={{fontSize:9,color:'rgba(193,156,86,0.5)',marginTop:6}}>✓ {new Date(earned.earned_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</div>}
                  </div>
                )
              })}
            </div>
            <div style={S.card}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}><span style={{fontSize:12,color:'rgba(255,255,255,0.5)'}}>Score</span><span style={{fontSize:15,fontWeight:800,color:scoreColor(empScore)}}>{empScore}/100</span></div>
              <div style={{height:6,background:'rgba(255,255,255,0.06)',borderRadius:3,overflow:'hidden',marginBottom:10}}><div style={{height:'100%',width:empScore+'%',borderRadius:3,background:scoreColor(empScore)}} /></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                {[['Total',allJobs.filter(j=>j.status==='completed').length,'Jobs'],['Month',salaryData?.jobs||0,'This mo.'],['Spot',allJobs.filter(j=>j.job_category==='spot'&&j.status==='completed').length,'Spot']].map(([l,v,sub])=>(
                  <div key={l} style={{textAlign:'center',background:'rgba(255,255,255,0.05)',borderRadius:12,padding:'10px 6px'}}>
                    <div style={{fontSize:20,fontWeight:700,color:'#fff'}}>{v}</div>
                    <div style={{fontSize:8,color:'rgba(255,255,255,0.3)',marginTop:2,textTransform:'uppercase'}}>{sub}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
