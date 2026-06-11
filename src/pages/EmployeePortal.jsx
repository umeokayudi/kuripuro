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
  { key:'perfect_week', name:'Perfect Week', icon:'🔥', desc:'5 jobs in one week, no complaints' },
  { key:'no_complaints', name:'Clean Record', icon:'✨', desc:'30 days without complaints' },
  { key:'early_bird', name:'Early Bird', icon:'🌅', desc:'Check in before 7am' },
  { key:'spot_master', name:'Spot Master', icon:'⚡', desc:'Accept 5 spot jobs' },
  { key:'streak_7', name:'7-Day Streak', icon:'🔥', desc:'Work 7 days in a row' },
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
  const [photos, setPhotos] = useState({ start:null, end:null })
  const [previews, setPreviews] = useState({ start:null, end:null })
  const [submitting, setSubmitting] = useState(false)
  const [gpsStatus, setGpsStatus] = useState('')
  const [salaryData, setSalaryData] = useState(null)
  const [payments, setPayments] = useState([])
  const [claims, setClaims] = useState([])
  const [messages, setMessages] = useState([])
  const [newMsg, setNewMsg] = useState('')
  const [badges, setBadges] = useState([])
  const [jobRating, setJobRating] = useState({ stars:5, comment:'' })
  const [showRating, setShowRating] = useState(null)
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
  const startRef = useRef()
  const endRef = useRef()
  const claimPhotoRef = useRef()
  const claimReceiptRef = useRef()
  const msgEndRef = useRef()

  useEffect(() => {
    loadAll()
    clockRef.current = setInterval(() => setClock(new Date()), 1000)
    // Poll messages every 15s
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
    const today = new Date().toISOString().split('T')[0]
    const [active, all, emp, pay, clm, bdg] = await Promise.all([
      supabase.from('jobs').select('*').eq('employee_id',user.id).in('status',['assigned','in_progress']).order('scheduled_date'),
      supabase.from('jobs').select('*').eq('employee_id',user.id).order('scheduled_date',{ascending:false}).limit(100),
      supabase.from('employees').select('*').eq('id',user.id).single(),
      supabase.from('salary_payments').select('*').eq('employee_id',user.id).gte('payment_date',today).order('payment_date').limit(5),
      supabase.from('transport_claims').select('*').eq('employee_id',user.id).order('created_at',{ascending:false}).limit(20),
      supabase.from('badges').select('*').eq('employee_id',user.id),
    ])
    const regular = (active.data||[]).filter(j=>j.job_category!=='spot'||j.spot_status==='accepted')
    const spots = (active.data||[]).filter(j=>j.job_category==='spot'&&j.spot_status==='pending')
    setJobs(regular); setSpotJobs(spots); setAllJobs(all.data||[])
    setPayments(pay.data||[]); setClaims(clm.data||[])
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
    const workedDays = new Set(completed.filter(j=>j.counts_as_work_day!==false).map(j=>j.scheduled_date)).size
    const fixedMax = empInfo?.fixed_salary || 0
    const monthlyDays = empInfo?.monthly_work_days || 22
    const dailyRate = fixedMax / monthlyDays
    let base = 0
    if (empInfo?.salary_type==='fixed') base = Math.min(Math.round(dailyRate * workedDays), fixedMax)
    else if (empInfo?.salary_type==='hourly') base = Math.round((totalMins/60)*(empInfo?.hourly_rate||0))
    else base = Math.round(fixedMax + (totalMins/60)*(empInfo?.hourly_rate||0))
    // Simulate remaining
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
    if (completed.length>=1 && !earned.includes('first_job')) toAward.push('first_job')
    if (completed.length>=5 && !earned.includes('jobs_5')) toAward.push('jobs_5')
    if (completed.length>=10 && !earned.includes('jobs_10')) toAward.push('jobs_10')
    if (completed.length>=25 && !earned.includes('jobs_25')) toAward.push('jobs_25')
    const accepted = allData.filter(j=>j.job_category==='spot'&&j.spot_status==='accepted')
    if (accepted.length>=5 && !earned.includes('spot_master')) toAward.push('spot_master')
    for (const key of toAward) {
      const def = BADGE_DEFS.find(b=>b.key===key)
      await supabase.from('badges').insert({ employee_id:user.id, badge_key:key, badge_name:def?.name })
      toast.success(`🏆 Badge earned: ${def?.name}!`)
    }
    if (toAward.length>0) loadAll()
  }

  const checkGPS = async (job) => {
    if (!job.gps_lat||!job.gps_lng) return true
    setGpsStatus('Checking...')
    try {
      const pos = await getCurrentPosition()
      const dist = distanceMeters(pos.lat,pos.lng,Number(job.gps_lat),Number(job.gps_lng))
      if (dist>100) { setGpsStatus(`${Math.round(dist)}m away`); toast.error(`Too far! ${Math.round(dist)}m.`); return false }
      setGpsStatus(`✓ ${Math.round(dist)}m`); return true
    } catch { setGpsStatus('GPS unavailable'); return true }
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
    let photoUrl = null
    if (photos.start) {
      const ext = photos.start.name.split('.').pop()
      await supabase.storage.from('service-photos').upload(`jobs/${job.id}/start.${ext}`,photos.start,{upsert:true})
      const { data:pd } = supabase.storage.from('service-photos').getPublicUrl(`jobs/${job.id}/start.${ext}`)
      photoUrl = pd.publicUrl
    }
    const { data, error } = await supabase.from('jobs').update({ status:'in_progress',started_at:new Date().toISOString(),photo_start_url:photoUrl }).eq('id',job.id).select().single()
    if (error) { toast.error(error.message); setSubmitting(false); return }
    const cl = job.checklist_template?job.checklist_template.split('\n').filter(Boolean).map(l=>({label:l,done:false})):[]
    setChecklist(cl); setActiveJob(data); toast.success('Started! ▶'); setSubmitting(false)
  }

  const handleComplete = async () => {
    if (activeJob.photo_required&&!photos.end) return toast.error('📷 Photo required!')
    setSubmitting(true)
    const ok = await checkGPS(activeJob)
    if (!ok) { setSubmitting(false); return }
    let photoUrl = null
    if (photos.end) {
      const ext = photos.end.name.split('.').pop()
      await supabase.storage.from('service-photos').upload(`jobs/${activeJob.id}/end.${ext}`,photos.end,{upsert:true})
      const { data:pd } = supabase.storage.from('service-photos').getPublicUrl(`jobs/${activeJob.id}/end.${ext}`)
      photoUrl = pd.publicUrl
    }
    await supabase.from('jobs').update({ status:'completed',completed_at:new Date().toISOString(),notes_employee:notes,photo_end_url:photoUrl,checklist_template:JSON.stringify(checklist) }).eq('id',activeJob.id)
    clearInterval(timerRef.current)
    const completedJob = activeJob
    setActiveJob(null); setElapsed(0); setChecklist([]); setNotes('')
    setPhotos({start:null,end:null}); setPreviews({start:null,end:null})
    toast.success('🎉 Job completed!')
    setShowRating(completedJob)
    loadAll(); setTab('home'); setSubmitting(false)
  }

  const submitRating = async () => {
    if (!showRating) return
    await supabase.from('job_ratings').insert({ job_id:showRating.id, employee_id:user.id, rating:jobRating.stars, comment:jobRating.comment })
    toast.success('Thanks for your feedback!')
    setShowRating(null); setJobRating({ stars:5, comment:'' })
  }

  const uploadFile = async (file, path) => {
    await supabase.storage.from('service-photos').upload(path,file,{upsert:true})
    const { data } = supabase.storage.from('service-photos').getPublicUrl(path)
    return data.publicUrl
  }

  const handleSubmitClaim = async () => {
    if (!claimForm.amount) return toast.error('Enter amount')
    setSubmittingClaim(true)
    const id = Date.now()
    const photoUrl = claimPhoto ? await uploadFile(claimPhoto,`claims/${user.id}/${id}_photo.${claimPhoto.name.split('.').pop()}`) : null
    const receiptUrl = claimReceipt ? await uploadFile(claimReceipt,`claims/${user.id}/${id}_receipt.${claimReceipt.name.split('.').pop()}`) : null
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
  const filteredAllJobs = allJobs.filter(j=>{ if(historyFilter==='upcoming') return j.status==='assigned'&&j.scheduled_date>=today; if(historyFilter==='past') return j.status==='completed'; if(historyFilter==='cancelled') return j.status==='cancelled'; return true })

  const S = {
    card: { background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:16, padding:'13px 14px', marginBottom:8 },
    label: { fontSize:10, color:'rgba(255,255,255,0.35)', letterSpacing:1.2, textTransform:'uppercase', marginBottom:7 },
    input: { width:'100%', padding:'12px', fontSize:14, borderRadius:12, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.04)', color:'#fff', fontFamily:'inherit', boxSizing:'border-box' },
  }

  const PhotoSlot = ({ slot, label, required }) => (
    <div>
      <input type="file" accept="image/*" capture="environment" ref={slot==='start'?startRef:endRef} style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(f){setPhotos(p=>({...p,[slot]:f}));setPreviews(p=>({...p,[slot]:URL.createObjectURL(f)}))}}} />
      <div onClick={()=>(slot==='start'?startRef:endRef).current.click()} style={{width:'100%',aspectRatio:'4/3',borderRadius:14,overflow:'hidden',cursor:'pointer',border:previews[slot]?'2px solid #4ade80':'2px dashed rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.02)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8,color:'rgba(255,255,255,0.3)'}}>
        {previews[slot]?<img src={previews[slot]} style={{width:'100%',height:'100%',objectFit:'cover'}} />:<><span style={{fontSize:36}}>📷</span><span style={{fontSize:13}}>{label}{required?' *':''}</span></>}
      </div>
      {previews[slot]&&<div style={{fontSize:11,color:'#4ade80',textAlign:'center',marginTop:5}}>✓ Ready</div>}
    </div>
  )

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
    const mats = job.materials ? job.materials.split('\n').filter(Boolean) : []
    const refs = (() => { try { return JSON.parse(job.reference_photos||'[]') } catch { return [] } })()
    return (
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',zIndex:200,display:'flex',flexDirection:'column',justifyContent:'flex-end'}} onClick={onClose}>
        <div style={{background:'#0d2137',borderRadius:'20px 20px 0 0',padding:20,maxHeight:'90vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
          <div style={{width:36,height:4,background:'rgba(255,255,255,0.15)',borderRadius:2,margin:'0 auto 16px'}} />
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:14}}>
            <div style={{flex:1,marginRight:10}}>
              <div style={{display:'flex',gap:6,marginBottom:4,alignItems:'center'}}>{job.job_category==='spot'&&<span style={{fontSize:9,background:'#c19c56',color:'#0a1929',padding:'2px 7px',borderRadius:20,fontWeight:800}}>SPOT</span>}<span style={{fontSize:17,fontWeight:700,color:'#fff'}}>{job.title}</span></div>
              <div style={{fontSize:11,color:'rgba(255,255,255,0.35)'}}>{job.client_name} · {job.scheduled_date}</div>
            </div>
            <div style={{fontSize:18,fontWeight:800,color:'#c19c56'}}>¥{Number(job.spot_value||job.value||0).toLocaleString()}</div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:7,marginBottom:14}}>
            {[['📍',job.address||'—'],['📅',job.scheduled_date||'—'],['▶ In',job.started_at?new Date(job.started_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):'—'],['🏁 Out',job.completed_at?new Date(job.completed_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):'—'],['⏱',duration?`${duration} min`:'—'],['Status',job.status]].map(([l,v])=>(
              <div key={l} style={{background:'rgba(255,255,255,0.05)',borderRadius:10,padding:'9px 11px'}}><div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:2}}>{l}</div><div style={{fontSize:12,fontWeight:500,color:'#fff'}}>{v}</div></div>
            ))}
          </div>
          {job.instructions&&<div style={{background:'rgba(255,255,255,0.04)',borderRadius:10,padding:'10px 12px',marginBottom:10}}><div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:3}}>📋 Instructions</div><div style={{fontSize:13,color:'rgba(255,255,255,0.65)',lineHeight:1.6,whiteSpace:'pre-line'}}>{job.instructions}</div></div>}
          {mats.length>0&&<div style={{marginBottom:10}}><div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:6,letterSpacing:1,textTransform:'uppercase'}}>🧹 Materials Needed</div>{mats.map((m,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}><div style={{width:6,height:6,borderRadius:'50%',background:'#c19c56',flexShrink:0}} /><span style={{fontSize:13,color:'rgba(255,255,255,0.65)'}}>{m}</span></div>)}</div>}
          {job.description&&<div style={{background:'rgba(255,255,255,0.04)',borderRadius:10,padding:'10px 12px',marginBottom:10}}><div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:3}}>Description</div><div style={{fontSize:13,color:'rgba(255,255,255,0.65)',lineHeight:1.5}}>{job.description}</div></div>}
          {refs.length>0&&<div style={{marginBottom:10}}><div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:6,letterSpacing:1,textTransform:'uppercase'}}>📸 Reference Photos</div><div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6}}>{refs.map((url,i)=><img key={i} src={url} style={{width:'100%',borderRadius:8,aspectRatio:'1',objectFit:'cover'}} />)}</div></div>}
          {cl.length>0&&<div style={{marginBottom:12}}><div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:7,letterSpacing:1,textTransform:'uppercase'}}>Checklist — {cl.filter(t=>t.done).length}/{cl.length}</div>{cl.map((t,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}><div style={{width:18,height:18,borderRadius:5,background:t.done?'#4ade80':'rgba(255,255,255,0.08)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{t.done&&<span style={{fontSize:11,color:'#080f1a',fontWeight:900}}>✓</span>}</div><span style={{fontSize:13,color:t.done?'rgba(255,255,255,0.35)':'rgba(255,255,255,0.7)',textDecoration:t.done?'line-through':'none'}}>{t.label}</span></div>)}</div>}
          {job.notes_employee&&<div style={{background:'rgba(255,255,255,0.04)',borderRadius:10,padding:'10px 12px',marginBottom:10}}><div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:3}}>Your Notes</div><div style={{fontSize:13,color:'rgba(255,255,255,0.65)',lineHeight:1.5}}>{job.notes_employee}</div></div>}
          {(job.photo_start_url||job.photo_end_url)&&<div style={{marginBottom:14}}><div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:7,letterSpacing:1,textTransform:'uppercase'}}>Photos</div><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>{job.photo_start_url&&<div><div style={{fontSize:9,color:'rgba(255,255,255,0.25)',marginBottom:3}}>START</div><img src={job.photo_start_url} style={{width:'100%',borderRadius:10,objectFit:'cover',aspectRatio:'4/3'}} /></div>}{job.photo_end_url&&<div><div style={{fontSize:9,color:'rgba(255,255,255,0.25)',marginBottom:3}}>END</div><img src={job.photo_end_url} style={{width:'100%',borderRadius:10,objectFit:'cover',aspectRatio:'4/3'}} /></div>}</div></div>}
          {job.gps_lat&&job.gps_lng&&<a href={`https://maps.google.com/?q=${job.gps_lat},${job.gps_lng}`} target="_blank" rel="noreferrer" style={{display:'block',background:'rgba(96,165,250,0.1)',border:'1px solid rgba(96,165,250,0.2)',borderRadius:10,padding:'10px 14px',textAlign:'center',color:'#60a5fa',fontSize:13,fontWeight:600,textDecoration:'none',marginBottom:10}}>🗺 Open in Maps</a>}
          <button onClick={onClose} style={{width:'100%',padding:'14px',borderRadius:13,border:'none',background:'rgba(255,255,255,0.07)',color:'rgba(255,255,255,0.5)',fontSize:14,fontWeight:600,cursor:'pointer'}}>Close</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{minHeight:'100vh',background:'#080f1a',display:'flex',flexDirection:'column',maxWidth:430,margin:'0 auto',WebkitTapHighlightColor:'transparent'}}>
      {selectedJob&&<JobModal job={selectedJob} onClose={()=>setSelectedJob(null)} />}

      {/* Rating modal */}
      {showRating&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{background:'#0d2137',borderRadius:20,padding:24,width:'100%',maxWidth:360}}>
            <div style={{fontSize:16,fontWeight:700,color:'#fff',marginBottom:4,textAlign:'center'}}>How was the job?</div>
            <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',marginBottom:18,textAlign:'center'}}>{showRating.title}</div>
            <div style={{display:'flex',justifyContent:'center',gap:8,marginBottom:16}}>
              {[1,2,3,4,5].map(n=><button key={n} onClick={()=>setJobRating(r=>({...r,stars:n}))} style={{fontSize:32,background:'none',border:'none',cursor:'pointer',opacity:n<=jobRating.stars?1:0.3}}>★</button>)}
            </div>
            <textarea value={jobRating.comment} onChange={e=>setJobRating(r=>({...r,comment:e.target.value}))} placeholder="Any comments about this location? (optional)" style={{...S.input,marginBottom:14,resize:'none',minHeight:70}} />
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              <button onClick={()=>setShowRating(null)} style={{padding:'13px',borderRadius:12,border:'1px solid rgba(255,255,255,0.08)',background:'none',color:'rgba(255,255,255,0.4)',fontSize:14,cursor:'pointer'}}>Skip</button>
              <button onClick={submitRating} style={{padding:'13px',borderRadius:12,border:'none',background:'#c19c56',color:'#0a1929',fontSize:14,fontWeight:700,cursor:'pointer'}}>Submit ★</button>
            </div>
          </div>
        </div>
      )}

      {/* BG */}
      <div style={{position:'fixed',top:-80,left:-80,width:260,height:260,background:'radial-gradient(circle,rgba(193,156,86,0.1) 0%,transparent 70%)',pointerEvents:'none',zIndex:0}} />

      {/* HEADER */}
      <div style={{position:'sticky',top:0,zIndex:50,background:'rgba(8,15,26,0.97)',backdropFilter:'blur(20px)',WebkitBackdropFilter:'blur(20px)',borderBottom:'1px solid rgba(255,255,255,0.05)',padding:'14px 14px 10px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
          <div>
            <div style={{fontSize:10,color:'rgba(255,255,255,0.25)',letterSpacing:2,textTransform:'uppercase'}}>KuriPuro</div>
            <div style={{fontSize:20,fontWeight:700,color:'#fff',letterSpacing:-0.5,marginTop:1,lineHeight:1}}>{user.name.split(' ')[0]}</div>
            <div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:2}}>{clock.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'short'})}</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{background:`rgba(${empScore>=90?'74,222,128':empScore>=70?'251,191,36':'248,113,113'},0.1)`,border:`1px solid rgba(${empScore>=90?'74,222,128':empScore>=70?'251,191,36':'248,113,113'},0.2)`,borderRadius:11,padding:'5px 10px',textAlign:'center'}}>
              <div style={{fontSize:18,fontWeight:800,color:scoreColor(empScore),lineHeight:1}}>{empScore}</div>
              <div style={{fontSize:8,color:'rgba(255,255,255,0.25)',textTransform:'uppercase',letterSpacing:0.8}}>Score</div>
            </div>
            <button onClick={()=>setMenuOpen(!menuOpen)} style={{width:36,height:36,borderRadius:10,background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.07)',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3.5,position:'relative'}}>
              {[0,1,2].map(i=><div key={i} style={{width:3.5,height:3.5,borderRadius:'50%',background:'rgba(255,255,255,0.55)'}} />)}
              {(unreadMsgs>0||spotJobs.length>0)&&<div style={{position:'absolute',top:3,right:3,width:8,height:8,borderRadius:'50%',background:'#f87171'}} />}
            </button>
          </div>
        </div>
        <div style={{fontSize:42,fontWeight:700,color:'#fff',fontFamily:'monospace',letterSpacing:-2,lineHeight:1,marginTop:8}}>
          {clock.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}
          <span style={{fontSize:20,color:'rgba(255,255,255,0.25)',marginLeft:2}}>{String(clock.getSeconds()).padStart(2,'0')}</span>
        </div>
        <div style={{display:'flex',gap:6,marginTop:8,flexWrap:'wrap'}}>
          {gpsStatus&&<div style={{background:'rgba(255,255,255,0.05)',borderRadius:20,padding:'3px 9px',fontSize:9,color:gpsStatus.includes('✓')?'#4ade80':'rgba(255,255,255,0.35)',fontWeight:500}}>📍 {gpsStatus}</div>}
          {activeJob&&<div style={{background:'rgba(74,222,128,0.1)',border:'1px solid rgba(74,222,128,0.2)',borderRadius:20,padding:'3px 10px',fontSize:11,color:'#4ade80',fontWeight:700,fontFamily:'monospace'}}>▶ {fmt(elapsed)}</div>}
          {spotJobs.length>0&&<div onClick={()=>setTab('spots')} style={{background:'rgba(193,156,86,0.1)',border:'1px solid rgba(193,156,86,0.2)',borderRadius:20,padding:'3px 9px',fontSize:9,color:'#c19c56',cursor:'pointer',fontWeight:600}}>⚡ {spotJobs.length}</div>}
          {unreadMsgs>0&&<div onClick={()=>setTab('chat')} style={{background:'rgba(248,113,113,0.1)',border:'1px solid rgba(248,113,113,0.2)',borderRadius:20,padding:'3px 9px',fontSize:9,color:'#f87171',cursor:'pointer',fontWeight:600}}>💬 {unreadMsgs} new</div>}
          {payments.length>0&&<div onClick={()=>setTab('salary')} style={{background:'rgba(96,165,250,0.1)',border:'1px solid rgba(96,165,250,0.2)',borderRadius:20,padding:'3px 9px',fontSize:9,color:'#60a5fa',cursor:'pointer',fontWeight:600}}>💴 payment</div>}
        </div>
      </div>

      {/* MENU */}
      {menuOpen&&(
        <div style={{position:'fixed',inset:0,zIndex:100}} onClick={()=>setMenuOpen(false)}>
          <div style={{position:'absolute',top:128,right:10,background:'#0d2137',border:'1px solid rgba(255,255,255,0.07)',borderRadius:18,overflow:'hidden',minWidth:196,boxShadow:'0 24px 80px rgba(0,0,0,0.6)'}} onClick={e=>e.stopPropagation()}>
            {menuItems.map(item=>(
              <button key={item.key} onClick={()=>{setTab(item.key);setMenuOpen(false)}} style={{width:'100%',padding:'13px 16px',border:'none',background:tab===item.key?'rgba(193,156,86,0.1)':'none',color:tab===item.key?'#c19c56':'rgba(255,255,255,0.7)',fontSize:13,fontWeight:tab===item.key?600:400,cursor:'pointer',display:'flex',alignItems:'center',gap:11,borderBottom:'1px solid rgba(255,255,255,0.04)',textAlign:'left'}}>
                <span style={{fontSize:16}}>{item.icon}</span>
                <span style={{flex:1}}>{item.label}</span>
                {item.badge>0&&<span style={{background:item.key==='chat'?'#f87171':'#c19c56',color:'#0a1929',borderRadius:20,padding:'1px 7px',fontSize:10,fontWeight:800}}>{item.badge}</span>}
              </button>
            ))}
            <div style={{height:1,background:'rgba(255,255,255,0.05)'}} />
            <button onClick={logout} style={{width:'100%',padding:'13px 16px',border:'none',background:'none',color:'#f87171',fontSize:13,cursor:'pointer',display:'flex',alignItems:'center',gap:11,textAlign:'left'}}>
              <span style={{fontSize:16}}>🚪</span> Logout
            </button>
          </div>
        </div>
      )}

      {/* CONTENT */}
      <div style={{flex:1,padding:'14px 12px 40px',overflowY:'auto',position:'relative',zIndex:1}}>

        {/* HOME */}
        {tab==='home'&&(
          <div>
            {activeJob&&<div onClick={()=>setTab('jobs')} style={{background:'linear-gradient(135deg,rgba(74,222,128,0.1),rgba(74,222,128,0.03))',border:'1px solid rgba(74,222,128,0.2)',borderRadius:18,padding:14,marginBottom:10,cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div><div style={{fontSize:9,color:'#4ade80',fontWeight:700,letterSpacing:1,marginBottom:3}}>● IN PROGRESS</div><div style={{fontSize:15,fontWeight:700,color:'#fff'}}>{activeJob.title}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginTop:2}}>Tap to continue →</div></div>
              <div style={{fontSize:24,fontWeight:700,color:'#4ade80',fontFamily:'monospace'}}>{fmt(elapsed)}</div>
            </div>}
            {payments.length>0&&<div onClick={()=>setTab('salary')} style={{background:'linear-gradient(135deg,rgba(96,165,250,0.08),rgba(96,165,250,0.02))',border:'1px solid rgba(96,165,250,0.15)',borderRadius:18,padding:14,marginBottom:10,cursor:'pointer'}}>
              <div style={{fontSize:9,color:'#60a5fa',fontWeight:700,letterSpacing:1,marginBottom:4}}>💴 NEXT PAYMENT</div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div><div style={{fontSize:20,fontWeight:800,color:'#fff'}}>¥{Number(payments[0].amount).toLocaleString()}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:1}}>{payments[0].payment_date} · {payments[0].description||'Salary'}</div></div>
                <div style={{fontSize:12,color:'#60a5fa'}}>View →</div>
              </div>
            </div>}
            <div style={S.label}>Today</div>
            {jobs.filter(j=>j.scheduled_date===today&&j.status==='assigned').length===0&&!activeJob&&<div style={{background:'rgba(255,255,255,0.02)',borderRadius:14,padding:16,textAlign:'center',color:'rgba(255,255,255,0.2)',fontSize:12,marginBottom:10}}>No jobs today</div>}
            {jobs.filter(j=>j.scheduled_date===today&&j.status==='assigned').map(j=>(
              <div key={j.id} style={S.card}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div style={{flex:1,marginRight:10}}><div style={{fontSize:13,fontWeight:600,color:'#fff'}}>{j.title}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:2}}>{j.scheduled_time||'—'} · {j.client_name||'—'}</div></div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}><div style={{fontSize:12,fontWeight:700,color:'#c19c56'}}>¥{Number(j.spot_value||j.value||0).toLocaleString()}</div><button onClick={()=>handleStart(j)} disabled={submitting||!!activeJob} style={{padding:'6px 12px',borderRadius:8,border:'none',background:activeJob?'rgba(255,255,255,0.04)':'#0F6E56',color:activeJob?'rgba(255,255,255,0.2)':'#fff',fontSize:11,fontWeight:700,cursor:activeJob?'not-allowed':'pointer'}}>{activeJob?'Busy':'▶'}</button></div>
                </div>
              </div>
            ))}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:4,marginBottom:12}}>
              {[['📋',salaryData?.jobs||0,'Jobs'],['⏱',(salaryData?.hours||0)+'h','Hours'],['💴','¥'+(salaryData?.total||0).toLocaleString(),'Month']].map(([icon,v,l])=>(
                <div key={l} style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.05)',borderRadius:12,padding:'10px 8px',textAlign:'center'}}>
                  <div style={{fontSize:16,marginBottom:3}}>{icon}</div><div style={{fontSize:13,fontWeight:700,color:'#fff'}}>{v}</div><div style={{fontSize:8,color:'rgba(255,255,255,0.25)',marginTop:1,textTransform:'uppercase',letterSpacing:0.5}}>{l}</div>
                </div>
              ))}
            </div>
            {/* Salary progress */}
            {salaryData&&salaryData.fixedMax>0&&<div style={{...S.card,marginBottom:10}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}><span style={{fontSize:11,color:'rgba(255,255,255,0.45)'}}>Salary Progress</span><span style={{fontSize:13,fontWeight:800,color:'#c19c56'}}>¥{salaryData.base.toLocaleString()} <span style={{fontSize:10,color:'rgba(255,255,255,0.25)'}}>/ ¥{salaryData.fixedMax.toLocaleString()}</span></span></div>
              <div style={{height:6,background:'rgba(255,255,255,0.06)',borderRadius:3,overflow:'hidden',marginBottom:5}}><div style={{height:'100%',width:Math.min((salaryData.base/salaryData.fixedMax)*100,100)+'%',borderRadius:3,background:'linear-gradient(90deg,#c19c56,#e8c47a)',transition:'width 0.6s'}} /></div>
              <div style={{fontSize:9,color:'rgba(255,255,255,0.25)'}}>{salaryData.workedDays} days · ¥{salaryData.dailyRate.toLocaleString()}/day · projected ¥{salaryData.projected?.toLocaleString()}</div>
            </div>}
            <div style={S.card}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:7}}><span style={{fontSize:11,color:'rgba(255,255,255,0.45)'}}>Performance</span><span style={{fontSize:14,fontWeight:800,color:scoreColor(empScore)}}>{empScore}/100</span></div>
              <div style={{height:5,background:'rgba(255,255,255,0.06)',borderRadius:3,overflow:'hidden'}}><div style={{height:'100%',width:empScore+'%',borderRadius:3,background:scoreColor(empScore),transition:'width 0.6s'}} /></div>
              <div style={{fontSize:9,color:'rgba(255,255,255,0.2)',marginTop:4}}>{empScore>=90?'🌟 Excellent':empScore>=70?'👍 Good':'⚠️ Needs improvement'}</div>
            </div>
            {badges.length>0&&<div style={{...S.card,marginTop:2}}>
              <div style={S.label}>Badges</div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {badges.slice(0,6).map(b=>{ const def=BADGE_DEFS.find(d=>d.key===b.badge_key); return <div key={b.id} title={def?.desc} style={{fontSize:22}}>{def?.icon||'🏅'}</div> })}
                {badges.length>6&&<div style={{fontSize:12,color:'rgba(255,255,255,0.3)',alignSelf:'center'}}>+{badges.length-6}</div>}
              </div>
            </div>}
            {spotJobs.length>0&&<div onClick={()=>setTab('spots')} style={{background:'rgba(193,156,86,0.07)',border:'1px solid rgba(193,156,86,0.15)',borderRadius:16,padding:'12px 14px',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:8}}>
              <div><div style={{fontSize:12,fontWeight:700,color:'#c19c56'}}>⚡ {spotJobs.length} Spot Job{spotJobs.length>1?'s':''}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:2}}>Tap to respond</div></div>
              <div style={{fontSize:18,color:'#c19c56'}}>›</div>
            </div>}
          </div>
        )}

        {/* JOBS */}
        {tab==='jobs'&&(
          <div>
            {activeJob&&(
              <div style={{background:'rgba(13,33,55,0.9)',border:'1px solid rgba(74,222,128,0.2)',borderRadius:20,padding:16,marginBottom:14}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                  <div><div style={{fontSize:9,color:'#4ade80',fontWeight:700,letterSpacing:1}}>IN PROGRESS</div><div style={{fontSize:16,fontWeight:700,color:'#fff',marginTop:2}}>{activeJob.title}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:1}}>📍 {activeJob.address}</div></div>
                  <div style={{fontSize:24,fontWeight:700,color:'#4ade80',fontFamily:'monospace'}}>{fmt(elapsed)}</div>
                </div>
                {activeJob.gps_lat&&<a href={`https://maps.google.com/?q=${activeJob.gps_lat},${activeJob.gps_lng}`} target="_blank" rel="noreferrer" style={{display:'block',background:'rgba(96,165,250,0.08)',border:'1px solid rgba(96,165,250,0.15)',borderRadius:8,padding:'8px 12px',textAlign:'center',color:'#60a5fa',fontSize:12,fontWeight:500,textDecoration:'none',marginBottom:10}}>🗺 Open location in Maps</a>}
                {checklist.length>0&&<div style={{marginBottom:12}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}><div style={S.label}>Checklist</div><div style={{fontSize:9,color:'#4ade80',fontWeight:600}}>{checklist.filter(t=>t.done).length}/{checklist.length}</div></div>
                  <div style={{height:3,background:'rgba(255,255,255,0.06)',borderRadius:2,marginBottom:8,overflow:'hidden'}}><div style={{height:'100%',width:(checklist.length?checklist.filter(t=>t.done).length/checklist.length*100:0)+'%',background:'#4ade80',borderRadius:2,transition:'width 0.3s'}} /></div>
                  {checklist.map((t,i)=>(
                    <div key={i} onClick={()=>setChecklist(c=>c.map((x,j)=>j===i?{...x,done:!x.done}:x))} style={{display:'flex',alignItems:'center',gap:11,padding:'11px 0',borderBottom:'1px solid rgba(255,255,255,0.04)',cursor:'pointer',userSelect:'none',WebkitUserSelect:'none'}}>
                      <div style={{width:21,height:21,borderRadius:6,border:'1.5px solid',flexShrink:0,borderColor:t.done?'#4ade80':'rgba(255,255,255,0.15)',background:t.done?'#4ade80':'transparent',display:'flex',alignItems:'center',justifyContent:'center',transition:'all 0.2s'}}>{t.done&&<span style={{fontSize:12,color:'#080f1a',fontWeight:900}}>✓</span>}</div>
                      <span style={{fontSize:14,color:t.done?'rgba(255,255,255,0.25)':'#fff',textDecoration:t.done?'line-through':'none',lineHeight:1.3}}>{t.label}</span>
                    </div>
                  ))}
                </div>}
                <div style={{marginBottom:10}}><div style={S.label}>Notes</div><textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Describe the service..." style={{...S.input,resize:'vertical',minHeight:70}} /></div>
                <div style={{marginBottom:14}}><div style={S.label}>End Photo {activeJob.photo_required&&<span style={{color:'#f87171'}}>· REQUIRED</span>}</div><PhotoSlot slot="end" label="End photo" required={activeJob.photo_required} /></div>
                <button onClick={handleComplete} disabled={submitting} style={{width:'100%',padding:'16px',borderRadius:15,border:'none',background:submitting?'rgba(255,255,255,0.07)':'linear-gradient(135deg,#c19c56,#e8c47a)',color:submitting?'rgba(255,255,255,0.25)':'#0a1929',fontSize:16,fontWeight:800,cursor:submitting?'not-allowed':'pointer'}}>
                  {submitting?'Saving...':'🏁 Complete Job'}
                </button>
              </div>
            )}
            {jobs.filter(j=>j.status==='assigned').map(j=>(
              <div key={j.id} style={{...S.card,borderRadius:18,padding:14,marginBottom:10}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                  <div style={{flex:1,marginRight:10}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>{j.job_category==='spot'&&<span style={{fontSize:9,background:'#c19c56',color:'#0a1929',padding:'1px 6px',borderRadius:20,fontWeight:800}}>SPOT</span>}<span style={{fontSize:14,fontWeight:700,color:'#fff'}}>{j.title}</span></div>
                    <div style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>📅 {j.scheduled_date}{j.scheduled_time&&` · ${j.scheduled_time}`}</div>
                    <div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:1}}>📍 {j.address}</div>
                  </div>
                  <div style={{fontSize:13,fontWeight:700,color:'#c19c56',flexShrink:0}}>¥{Number(j.spot_value||j.value||0).toLocaleString()}</div>
                </div>
                {j.gps_lat&&<a href={`https://maps.google.com/?q=${j.gps_lat},${j.gps_lng}`} target="_blank" rel="noreferrer" style={{display:'block',background:'rgba(96,165,250,0.06)',border:'1px solid rgba(96,165,250,0.12)',borderRadius:7,padding:'6px 10px',textAlign:'center',color:'#60a5fa',fontSize:11,fontWeight:500,textDecoration:'none',marginBottom:8}}>🗺 View in Maps</a>}
                {j.description&&<div style={{fontSize:12,color:'rgba(255,255,255,0.4)',background:'rgba(255,255,255,0.02)',borderRadius:8,padding:'8px 10px',marginBottom:8,lineHeight:1.5}}>{j.description}</div>}
                <div style={{display:'flex',gap:8}}>
                  <button onClick={()=>setSelectedJob(j)} style={{flex:1,padding:'10px',borderRadius:10,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(255,255,255,0.03)',color:'rgba(255,255,255,0.5)',fontSize:12,cursor:'pointer'}}>Details</button>
                  <button onClick={()=>handleStart(j)} disabled={submitting||!!activeJob} style={{flex:2,padding:'10px',borderRadius:10,border:'none',background:activeJob?'rgba(255,255,255,0.04)':'linear-gradient(135deg,#0F6E56,#16a37e)',color:activeJob?'rgba(255,255,255,0.2)':'#fff',fontSize:13,fontWeight:700,cursor:activeJob?'not-allowed':'pointer'}}>
                    {activeJob?'Finish active first':'▶ Start Job'}
                  </button>
                </div>
              </div>
            ))}
            {!activeJob&&jobs.filter(j=>j.status==='assigned').length===0&&<div style={{textAlign:'center',paddingTop:50}}><div style={{fontSize:44}}>☀️</div><div style={{fontSize:15,color:'rgba(255,255,255,0.35)',marginTop:10}}>No pending jobs</div></div>}
          </div>
        )}

        {/* SPOTS */}
        {tab==='spots'&&(
          <div>
            {spotJobs.length===0?<div style={{textAlign:'center',paddingTop:60}}><div style={{fontSize:44}}>⚡</div><div style={{fontSize:14,color:'rgba(255,255,255,0.3)',marginTop:10}}>No spot jobs pending</div></div>
            :spotJobs.map(j=>(
              <div key={j.id} style={{background:'rgba(193,156,86,0.06)',border:'1px solid rgba(193,156,86,0.15)',borderRadius:20,padding:16,marginBottom:12}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                  <div style={{flex:1,marginRight:10}}><div style={{fontSize:16,fontWeight:700,color:'#fff',marginBottom:4}}>{j.title}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginBottom:1}}>📅 {j.scheduled_date}{j.scheduled_time&&` · ${j.scheduled_time}`}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.35)'}}>📍 {j.address}</div></div>
                  <div style={{background:'rgba(193,156,86,0.12)',border:'1px solid rgba(193,156,86,0.2)',borderRadius:11,padding:'7px 11px',textAlign:'center',flexShrink:0}}><div style={{fontSize:8,color:'#c19c56',fontWeight:700,letterSpacing:1}}>EXTRA</div><div style={{fontSize:19,fontWeight:800,color:'#c19c56'}}>+¥{Number(j.spot_value||0).toLocaleString()}</div></div>
                </div>
                {j.description&&<div style={{fontSize:12,color:'rgba(255,255,255,0.45)',background:'rgba(255,255,255,0.02)',borderRadius:8,padding:'8px 10px',marginBottom:12,lineHeight:1.5}}>{j.description}</div>}
                {j.gps_lat&&<a href={`https://maps.google.com/?q=${j.gps_lat},${j.gps_lng}`} target="_blank" rel="noreferrer" style={{display:'block',background:'rgba(96,165,250,0.06)',border:'1px solid rgba(96,165,250,0.12)',borderRadius:8,padding:'7px',textAlign:'center',color:'#60a5fa',fontSize:11,fontWeight:500,textDecoration:'none',marginBottom:10}}>🗺 View Location</a>}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                  <button onClick={()=>handleAcceptSpot(j)} style={{padding:'14px',borderRadius:12,border:'none',background:'linear-gradient(135deg,#0F6E56,#16a37e)',color:'#fff',fontSize:14,fontWeight:700,cursor:'pointer'}}>✅ Accept</button>
                  <button onClick={()=>handleDeclineSpot(j)} style={{padding:'14px',borderRadius:12,border:'1px solid rgba(255,255,255,0.07)',background:'rgba(255,255,255,0.03)',color:'rgba(255,255,255,0.45)',fontSize:14,fontWeight:700,cursor:'pointer'}}>✕ Decline</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* HISTORY */}
        {tab==='history'&&(
          <div>
            <div style={{display:'flex',gap:6,marginBottom:12,overflowX:'auto',paddingBottom:2}}>
              {[['all','All'],['upcoming','Upcoming'],['past','Done'],['cancelled','Cancelled']].map(([k,l])=>(
                <button key={k} onClick={()=>setHistoryFilter(k)} style={{padding:'6px 13px',borderRadius:20,border:'1px solid',flexShrink:0,borderColor:historyFilter===k?'#c19c56':'rgba(255,255,255,0.08)',background:historyFilter===k?'rgba(193,156,86,0.12)':'rgba(255,255,255,0.02)',color:historyFilter===k?'#c19c56':'rgba(255,255,255,0.4)',fontSize:11,fontWeight:historyFilter===k?600:400,cursor:'pointer'}}>
                  {l}
                </button>
              ))}
            </div>
            {filteredAllJobs.length===0&&<div style={{textAlign:'center',paddingTop:40,color:'rgba(255,255,255,0.25)',fontSize:12}}>No jobs found</div>}
            {filteredAllJobs.map(j=>{
              const duration = j.started_at&&j.completed_at?Math.round((new Date(j.completed_at)-new Date(j.started_at))/60000):null
              const sc = {assigned:'#60a5fa',in_progress:'#fbbf24',completed:'#4ade80',cancelled:'rgba(255,255,255,0.15)'}[j.status]||'#fff'
              return (
                <div key={j.id} onClick={()=>setSelectedJob(j)} style={{...S.card,cursor:'pointer'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:5}}>
                    <div style={{flex:1,marginRight:8}}>
                      <div style={{display:'flex',alignItems:'center',gap:5,marginBottom:2}}>{j.job_category==='spot'&&<span style={{fontSize:8,background:'#c19c56',color:'#0a1929',padding:'1px 5px',borderRadius:20,fontWeight:800}}>SPOT</span>}<span style={{fontSize:13,fontWeight:600,color:'#fff'}}>{j.title}</span></div>
                      <div style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>{j.scheduled_date} · {j.client_name||'—'}</div>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:3}}><div style={{fontSize:12,fontWeight:700,color:'#c19c56'}}>¥{Number(j.spot_value||j.value||0).toLocaleString()}</div><div style={{fontSize:8,color:sc,fontWeight:600,textTransform:'uppercase'}}>{j.status}</div></div>
                  </div>
                  <div style={{display:'flex',gap:10,fontSize:9,color:'rgba(255,255,255,0.25)',marginTop:3}}>
                    {j.started_at&&<span>▶ {new Date(j.started_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</span>}
                    {j.completed_at&&<span>🏁 {new Date(j.completed_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</span>}
                    {duration&&<span>⏱ {duration}m</span>}
                    <span style={{marginLeft:'auto'}}>details ›</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* SALARY */}
        {tab==='salary'&&(
          <div>
            <div style={{background:'linear-gradient(135deg,rgba(193,156,86,0.15),rgba(193,156,86,0.03))',border:'1px solid rgba(193,156,86,0.18)',borderRadius:20,padding:'22px 18px',textAlign:'center',marginBottom:14}}>
              <div style={{fontSize:9,color:'rgba(255,255,255,0.3)',letterSpacing:2,textTransform:'uppercase',marginBottom:5}}>Earned This Month</div>
              <div style={{fontSize:42,fontWeight:800,color:'#c19c56',letterSpacing:-2,lineHeight:1}}>¥{(salaryData?.total||0).toLocaleString()}</div>
              <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginTop:6}}>of ¥{(salaryData?.fixedMax||0).toLocaleString()} max</div>
              <div style={{height:5,background:'rgba(255,255,255,0.08)',borderRadius:3,margin:'10px 20px 4px',overflow:'hidden'}}><div style={{height:'100%',borderRadius:3,background:'linear-gradient(90deg,#c19c56,#e8c47a)',width:Math.min(((salaryData?.base||0)/(salaryData?.fixedMax||1))*100,100)+'%',transition:'width 0.6s'}} /></div>
              <div style={{fontSize:10,color:'rgba(255,255,255,0.25)',marginTop:4}}>{salaryData?.workedDays||0} days · ¥{(salaryData?.dailyRate||0).toLocaleString()}/day</div>
              {(salaryData?.spotEarned||0)>0&&<div style={{fontSize:11,color:'rgba(193,156,86,0.6)',marginTop:6}}>+¥{salaryData.spotEarned.toLocaleString()} from ⚡ spot</div>}
              {salaryData?.projected&&<div style={{fontSize:11,color:'rgba(255,255,255,0.2)',marginTop:4}}>Projected: ¥{salaryData.projected.toLocaleString()} if {salaryData.remainWorkDays} more days worked</div>}
            </div>
            {payments.length>0&&<div style={{marginBottom:14}}>
              <div style={S.label}>Upcoming Payments</div>
              {payments.map(p=>(
                <div key={p.id} style={{...S.card,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div><div style={{fontSize:13,fontWeight:600,color:'#fff'}}>¥{Number(p.amount).toLocaleString()}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:2}}>{p.payment_date} · {p.description||'Salary'}</div></div>
                  <span style={{fontSize:9,background:'rgba(96,165,250,0.1)',color:'#60a5fa',border:'1px solid rgba(96,165,250,0.2)',borderRadius:20,padding:'3px 9px',fontWeight:600,textTransform:'uppercase'}}>{p.status}</span>
                </div>
              ))}
            </div>}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              {[['📋','Jobs',salaryData?.jobs||0],['⏱','Hours',(salaryData?.hours||0)+'h'],['💴','Base','¥'+(salaryData?.base||0).toLocaleString()],['⚡','Spot','¥'+(salaryData?.spotEarned||0).toLocaleString()]].map(([icon,l,v])=>(
                <div key={l} style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.05)',borderRadius:14,padding:'14px 12px'}}>
                  <div style={{fontSize:20,marginBottom:7}}>{icon}</div><div style={{fontSize:18,fontWeight:700,color:'#fff'}}>{v}</div><div style={{fontSize:9,color:'rgba(255,255,255,0.3)',marginTop:2,textTransform:'uppercase',letterSpacing:0.5}}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TRANSPORT */}
        {tab==='transport'&&(
          <div>
            <div style={{marginBottom:16}}>
              <div style={S.label}>Submit Transport Claim</div>
              <div style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:18,padding:16}}>
                <div style={{marginBottom:10}}><div style={S.label}>Related Job</div><select value={claimForm.job_id} onChange={e=>setClaimForm(f=>({...f,job_id:e.target.value}))} style={{...S.input,appearance:'none'}}><option value="">No specific job</option>{allJobs.slice(0,20).map(j=><option key={j.id} value={j.id}>{j.title} · {j.scheduled_date}</option>)}</select></div>
                <div style={{marginBottom:10}}><div style={S.label}>Amount (¥) *</div><input type="number" value={claimForm.amount} onChange={e=>setClaimForm(f=>({...f,amount:e.target.value}))} placeholder="e.g. 280" style={S.input} /></div>
                <div style={{marginBottom:10}}><div style={S.label}>Route</div><input value={claimForm.route} onChange={e=>setClaimForm(f=>({...f,route:e.target.value}))} placeholder="Shibuya → Shinjuku" style={S.input} /></div>
                <div style={{marginBottom:14}}><div style={S.label}>Notes</div><input value={claimForm.description} onChange={e=>setClaimForm(f=>({...f,description:e.target.value}))} placeholder="Additional notes" style={S.input} /></div>
                <div style={{marginBottom:14}}>
                  <div style={S.label}>Photos & Receipt</div>
                  <input type="file" accept="image/*" capture="environment" ref={claimPhotoRef} style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(f){setClaimPhoto(f);setClaimPhotoPreview(URL.createObjectURL(f))}}} />
                  <input type="file" accept="image/*,application/pdf" ref={claimReceiptRef} style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(f){setClaimReceipt(f);setClaimReceiptPreview(URL.createObjectURL(f))}}} />
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                    <div><div style={{fontSize:9,color:'rgba(255,255,255,0.25)',marginBottom:5}}>PHOTO</div><ImgUpload ref_={claimPhotoRef} preview={claimPhotoPreview} label="Photo" emoji="📷" /></div>
                    <div><div style={{fontSize:9,color:'rgba(255,255,255,0.25)',marginBottom:5}}>RECEIPT</div><ImgUpload ref_={claimReceiptRef} preview={claimReceiptPreview} label="Receipt" emoji="🧾" /></div>
                  </div>
                </div>
                <button onClick={handleSubmitClaim} disabled={submittingClaim} style={{width:'100%',padding:'14px',borderRadius:13,border:'none',background:submittingClaim?'rgba(255,255,255,0.07)':'linear-gradient(135deg,#0F6E56,#16a37e)',color:submittingClaim?'rgba(255,255,255,0.25)':'#fff',fontSize:14,fontWeight:700,cursor:submittingClaim?'not-allowed':'pointer'}}>
                  {submittingClaim?'Submitting...':'📤 Submit Claim'}
                </button>
              </div>
            </div>
            <div style={S.label}>My Claims</div>
            {claims.length===0&&<div style={{textAlign:'center',color:'rgba(255,255,255,0.25)',fontSize:12,padding:'20px 0'}}>No claims yet</div>}
            {claims.map(c=>(
              <div key={c.id} style={S.card}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:5}}>
                  <div style={{flex:1,marginRight:8}}><div style={{fontSize:13,fontWeight:600,color:'#fff'}}>¥{Number(c.amount).toLocaleString()}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:1}}>{c.claim_date}{c.route&&` · ${c.route}`}</div>{c.job_title&&<div style={{fontSize:10,color:'rgba(255,255,255,0.25)'}}>Job: {c.job_title}</div>}</div>
                  <span style={{fontSize:9,borderRadius:20,padding:'3px 9px',fontWeight:600,textTransform:'uppercase',background:c.status==='approved'?'rgba(74,222,128,0.12)':c.status==='rejected'?'rgba(248,113,113,0.12)':'rgba(251,191,36,0.12)',color:c.status==='approved'?'#4ade80':c.status==='rejected'?'#f87171':'#fbbf24',border:`1px solid rgba(${c.status==='approved'?'74,222,128':c.status==='rejected'?'248,113,113':'251,191,36'},0.2)`}}>{c.status}</span>
                </div>
                {c.admin_note&&<div style={{fontSize:10,color:'rgba(255,255,255,0.35)',background:'rgba(255,255,255,0.03)',borderRadius:7,padding:'6px 8px',marginTop:4}}>Admin: {c.admin_note}</div>}
                <div style={{display:'flex',gap:6,marginTop:5}}>{c.photo_url&&<a href={c.photo_url} target="_blank" rel="noreferrer" style={{fontSize:9,color:'#60a5fa',textDecoration:'none'}}>📷 Photo</a>}{c.receipt_url&&<a href={c.receipt_url} target="_blank" rel="noreferrer" style={{fontSize:9,color:'#60a5fa',textDecoration:'none'}}>🧾 Receipt</a>}</div>
              </div>
            ))}
          </div>
        )}

        {/* CHAT */}
        {tab==='chat'&&(
          <div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 260px)'}}>
            <div style={{flex:1,overflowY:'auto',marginBottom:10}}>
              {messages.length===0&&<div style={{textAlign:'center',paddingTop:40,color:'rgba(255,255,255,0.25)',fontSize:12}}>No messages yet. Send a message to admin.</div>}
              {messages.map(m=>(
                <div key={m.id} style={{display:'flex',justifyContent:m.sender==='employee'?'flex-end':'flex-start',marginBottom:8}}>
                  <div style={{maxWidth:'78%',background:m.sender==='employee'?'rgba(193,156,86,0.2)':'rgba(255,255,255,0.07)',border:`1px solid rgba(${m.sender==='employee'?'193,156,86':'255,255,255'},0.15)`,borderRadius:m.sender==='employee'?'16px 16px 4px 16px':'16px 16px 16px 4px',padding:'10px 14px'}}>
                    {m.sender==='admin'&&<div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:3}}>Admin</div>}
                    <div style={{fontSize:13,color:'#fff',lineHeight:1.5}}>{m.content}</div>
                    <div style={{fontSize:9,color:'rgba(255,255,255,0.25)',marginTop:3,textAlign:'right'}}>{new Date(m.created_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</div>
                  </div>
                </div>
              ))}
              <div ref={msgEndRef} />
            </div>
            <div style={{display:'flex',gap:8,paddingBottom:8}}>
              <input value={newMsg} onChange={e=>setNewMsg(e.target.value)} onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&sendMessage()} placeholder="Type a message..." style={{...S.input,flex:1,borderRadius:20,padding:'12px 16px'}} />
              <button onClick={sendMessage} disabled={!newMsg.trim()} style={{width:44,height:44,borderRadius:'50%',border:'none',background:newMsg.trim()?'#c19c56':'rgba(255,255,255,0.06)',color:newMsg.trim()?'#0a1929':'rgba(255,255,255,0.3)',fontSize:18,cursor:newMsg.trim()?'pointer':'default',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center'}}>›</button>
            </div>
          </div>
        )}

        {/* ACHIEVEMENTS */}
        {tab==='achievements'&&(
          <div>
            <div style={{fontSize:9,color:'rgba(255,255,255,0.35)',letterSpacing:1.5,textTransform:'uppercase',marginBottom:14}}>Badges — {badges.length}/{BADGE_DEFS.length}</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:20}}>
              {BADGE_DEFS.map(def=>{
                const earned = badges.find(b=>b.badge_key===def.key)
                return (
                  <div key={def.key} style={{background:earned?'rgba(193,156,86,0.1)':'rgba(255,255,255,0.03)',border:`1px solid rgba(${earned?'193,156,86':'255,255,255'},${earned?'0.2':'0.05'})`,borderRadius:14,padding:'14px 12px',opacity:earned?1:0.5}}>
                    <div style={{fontSize:28,marginBottom:6}}>{def.icon}</div>
                    <div style={{fontSize:13,fontWeight:600,color:earned?'#c19c56':'rgba(255,255,255,0.5)'}}>{def.name}</div>
                    <div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:3,lineHeight:1.4}}>{def.desc}</div>
                    {earned&&<div style={{fontSize:9,color:'rgba(193,156,86,0.6)',marginTop:5}}>✓ Earned {new Date(earned.earned_at).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</div>}
                  </div>
                )
              })}
            </div>
            <div style={S.card}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:7}}><span style={{fontSize:11,color:'rgba(255,255,255,0.45)'}}>Performance Score</span><span style={{fontSize:14,fontWeight:800,color:scoreColor(empScore)}}>{empScore}/100</span></div>
              <div style={{height:6,background:'rgba(255,255,255,0.06)',borderRadius:3,overflow:'hidden',marginBottom:5}}><div style={{height:'100%',width:empScore+'%',borderRadius:3,background:scoreColor(empScore),transition:'width 0.6s'}} /></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:10}}>
                {[['Total Jobs',allJobs.filter(j=>j.status==='completed').length],['This Month',salaryData?.jobs||0],['Spot Jobs',allJobs.filter(j=>j.job_category==='spot'&&j.status==='completed').length]].map(([l,v])=>(
                  <div key={l} style={{textAlign:'center',background:'rgba(255,255,255,0.04)',borderRadius:10,padding:'10px 6px'}}>
                    <div style={{fontSize:18,fontWeight:700,color:'#fff'}}>{v}</div>
                    <div style={{fontSize:9,color:'rgba(255,255,255,0.3)',marginTop:2}}>{l}</div>
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

function ImgUpload({ ref_, preview, label, emoji }) {
  return (
    <div onClick={()=>ref_.current.click()} style={{aspectRatio:'1',borderRadius:12,overflow:'hidden',cursor:'pointer',border:preview?'2px solid #4ade80':'2px dashed rgba(255,255,255,0.08)',background:'rgba(255,255,255,0.02)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:5,color:'rgba(255,255,255,0.25)'}}>
      {preview?<img src={preview} style={{width:'100%',height:'100%',objectFit:'cover'}} />:<><span style={{fontSize:26}}>{emoji}</span><span style={{fontSize:10}}>{label}</span></>}
    </div>
  )
}
