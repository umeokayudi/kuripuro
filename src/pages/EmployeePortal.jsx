import { useState, useEffect, useRef } from 'react'
import { generateDailyReport, generatePayslip, generatePayslipJP } from '../lib/generatePDF'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { distanceMeters, getCurrentPosition } from '../lib/geocode'
import toast from 'react-hot-toast'

const BADGE_DEFS = [
  { key:'first_job', name:'First Job', icon:'🎯', desc:'Complete your first job' },
  { key:'jobs_5', name:'5 Jobs', icon:'⭐', desc:'Complete 5 jobs' },
  { key:'jobs_10', name:'10 Jobs', icon:'🌟', desc:'Complete 10 jobs' },
  { key:'jobs_25', name:'25 Jobs', icon:'🏆', desc:'Complete 25 jobs' },
  { key:'spot_master', name:'Spot Master', icon:'⚡', desc:'Accept 5 spot jobs' },
  { key:'perfect_week', name:'Perfect Week', icon:'🔥', desc:'5 jobs in one week' },
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
  const [jobPhotos, setJobPhotos] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [gpsStatus, setGpsStatus] = useState('')
  const [salaryData, setSalaryData] = useState(null)
  const [payments, setPayments] = useState([])
  const [advances, setAdvances] = useState([])
  const [claims, setClaims] = useState([])
  const [messages, setMessages] = useState([])
  const [newMsg, setNewMsg] = useState('')
  const [badges, setBadges] = useState([])
  const [clock, setClock] = useState(new Date())
  const [empScore, setEmpScore] = useState(100)
  const [empData, setEmpData] = useState(null)
  const [selectedJob, setSelectedJob] = useState(null)
  const [claimForm, setClaimForm] = useState({ job_id:'', amount:'', route:'', description:'' })
  const [claimPhoto, setClaimPhoto] = useState(null)
  const [claimReceipt, setClaimReceipt] = useState(null)
  const [claimPhotoPreview, setClaimPhotoPreview] = useState(null)
  const [claimReceiptPreview, setClaimReceiptPreview] = useState(null)
  const [submittingClaim, setSubmittingClaim] = useState(false)
  const [showSignature, setShowSignature] = useState(false)
  const [signatureJob, setSignatureJob] = useState(null)
  const [unreadMsgs, setUnreadMsgs] = useState(0)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [lang, setLang] = useState(localStorage.getItem('emp_lang')||'en')
  const t = (en, jp) => lang==='jp' ? jp : en
  const setLanguage = (l) => { setLang(l); localStorage.setItem('emp_lang', l) }

  useEffect(() => {
    const on = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online',on); window.removeEventListener('offline',off) }
  }, [])
  const timerRef = useRef()
  const clockRef = useRef()
  const photoInputRef = useRef()
  const claimPhotoRef = useRef()
  const claimReceiptRef = useRef()
  const msgEndRef = useRef()

  useEffect(() => {
    loadAll()
    clockRef.current = setInterval(() => setClock(new Date()), 1000)
    const msgPoll = setInterval(loadMessages, 1000)
    // Ping presence every 60s
    const pingPresence = async () => {
      await supabase.from('employees').update({ last_seen: new Date().toISOString(), is_online: true }).eq('id', user.id)
    }
    pingPresence()
    const presencePoll = setInterval(pingPresence, 60000)
    // Set offline on unmount
    return () => {
      clearInterval(clockRef.current)
      clearInterval(timerRef.current)
      clearInterval(msgPoll)
      clearInterval(presencePoll)
      supabase.from('employees').update({ is_online: false }).eq('id', user.id)
    }

  }, [])

  useEffect(() => {
    if (activeJob?.started_at) {
      const start = new Date(activeJob.started_at)
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now()-start)/1000)), 1000)
    }
    return () => clearInterval(timerRef.current)
  }, [activeJob])

  const [userScrolled, setUserScrolled] = useState(false)
  const chatContainerRef = useRef()

  useEffect(() => {
    if (tab==='chat') {
      markRead()
      // Only auto-scroll if user hasn't scrolled up
      if (!userScrolled) {
        setTimeout(()=>msgEndRef.current?.scrollIntoView({behavior:'smooth'}),100)
      }
    }
  }, [tab, messages])

  const handleChatScroll = (e) => {
    const el = e.target
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
    setUserScrolled(!isAtBottom)
  }

  const loadAll = async () => {
    const today = new Date().toISOString().split('T')[0]
    const [active, all, emp, pay, adv, clm, bdg] = await Promise.all([
      supabase.from('jobs').select('*').eq('employee_id',user.id).in('status',['assigned','in_progress']).order('scheduled_date').order('scheduled_time'),
      supabase.from('jobs').select('*').eq('employee_id',user.id).order('scheduled_date',{ascending:false}).limit(200),
      supabase.from('employees').select('*').eq('id',user.id).single(),
      supabase.from('salary_payments').select('*').eq('employee_id',user.id).gte('payment_date',today).order('payment_date').limit(10),
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
      setChecklist(inProgress.checklist_template?inProgress.checklist_template.split('\n').filter(Boolean).map(l=>({label:l,done:false})):[])
    }
    calcSalary(all.data||[], emp.data)
    loadMessages()
    awardBadges(all.data||[], bdg.data||[])
  }

  const loadMessages = async () => {
    const { data } = await supabase.from('messages').select('*').eq('employee_id',user.id).order('created_at').limit(50)
    const newUnread = (data||[]).filter(m=>m.sender==='admin'&&!m.read).length
    setMessages(prev => {
      const prevUnread = prev.filter(m=>m.sender==='admin'&&!m.read).length
      if (newUnread > prevUnread && prev.length > 0) {
        toast('💬 New message from admin!', { icon:'💬', duration:4000 })
      }
      return data||[]
    })
    setUnreadMsgs(newUnread)
  }

  const markRead = async () => {
    await supabase.from('messages').update({read:true}).eq('employee_id',user.id).eq('sender','admin').eq('read',false)
    setUnreadMsgs(0)
  }

  const markEmployeeMsgRead = async (msgId) => {
    await supabase.from('messages').update({read:true}).eq('id',msgId)
  }

  

  const sendMessage = async () => {
    if (!newMsg.trim()) return
    await supabase.from('messages').insert({ employee_id:user.id, employee_name:user.name, sender:'employee', content:newMsg.trim(), read:false })
    setNewMsg(''); loadMessages()
  }

  const calcSalary = (allData, empInfo) => {
    const month = new Date().toISOString().slice(0,7)
    const todayStr = new Date().toISOString().split('T')[0]
    const completed = allData.filter(j=>j.status==='completed'&&j.scheduled_date?.startsWith(month)&&j.scheduled_date<=todayStr)
    const totalMins = completed.reduce((s,j)=>{ if(!j.started_at||!j.completed_at) return s; return s+(new Date(j.completed_at)-new Date(j.started_at))/60000 },0)
    const spotEarned = completed.filter(j=>j.job_category==='spot').reduce((s,j)=>s+Number(j.spot_value||0),0)
    const workedDaySet = new Set()
    completed.filter(j=>j.counts_as_work_day!==false).forEach(j=>{
      if (!j.scheduled_date) return
      const hour = parseInt((j.scheduled_time||'12:00').split(':')[0])
      if (hour < 6) {
        const d = new Date(j.scheduled_date+'T12:00:00'); d.setDate(d.getDate()-1)
        workedDaySet.add(d.toISOString().split('T')[0])
      } else workedDaySet.add(j.scheduled_date)
    })
    const workedDays = workedDaySet.size
    const fixedMax = empInfo?.fixed_salary||0
    const monthlyDays = empInfo?.monthly_work_days||22
    const dailyRate = fixedMax/monthlyDays
    let base = empInfo?.salary_type==='fixed' ? Math.min(Math.round(dailyRate*workedDays),fixedMax)
             : empInfo?.salary_type==='hourly' ? Math.round((totalMins/60)*(empInfo?.hourly_rate||0))
             : Math.round(fixedMax+(totalMins/60)*(empInfo?.hourly_rate||0))
    const now = new Date()
    const daysInMonth = new Date(now.getFullYear(),now.getMonth()+1,0).getDate()
    let remain = 0
    for (let d=now.getDate()+1;d<=daysInMonth;d++) { const day=new Date(now.getFullYear(),now.getMonth(),d).getDay(); if(day!==0&&day!==6) remain++ }
    setSalaryData({ jobs:completed.length, hours:(totalMins/60).toFixed(1), base, spotEarned, total:base+spotEarned, workedDays, fixedMax, dailyRate:Math.round(dailyRate), projected:Math.min(base+Math.round(dailyRate*remain),fixedMax) })
  }

  const awardBadges = async (allData, existing) => {
    const earned = existing.map(b=>b.badge_key)
    const done = allData.filter(j=>j.status==='completed')
    const toAward = []
    if (done.length>=1&&!earned.includes('first_job')) toAward.push('first_job')
    if (done.length>=5&&!earned.includes('jobs_5')) toAward.push('jobs_5')
    if (done.length>=10&&!earned.includes('jobs_10')) toAward.push('jobs_10')
    if (done.length>=25&&!earned.includes('jobs_25')) toAward.push('jobs_25')
    for (const key of toAward) {
      const def = BADGE_DEFS.find(b=>b.key===key)
      await supabase.from('badges').insert({ employee_id:user.id, badge_key:key, badge_name:def?.name })
      toast.success(`🏆 Badge: ${def?.name}!`)
    }
  }

  const checkGPS = async (job) => {
    if (!job.gps_lat||!job.gps_lng) return true
    setGpsStatus('📍 Checking...')
    try {
      const pos = await getCurrentPosition()
      const dist = distanceMeters(pos.lat,pos.lng,Number(job.gps_lat),Number(job.gps_lng))
      if (dist>100) {
        setGpsStatus(`⚠️ ${Math.round(dist)}m away`)
        return { ok: true, dist: Math.round(dist), override: true }
      }
      setGpsStatus(`✅ ${Math.round(dist)}m`)
      return { ok: true, dist: Math.round(dist), override: false }
    } catch {
      setGpsStatus('⚠️ GPS unavailable')
      return { ok: true, dist: null, override: true }
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
    const gpsResult = await checkGPS(job)
    if (gpsResult.override) {
      const proceed = window.confirm(`⚠️ GPS shows you are ${gpsResult.dist?gpsResult.dist+'m':'unknown distance'} from the location.\n\nProceed anyway? This will be logged in the report.`)
      if (!proceed) { setSubmitting(false); setGpsStatus(''); return }
    }
    let photoUrl = null
    const startPhotos = jobPhotos.filter(p=>p.slot==='start')
    for (let i=0;i<startPhotos.length;i++) {
      const ext = startPhotos[i].file.name.split('.').pop()
      await supabase.storage.from('service-photos').upload(`jobs/${job.id}/start_${i}.${ext}`,startPhotos[i].file,{upsert:true})
      if (i===0) { const { data:pd } = supabase.storage.from('service-photos').getPublicUrl(`jobs/${job.id}/start_0.${ext}`); photoUrl=pd.publicUrl }
    }
    const { data, error } = await supabase.from('jobs').update({ status:'in_progress',started_at:new Date().toISOString(),photo_start_url:photoUrl }).eq('id',job.id).select().single()
    if (error) { toast.error(error.message); setSubmitting(false); return }
    setChecklist(job.checklist_template?job.checklist_template.split('\n').filter(Boolean).map(l=>({label:l,done:false})):[])
    setActiveJob(data); setJobPhotos([]); toast.success('✅ Started!'); setSubmitting(false)
  }

  const handleCompleteWithSig = (job) => {
    setSignatureJob(job)
    setShowSignature(true)
  }

  const handleComplete = async (sigDataUrl) => {
    const endPhotos = jobPhotos.filter(p=>p.slot==='end')
    if (activeJob.photo_required&&endPhotos.length===0) return toast.error('📷 Photo required!')
    setSubmitting(true)
    const gpsResult = await checkGPS(activeJob)
    if (gpsResult.override) {
      const proceed = window.confirm(`⚠️ GPS shows you are ${gpsResult.dist?gpsResult.dist+'m':'unknown distance'} from the location.\n\nProceed anyway? This will be logged in the report.`)
      if (!proceed) { setSubmitting(false); return }
    }
    let endPhotoUrl = null
    for (let i=0;i<endPhotos.length;i++) {
      const ext = endPhotos[i].file.name.split('.').pop()
      await supabase.storage.from('service-photos').upload(`jobs/${activeJob.id}/end_${i}.${ext}`,endPhotos[i].file,{upsert:true})
      if (i===0) { const { data:pd } = supabase.storage.from('service-photos').getPublicUrl(`jobs/${activeJob.id}/end_0.${ext}`); endPhotoUrl=pd.publicUrl }
    }
    await supabase.from('jobs').update({ status:'completed',completed_at:new Date().toISOString(),notes_employee:notes,photo_end_url:endPhotoUrl,checklist_template:JSON.stringify(checklist),signature_url:sigDataUrl||null,gps_end_distance:gpsResult?.dist||null,gps_override:gpsResult?.override||false }).eq('id',activeJob.id)
    clearInterval(timerRef.current)
    setActiveJob(null); setElapsed(0); setChecklist([]); setNotes(''); setJobPhotos([])
    toast.success('🎉 Job completed!'); loadAll(); setSubmitting(false)
  }

  const addPhoto = (slot, files) => {
    const cur = jobPhotos.filter(p=>p.slot===slot).length
    const toAdd = Array.from(files).slice(0, 10-cur)
    setJobPhotos(p=>[...p, ...toAdd.map(file=>({ file, preview:URL.createObjectURL(file), slot, id:Date.now()+Math.random() }))])
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
    const photoUrl = claimPhoto ? await uploadFile(claimPhoto,`claims/${user.id}/${id}_p.${claimPhoto.name.split('.').pop()}`) : null
    const receiptUrl = claimReceipt ? await uploadFile(claimReceipt,`claims/${user.id}/${id}_r.${claimReceipt.name.split('.').pop()}`) : null
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

  const displayDate = (job) => job.scheduled_date

  const todayJobs = jobs.filter(j=>j.scheduled_date===today||displayDate(j)===today).sort((a,b)=>(a.sequence_order||99)-(b.sequence_order||99))

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
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:4}}>
          {photos.map(p=>(
            <div key={p.id} style={{position:'relative',aspectRatio:'1',borderRadius:10,overflow:'hidden'}}>
              <img src={p.preview} style={{width:'100%',height:'100%',objectFit:'cover'}} />
              <button onClick={()=>setJobPhotos(ps=>ps.filter(ph=>ph.id!==p.id))} style={{position:'absolute',top:3,right:3,width:20,height:20,borderRadius:'50%',background:'rgba(0,0,0,0.7)',border:'none',color:'#fff',fontSize:11,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
            </div>
          ))}
          {photos.length<10&&(
            <div onClick={()=>{photoInputRef.current.dataset.slot=slot;photoInputRef.current.click()}} style={{aspectRatio:'1',borderRadius:10,border:'2px dashed rgba(255,255,255,0.15)',background:'rgba(255,255,255,0.03)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:'pointer',gap:4}}>
              <span style={{fontSize:22}}>📷</span><span style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>Add</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  const lastAdminMsg = messages.filter(m=>m.sender==='admin').slice(-1)[0]
  const menuItems = [
    {key:'home',icon:'🏠',label:t('Dashboard','ダッシュボード')},
    {key:'shift',icon:'🗺',label:t("Today's Shift",'本日のシフト')},
    {key:'spots',icon:'⚡',label:t('Spot Jobs','スポット'),badge:spotJobs.length},
    {key:'history',icon:'📅',label:t('All Jobs','全作業')},
    {key:'salary',icon:'💴',label:t('Salary','給与')},
    {key:'transport',icon:'🚃',label:t('Transport','交通費')},
    {key:'chat',icon:'💬',label:t('Chat','チャット'),badge:unreadMsgs,preview:unreadMsgs>0&&lastAdminMsg?lastAdminMsg.content.substring(0,30):null},
    {key:'calendar',icon:'📆',label:t('Calendar','カレンダー')},
    {key:'achievements',icon:'🏆',label:t('Achievements','実績')},
  ]

  const bottomTabs = [
    {key:'home',label:t('Home','ホーム'),icon:'○'},
    {key:'shift',label:t('Shift','シフト'),icon:'▶'},
    {key:'salary',label:t('Salary','給与'),icon:'¥'},
    {key:'chat',label:t('Chat','チャット'),icon:'✉',badge:unreadMsgs},
  ]

  const JobModal = ({ job, onClose }) => {
    const duration = job.started_at&&job.completed_at?Math.round((new Date(job.completed_at)-new Date(job.started_at))/60000):null
    const cl = (() => { try { return JSON.parse(job.checklist_template||'[]') } catch { return [] } })()
    const dDate = displayDate(job)
    return (
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.9)',zIndex:200,display:'flex',flexDirection:'column',justifyContent:'flex-end'}} onClick={onClose}>
        <div style={{background:'#0d1f35',borderRadius:'24px 24px 0 0',padding:'20px 20px 50px',maxHeight:'90vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
          <div style={{width:40,height:4,background:'rgba(255,255,255,0.15)',borderRadius:2,margin:'0 auto 18px'}} />
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16}}>
            <div style={{flex:1,marginRight:12}}>
              <div style={{fontSize:18,fontWeight:700,color:'#fff',lineHeight:1.3,marginBottom:4}}>{job.title}</div>
              <div style={{fontSize:11,color:'rgba(255,255,255,0.4)'}}>{job.client_name}</div>
            </div>
            <div style={{fontSize:18,fontWeight:800,color:'#c19c56'}}>¥{Number(job.spot_value||job.value||0).toLocaleString()}</div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:7,marginBottom:14}}>
            {[['📅 Date',dDate],['🕐 Start',job.scheduled_time||'—'],['▶ In',job.started_at?new Date(job.started_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):'—'],['🏁 Out',job.completed_at?new Date(job.completed_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):'—'],['⏱ Duration',duration?`${Math.floor(duration/60)}h ${duration%60}m`:'—'],['Status',job.status]].map(([l,v])=>(
              <div key={l} style={{background:'rgba(255,255,255,0.06)',borderRadius:12,padding:'10px 12px'}}>
                <div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:3}}>{l}</div>
                <div style={{fontSize:12,fontWeight:500,color:'#fff'}}>{v}</div>
              </div>
            ))}
          </div>
          {job.description&&<div style={{background:'rgba(255,255,255,0.05)',borderRadius:12,padding:'12px 14px',marginBottom:12}}>
            <div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:5}}>📋 Instructions / Key Box</div>
            <div style={{fontSize:13,color:'rgba(255,255,255,0.75)',lineHeight:1.7,whiteSpace:'pre-line'}}>{job.description}</div>
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
            <div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:7,letterSpacing:1,textTransform:'uppercase'}}>Photos</div>
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
    <div style={{minHeight:'100vh',background:'#060d18',display:'flex',flexDirection:'column',maxWidth:430,margin:'0 auto',WebkitTapHighlightColor:'transparent',fontFamily:'-apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif',paddingBottom:70}}>
      <input type="file" ref={photoInputRef} accept="image/*" capture="environment" multiple style={{display:'none'}} onChange={e=>{const slot=photoInputRef.current.dataset.slot||'end';addPhoto(slot,e.target.files);e.target.value=''}} />
      <input type="file" ref={claimPhotoRef} accept="image/*" capture="environment" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(f){setClaimPhoto(f);setClaimPhotoPreview(URL.createObjectURL(f))}}} />
      <input type="file" ref={claimReceiptRef} accept="image/*,application/pdf" style={{display:'none'}} onChange={e=>{const f=e.target.files[0];if(f){setClaimReceipt(f);setClaimReceiptPreview(URL.createObjectURL(f))}}} />

      {selectedJob&&<JobModal job={selectedJob} onClose={()=>setSelectedJob(null)} />}
      {showSignature&&<SignatureModal
        jobTitle={activeJob?.title||''}
        onConfirm={(sig)=>{ setShowSignature(false); handleComplete(sig) }}
        onCancel={()=>setShowSignature(false)}
      />}

      {/* HEADER */}
      <div style={{position:'sticky',top:0,zIndex:50,background:'rgba(6,13,24,0.97)',backdropFilter:'blur(24px)',WebkitBackdropFilter:'blur(24px)',borderBottom:'1px solid rgba(255,255,255,0.06)',padding:'14px 16px 10px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
          <div>
            <div style={{fontSize:9,color:'rgba(255,255,255,0.2)',letterSpacing:2.5,textTransform:'uppercase'}}>KuriPuro by JBM</div>
            <div style={{fontSize:21,fontWeight:700,color:'#fff',letterSpacing:-0.5,lineHeight:1,marginTop:1}}>{user.name.split(' ')[0]}</div>
            <div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:2}}>{clock.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'short'})}</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{background:`rgba(${empScore>=90?'74,222,128':empScore>=70?'251,191,36':'248,113,113'},0.1)`,border:`1px solid rgba(${empScore>=90?'74,222,128':empScore>=70?'251,191,36':'248,113,113'},0.2)`,borderRadius:14,padding:'7px 12px',textAlign:'center'}}>
              <div style={{fontSize:20,fontWeight:800,color:scoreColor(empScore),lineHeight:1}}>{empScore}</div>
              <div style={{fontSize:8,color:'rgba(255,255,255,0.2)',textTransform:'uppercase',letterSpacing:1,marginTop:1}}>Score</div>
            </div>
            <button onClick={()=>setLanguage(lang==='en'?'jp':'en')} style={{height:40,padding:'0 10px',borderRadius:12,background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.08)',cursor:'pointer',color:'rgba(255,255,255,0.6)',fontSize:12,fontWeight:600}}>
              {lang==='en'?'JP':'EN'}
            </button>
            <button onClick={()=>setTab('chat')} style={{width:40,height:40,borderRadius:12,background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.08)',cursor:'pointer',position:'relative',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>
              🔔
              {unreadMsgs>0&&<div style={{position:'absolute',top:3,right:3,minWidth:16,height:16,borderRadius:20,background:'#f87171',border:'2px solid #060d18',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:800,color:'#fff',padding:'0 3px'}}>{unreadMsgs}</div>}
            </button>
            <button onClick={()=>setTab('chat')} style={{width:40,height:40,borderRadius:12,background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.08)',cursor:'pointer',position:'relative',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>
              🔔
            </button>
            <button onClick={()=>setMenuOpen(!menuOpen)} style={{width:40,height:40,borderRadius:12,background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.08)',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,position:'relative'}}>
              {[0,1,2].map(i=><div key={i} style={{width:4,height:4,borderRadius:'50%',background:'rgba(255,255,255,0.5)'}} />)}
              {spotJobs.length>0&&<div style={{position:'absolute',top:4,right:4,width:8,height:8,borderRadius:'50%',background:'#c19c56',border:'2px solid #060d18'}} />}
            </button>
          </div>
        </div>
        <div style={{marginTop:10,display:'flex',alignItems:'baseline',gap:4}}>
          <span style={{fontSize:44,fontWeight:700,color:'#fff',fontFamily:'monospace',letterSpacing:-3,lineHeight:1}}>{clock.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</span>
          <span style={{fontSize:20,color:'rgba(255,255,255,0.2)',fontFamily:'monospace'}}>{String(clock.getSeconds()).padStart(2,'0')}</span>
        </div>
        {!isOnline&&<div style={{background:'rgba(248,113,113,0.15)',border:'1px solid rgba(248,113,113,0.3)',borderRadius:8,padding:'6px 12px',fontSize:11,color:'#f87171',fontWeight:600,marginTop:8,textAlign:'center'}}>
          ⚠️ Offline — data will sync when reconnected
        </div>}
        <div style={{display:'flex',gap:6,marginTop:8,flexWrap:'wrap'}}>
          {gpsStatus&&<div style={{background:gpsStatus.includes('✅')?'rgba(74,222,128,0.1)':gpsStatus.includes('🚫')?'rgba(248,113,113,0.1)':'rgba(255,255,255,0.06)',borderRadius:20,padding:'4px 10px',fontSize:10,color:gpsStatus.includes('✅')?'#4ade80':gpsStatus.includes('🚫')?'#f87171':'rgba(255,255,255,0.4)',fontWeight:500,border:'1px solid rgba(255,255,255,0.08)'}}>{gpsStatus}</div>}
          {activeJob&&<div style={{background:'rgba(74,222,128,0.1)',border:'1px solid rgba(74,222,128,0.2)',borderRadius:20,padding:'4px 12px',fontSize:12,color:'#4ade80',fontWeight:700,fontFamily:'monospace'}}>▶ {fmt(elapsed)}</div>}
          {spotJobs.length>0&&<div onClick={()=>setTab('spots')} style={{background:'rgba(193,156,86,0.1)',border:'1px solid rgba(193,156,86,0.2)',borderRadius:20,padding:'4px 10px',fontSize:10,color:'#c19c56',cursor:'pointer',fontWeight:600}}>⚡ {spotJobs.length}</div>}
          {unreadMsgs>0&&<div onClick={()=>setTab('chat')} style={{background:'rgba(248,113,113,0.1)',border:'1px solid rgba(248,113,113,0.2)',borderRadius:20,padding:'4px 10px',fontSize:10,color:'#f87171',cursor:'pointer',fontWeight:600}}>💬 {unreadMsgs}</div>}
        </div>
      </div>

      {/* 3-dot dropdown */}
      {menuOpen&&(
        <div style={{position:'fixed',inset:0,zIndex:100}} onClick={()=>setMenuOpen(false)}>
          <div style={{position:'absolute',top:136,right:12,background:'#0d1f35',border:'1px solid rgba(255,255,255,0.08)',borderRadius:20,overflow:'hidden',minWidth:200,boxShadow:'0 28px 80px rgba(0,0,0,0.7)'}} onClick={e=>e.stopPropagation()}>
            {menuItems.map(item=>(
              <button key={item.key} onClick={()=>{setTab(item.key);setMenuOpen(false)}} style={{width:'100%',padding:'14px 18px',border:'none',background:tab===item.key?'rgba(193,156,86,0.1)':'none',color:tab===item.key?'#c19c56':'rgba(255,255,255,0.7)',fontSize:14,fontWeight:tab===item.key?600:400,cursor:'pointer',display:'flex',alignItems:'center',gap:12,borderBottom:'1px solid rgba(255,255,255,0.04)',textAlign:'left'}}>
                <span style={{fontSize:18}}>{item.icon}</span>
                <div style={{flex:1}}>
                  <div>{item.label}</div>
                  {item.preview&&<div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:120}}>{item.preview}</div>}
                </div>
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
      <div style={{flex:1,padding:'16px 14px 20px',overflowY:'auto',position:'relative',zIndex:1}}>

        {/* HOME */}
        {tab==='home'&&(
          <div>
            {/* Active job banner */}
            {activeJob&&<div onClick={()=>setTab('shift')} style={{background:'linear-gradient(135deg,rgba(74,222,128,0.12),rgba(74,222,128,0.03))',border:'1px solid rgba(74,222,128,0.25)',borderRadius:20,padding:16,marginBottom:12,cursor:'pointer'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div><div style={{fontSize:10,color:'#4ade80',fontWeight:700,letterSpacing:1,marginBottom:3}}>● ACTIVE SHIFT</div><div style={{fontSize:16,fontWeight:700,color:'#fff'}}>{activeJob.title.split(' —')[0]}</div><div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginTop:2}}>Tap to continue →</div></div>
                <div style={{fontSize:28,fontWeight:700,color:'#4ade80',fontFamily:'monospace'}}>{fmt(elapsed)}</div>
              </div>
            </div>}

            {/* Today shift card */}
            {todayJobs.length>0&&!activeJob&&(
              <div onClick={()=>setTab('shift')} style={{background:'linear-gradient(135deg,rgba(193,156,86,0.15),rgba(193,156,86,0.03))',border:'1px solid rgba(193,156,86,0.25)',borderRadius:22,padding:18,marginBottom:14,cursor:'pointer'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <div style={{fontSize:10,color:'#c19c56',fontWeight:700,letterSpacing:1}}>📋 NEXT SHIFT</div>
                  {(()=>{
                    const nj=todayJobs.find(j=>j.status==='assigned')
                    if(!nj) return null
                    const nd=new Date(nj.scheduled_date+'T'+(nj.scheduled_time||'00:30')+':00')
                    const diffMs=nd-new Date()
                    if(diffMs<0) return null
                    const diffH=Math.floor(diffMs/3600000)
                    const diffM=Math.floor((diffMs%3600000)/60000)
                    return <div style={{fontSize:11,color:'#60a5fa',fontWeight:600}}>⏰ {diffH>0?diffH+'h ':''}{diffM}m to start</div>
                  })()}
                </div>
                <div style={{fontSize:28,fontWeight:800,color:'#fff',marginBottom:4}}>{todayJobs.length} locations</div>
                <div style={{fontSize:12,color:'rgba(255,255,255,0.45)',marginBottom:8}}>{todayJobs.filter(j=>j.status==='completed').length} done · {todayJobs.filter(j=>j.status==='assigned').length} remaining</div>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginBottom:12}}>⏱ Est. {Math.round(todayJobs.length*0.75)}h total · avg 45min/location</div>
                <div style={{height:5,background:'rgba(255,255,255,0.1)',borderRadius:3,overflow:'hidden',marginBottom:10}}>
                  <div style={{height:'100%',width:(todayJobs.filter(j=>j.status==='completed').length/todayJobs.length*100)+'%',background:'linear-gradient(90deg,#c19c56,#e8c47a)',borderRadius:3,transition:'width 0.4s'}} />
                </div>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div style={{display:'flex',gap:4}}>
                    {todayJobs.slice(0,8).map((j,i)=><div key={i} style={{width:8,height:8,borderRadius:'50%',background:j.status==='completed'?'#4ade80':j.status==='in_progress'?'#fbbf24':'rgba(255,255,255,0.2)'}} />)}
                    {todayJobs.length>8&&<span style={{fontSize:9,color:'rgba(255,255,255,0.3)',marginLeft:2}}>+{todayJobs.length-8}</span>}
                  </div>
                  <div style={{fontSize:13,fontWeight:600,color:'#c19c56'}}>Start →</div>
                </div>
              </div>
            )}

            {/* Countdown to next upcoming job */}
            {todayJobs.length===0&&jobs.length>0&&!activeJob&&(()=>{
              const nextJob = jobs.find(j=>j.status==='assigned')
              if (!nextJob) return null
              const nextDate = new Date(nextJob.scheduled_date+'T'+(nextJob.scheduled_time||'00:30')+':00')
              const diffMs = nextDate - new Date()
              const diffH = Math.floor(diffMs/3600000)
              const diffM = Math.floor((diffMs%3600000)/60000)
              if (diffMs < 0) return null
              return (
                <div style={{background:'rgba(96,165,250,0.06)',border:'1px solid rgba(96,165,250,0.15)',borderRadius:18,padding:'14px 16px',marginBottom:12}}>
                  <div style={{fontSize:9,color:'#60a5fa',fontWeight:700,letterSpacing:1,marginBottom:4}}>⏰ NEXT SHIFT</div>
                  <div style={{fontSize:22,fontWeight:800,color:'#fff'}}>{diffH>0?`${diffH}h ${diffM}m`:`${diffM}m`} away</div>
                  <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginTop:2}}>{nextJob.title.split(' —')[0]} · {nextJob.scheduled_date} {nextJob.scheduled_time}</div>
                </div>
              )
            })()}

            {/* No jobs today */}
            {todayJobs.length===0&&!activeJob&&(
              <div style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:18,padding:'24px 20px',textAlign:'center',marginBottom:14}}>
                <div style={{fontSize:36,marginBottom:8}}>☀️</div>
                <div style={{fontSize:15,fontWeight:600,color:'rgba(255,255,255,0.6)'}}>No shift today</div>
                {jobs.length>0&&<div style={{fontSize:12,color:'rgba(255,255,255,0.3)',marginTop:4}}>Next: {displayDate(jobs[0])} · {jobs[0].scheduled_time}</div>}
              </div>
            )}

            {/* Unread messages banner */}
            
            {/* Next payment */}
            {payments.filter(p=>!p.is_deduction&&p.payment_type!=='advance').length>0&&(
              <div onClick={()=>setTab('salary')} style={{background:'rgba(96,165,250,0.06)',border:'1px solid rgba(96,165,250,0.15)',borderRadius:18,padding:'14px 16px',marginBottom:12,cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:9,color:'#60a5fa',fontWeight:700,letterSpacing:1,marginBottom:4}}>💴 NEXT PAYMENT</div>
                  <div style={{fontSize:22,fontWeight:800,color:'#fff'}}>¥{Number(payments.filter(p=>!p.is_deduction&&p.payment_type!=='advance')[0].amount).toLocaleString()}</div>
                  <div style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginTop:2}}>{payments.filter(p=>!p.is_deduction&&p.payment_type!=='advance')[0].payment_date}</div>
                </div>
                <div style={{fontSize:14,color:'#60a5fa'}}>›</div>
              </div>
            )}

            {/* Stats */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:12}}>
              {[['📋',salaryData?.jobs||0,'Jobs'],['⏱',(salaryData?.hours||0)+'h','Hours'],['💴','¥'+(salaryData?.total||0).toLocaleString(),'Earned']].map(([icon,v,l])=>(
                <div key={l} style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:14,padding:'12px 8px',textAlign:'center'}}>
                  <div style={{fontSize:18,marginBottom:3}}>{icon}</div>
                  <div style={{fontSize:14,fontWeight:700,color:'#fff'}}>{v}</div>
                  <div style={{fontSize:9,color:'rgba(255,255,255,0.3)',marginTop:1,textTransform:'uppercase',letterSpacing:0.5}}>{l}</div>
                </div>
              ))}
            </div>

            {/* Salary ring progress */}
            {salaryData&&salaryData.fixedMax>0&&(
              <div style={S.card}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <span style={{fontSize:12,color:'rgba(255,255,255,0.5)'}}>Monthly Salary</span>
                  <span style={{fontSize:14,fontWeight:800,color:'#c19c56'}}>¥{salaryData.base.toLocaleString()} <span style={{fontSize:10,color:'rgba(255,255,255,0.2)'}}>/ ¥{salaryData.fixedMax.toLocaleString()}</span></span>
                </div>
                <div style={{height:6,background:'rgba(255,255,255,0.07)',borderRadius:3,overflow:'hidden',marginBottom:5}}>
                  <div style={{height:'100%',width:Math.min((salaryData.base/salaryData.fixedMax)*100,100)+'%',borderRadius:3,background:'linear-gradient(90deg,#c19c56,#e8c47a)',transition:'width 0.6s'}} />
                </div>
                <div style={{fontSize:9,color:'rgba(255,255,255,0.25)'}}>{salaryData.workedDays} days · ¥{salaryData.dailyRate.toLocaleString()}/day · projected ¥{salaryData.projected?.toLocaleString()}</div>
              </div>
            )}

            {/* Score */}
            <div style={S.card}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}><span style={{fontSize:12,color:'rgba(255,255,255,0.5)'}}>Performance</span><span style={{fontSize:15,fontWeight:800,color:scoreColor(empScore)}}>{empScore}/100</span></div>
              <div style={{height:5,background:'rgba(255,255,255,0.06)',borderRadius:3,overflow:'hidden'}}><div style={{height:'100%',width:empScore+'%',borderRadius:3,background:scoreColor(empScore)}} /></div>
              <div style={{fontSize:9,color:'rgba(255,255,255,0.2)',marginTop:4}}>{empScore>=90?'🌟 Excellent':empScore>=70?'👍 Good':'⚠️ Needs improvement'}</div>
            </div>

            {/* Badges */}
            {badges.length>0&&<div style={S.card}>
              <span style={S.label}>Badges</span>
              <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                {badges.map(b=>{ const def=BADGE_DEFS.find(d=>d.key===b.badge_key); return <span key={b.id} style={{fontSize:24}} title={def?.name}>{def?.icon||'🏅'}</span> })}
              </div>
            </div>}

            {/* Spot jobs */}
            {spotJobs.length>0&&<div onClick={()=>setTab('spots')} style={{background:'rgba(193,156,86,0.07)',border:'1px solid rgba(193,156,86,0.15)',borderRadius:18,padding:'14px 16px',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div><div style={{fontSize:13,fontWeight:700,color:'#c19c56'}}>⚡ {spotJobs.length} Spot Job{spotJobs.length>1?'s':''}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:2}}>Tap to respond</div></div>
              <div style={{fontSize:22,color:'#c19c56'}}>›</div>
            </div>}
          </div>
        )}

        {/* SHIFT */}
        {tab==='shift'&&(
          <ShiftView allJobs={allJobs} activeJob={activeJob} elapsed={elapsed} checklist={checklist} setChecklist={setChecklist} notes={notes} setNotes={setNotes} jobPhotos={jobPhotos} PhotoGrid={PhotoGrid} handleStart={handleStart} handleComplete={handleComplete} submitting={submitting} fmt={fmt} displayDate={displayDate} today={today} setSelectedJob={setSelectedJob} S={S} />
        )}

        {/* SPOTS */}
        {tab==='spots'&&(
          <div>
            {spotJobs.length===0?<div style={{textAlign:'center',paddingTop:60}}><div style={{fontSize:48}}>⚡</div><div style={{fontSize:15,color:'rgba(255,255,255,0.3)',marginTop:12}}>No spot jobs pending</div></div>
            :spotJobs.map(j=>(
              <div key={j.id} style={{background:'rgba(193,156,86,0.06)',border:'1px solid rgba(193,156,86,0.15)',borderRadius:22,padding:18,marginBottom:14}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
                  <div style={{flex:1,marginRight:12}}><div style={{fontSize:17,fontWeight:700,color:'#fff',marginBottom:4}}>{j.title}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:1}}>📅 {displayDate(j)} · {j.scheduled_time}</div>{j.address?.startsWith('http')&&<a href={j.address} target="_blank" rel="noreferrer" style={{fontSize:10,color:'#60a5fa',textDecoration:'none'}}>🗺 Maps</a>}</div>
                  <div style={{background:'rgba(193,156,86,0.15)',border:'1px solid rgba(193,156,86,0.25)',borderRadius:14,padding:'10px 14px',textAlign:'center',flexShrink:0}}><div style={{fontSize:9,color:'#c19c56',fontWeight:700,letterSpacing:1}}>EXTRA</div><div style={{fontSize:22,fontWeight:800,color:'#c19c56'}}>+¥{Number(j.spot_value||0).toLocaleString()}</div></div>
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
          <DayGroupView allJobs={allJobs} displayDate={displayDate} today={today} setSelectedJob={setSelectedJob} handleStart={handleStart} handleComplete={handleComplete} handleCompleteWithSig={handleCompleteWithSig} activeJob={activeJob} elapsed={elapsed} checklist={checklist} setChecklist={setChecklist} notes={notes} setNotes={setNotes} PhotoGrid={PhotoGrid} submitting={submitting} fmt={fmt} S={S} />
        )}

        {/* SALARY */}
        {tab==='salary'&&(
          <div>
            <div style={{background:'linear-gradient(135deg,rgba(193,156,86,0.15),rgba(193,156,86,0.03))',border:'1px solid rgba(193,156,86,0.2)',borderRadius:22,padding:'22px 18px',textAlign:'center',marginBottom:14}}>
              <div style={{fontSize:9,color:'rgba(255,255,255,0.3)',letterSpacing:2,textTransform:'uppercase',marginBottom:5}}>Earned This Month</div>
              <div style={{fontSize:44,fontWeight:800,color:'#c19c56',letterSpacing:-2,lineHeight:1}}>¥{(salaryData?.total||0).toLocaleString()}</div>
              <div style={{fontSize:10,color:'rgba(255,255,255,0.25)',marginTop:4}}>of ¥{(salaryData?.fixedMax||0).toLocaleString()} max</div>
              <div style={{height:5,background:'rgba(255,255,255,0.08)',borderRadius:3,margin:'10px 14px 5px',overflow:'hidden'}}>
                <div style={{height:'100%',borderRadius:3,background:'linear-gradient(90deg,#c19c56,#e8c47a)',width:Math.min(((salaryData?.base||0)/(salaryData?.fixedMax||1))*100,100)+'%',transition:'width 0.6s'}} />
              </div>
              <div style={{fontSize:10,color:'rgba(255,255,255,0.25)'}}>{salaryData?.workedDays||0} days · ¥{(salaryData?.dailyRate||0).toLocaleString()}/day</div>
              {(salaryData?.spotEarned||0)>0&&<div style={{fontSize:11,color:'rgba(193,156,86,0.6)',marginTop:5}}>+¥{salaryData.spotEarned.toLocaleString()} spot ⚡</div>}
              {salaryData?.projected&&<div style={{fontSize:10,color:'rgba(255,255,255,0.18)',marginTop:3}}>Projected full month: ¥{salaryData.projected.toLocaleString()}</div>}
            </div>
            {/* PDF buttons */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
              <button onClick={async()=>{
                const month = new Date().toISOString().slice(0,7)
                if (lang==='jp') {
                  const doc = await generatePayslipJP(empData||{}, month, salaryData, payments, advances)
                  doc.save('kyuyo_'+user.name.replace(' ','_')+'_'+month+'.pdf')
                  toast.success('給与明細ダウンロード完了!')
                } else {
                  const doc = await generatePayslip(empData||{}, month, salaryData, payments, advances)
                  doc.save('payslip_'+user.name.replace(' ','_')+'_'+month+'.pdf')
                  toast.success('Payslip downloaded!')
                }
              }} style={{padding:'12px',borderRadius:12,border:'1px solid rgba(193,156,86,0.3)',background:'rgba(193,156,86,0.08)',color:'#c19c56',fontSize:13,fontWeight:600,cursor:'pointer',gridColumn:'1/-1'}}>
                📄 {lang==='jp'?'給与明細をダウンロード':'Download Payslip'}
              </button>
            </div>
            <div style={{marginBottom:14}}>
              <button onClick={async()=>{
                const today2 = new Date().toISOString().split('T')[0]
                const todayJobsForPDF = allJobs.filter(j=>j.scheduled_date===today2||displayDate(j)===today2)
                if (!todayJobsForPDF.length) return toast.error(t('No jobs today','本日の作業なし'))
                const doc = await generateDailyReport(today2, todayJobsForPDF, user.name)
                doc.save(`report_${today2}.pdf`)
                toast.success('Report downloaded!')
              }} style={{width:'100%',padding:'12px',borderRadius:12,border:'1px solid rgba(96,165,250,0.3)',background:'rgba(96,165,250,0.08)',color:'#60a5fa',fontSize:13,fontWeight:600,cursor:'pointer'}}>
                📋 Download Today's Service Report
              </button>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:14}}>
              {[['📋','Jobs',salaryData?.jobs||0],['⏱','Hours',(salaryData?.hours||0)+'h'],['💴','Base','¥'+(salaryData?.base||0).toLocaleString()],['⚡','Spot','¥'+(salaryData?.spotEarned||0).toLocaleString()]].map(([icon,l,v])=>(
                <div key={l} style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:14,padding:'12px 10px'}}>
                  <div style={{fontSize:20,marginBottom:6}}>{icon}</div>
                  <div style={{fontSize:18,fontWeight:700,color:'#fff'}}>{v}</div>
                  <div style={{fontSize:9,color:'rgba(255,255,255,0.3)',marginTop:2,textTransform:'uppercase',letterSpacing:0.5}}>{l}</div>
                </div>
              ))}
            </div>
            {payments.filter(p=>!p.is_deduction&&p.payment_type!=='advance').length>0&&(
              <div style={{background:'rgba(96,165,250,0.08)',border:'1px solid rgba(96,165,250,0.18)',borderRadius:18,padding:16,marginBottom:14}}>
                <div style={{fontSize:9,color:'#60a5fa',fontWeight:700,letterSpacing:1,textTransform:'uppercase',marginBottom:10}}>💴 Upcoming Payments</div>
                {payments.filter(p=>!p.is_deduction&&p.payment_type!=='advance').map((p,i)=>(
                  <div key={p.id} style={{paddingBottom:i<1?10:0,marginBottom:i<1?10:0,borderBottom:i<1?'1px solid rgba(255,255,255,0.06)':'none'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <div><div style={{fontSize:i===0?26:15,fontWeight:800,color:'#fff'}}>¥{Number(p.amount).toLocaleString()}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginTop:2}}>{p.payment_date} · {p.description||'Salary'}</div></div>
                      <span style={{fontSize:9,background:'rgba(96,165,250,0.1)',color:'#60a5fa',border:'1px solid rgba(96,165,250,0.2)',borderRadius:20,padding:'3px 9px',fontWeight:600,textTransform:'uppercase'}}>{p.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {(() => {
              const todayStr = new Date().toISOString().split('T')[0]
              const parseDate = (desc) => {
                if (!desc) return null
                const jun = desc.match(/Jun (\d+)/); if (jun) return '2026-06-'+jun[1].padStart(2,'0')
                const jul = desc.match(/Jul (\d+)/); if (jul) return '2026-07-'+jul[1].padStart(2,'0')
                return null
              }
              const received = advances.filter(a=>{ const d=parseDate(a.description); return d&&d<todayStr })
              const pending = advances.filter(a=>{ const d=parseDate(a.description); return !d||d>=todayStr })
              return (<>
                {received.length>0&&<div style={{marginBottom:14}}>
                  <span style={S.label}>Advances Received</span>
                  {received.map(a=><div key={a.id} style={{...S.card,display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}><div><div style={{fontSize:13,fontWeight:600,color:'#fff'}}>¥{Number(a.amount).toLocaleString()}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginTop:1}}>{a.description}</div></div><span style={{fontSize:9,background:'rgba(74,222,128,0.1)',color:'#4ade80',border:'1px solid rgba(74,222,128,0.2)',borderRadius:20,padding:'3px 9px',fontWeight:600}}>✓ received</span></div>)}
                  <div style={{background:'rgba(248,113,113,0.06)',border:'1px solid rgba(248,113,113,0.1)',borderRadius:12,padding:'10px 14px',marginTop:4,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <span style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>Total received</span>
                    <span style={{fontSize:14,fontWeight:700,color:'#f87171'}}>-¥{received.reduce((s,a)=>s+Number(a.amount),0).toLocaleString()}</span>
                  </div>
                </div>}
                {pending.length>0&&<div style={{marginBottom:14}}>
                  <span style={S.label}>Advances Pending</span>
                  {pending.map(a=><div key={a.id} style={{...S.card,display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}><div><div style={{fontSize:13,fontWeight:600,color:'rgba(255,255,255,0.5)'}}>¥{Number(a.amount).toLocaleString()}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.25)',marginTop:1}}>{a.description}</div></div><span style={{fontSize:9,background:'rgba(255,255,255,0.06)',color:'rgba(255,255,255,0.35)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:20,padding:'3px 9px',fontWeight:600}}>pending</span></div>)}
                </div>}
              </>)
            })()}
          </div>
        )}

        {/* TRANSPORT */}
        {tab==='transport'&&(
          <div>
            <span style={S.label}>Submit Transport Claim</span>
            <div style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:20,padding:18,marginBottom:16}}>
              <div style={{marginBottom:10}}><span style={S.label}>Related Job</span><select value={claimForm.job_id} onChange={e=>setClaimForm(f=>({...f,job_id:e.target.value}))} style={{...S.input,appearance:'none'}}><option value="">No specific job</option>{allJobs.slice(0,30).map(j=><option key={j.id} value={j.id}>{j.title.split(' —')[0]} · {j.scheduled_date}</option>)}</select></div>
              <div style={{marginBottom:10}}><span style={S.label}>Amount (¥) *</span><input type="number" value={claimForm.amount} onChange={e=>setClaimForm(f=>({...f,amount:e.target.value}))} placeholder="280" style={S.input} /></div>
              <div style={{marginBottom:10}}><span style={S.label}>Route</span><input value={claimForm.route} onChange={e=>setClaimForm(f=>({...f,route:e.target.value}))} placeholder="Shibuya → Shinjuku" style={S.input} /></div>
              <div style={{marginBottom:14}}><span style={S.label}>Notes</span><input value={claimForm.description} onChange={e=>setClaimForm(f=>({...f,description:e.target.value}))} style={S.input} /></div>
              <div style={{marginBottom:14}}>
                <span style={S.label}>Photos & Receipt</span>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                  {[{ref:claimPhotoRef,preview:claimPhotoPreview,label:'Photo',emoji:'📷'},{ref:claimReceiptRef,preview:claimReceiptPreview,label:'Receipt',emoji:'🧾'}].map(({ref,preview,label,emoji})=>(
                    <div key={label} onClick={()=>ref.current.click()} style={{aspectRatio:'1',borderRadius:12,overflow:'hidden',cursor:'pointer',border:preview?'2px solid #4ade80':'2px dashed rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.02)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:5,color:'rgba(255,255,255,0.3)'}}>
                      {preview?<img src={preview} style={{width:'100%',height:'100%',objectFit:'cover'}} />:<><span style={{fontSize:26}}>{emoji}</span><span style={{fontSize:10}}>{label}</span></>}
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={handleSubmitClaim} disabled={submittingClaim} style={{width:'100%',padding:'15px',borderRadius:14,border:'none',background:submittingClaim?'rgba(255,255,255,0.07)':'linear-gradient(135deg,#0F6E56,#16a37e)',color:submittingClaim?'rgba(255,255,255,0.25)':'#fff',fontSize:15,fontWeight:700,cursor:submittingClaim?'not-allowed':'pointer'}}>
                {submittingClaim?'Submitting...':'📤 Submit Claim'}
              </button>
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
            <div ref={chatContainerRef} onScroll={handleChatScroll} style={{flex:1,overflowY:'auto',marginBottom:12,position:'relative'}}>
              {userScrolled&&unreadMsgs>0&&(
                <div onClick={()=>{setUserScrolled(false);msgEndRef.current?.scrollIntoView({behavior:'smooth'})}}
                  style={{position:'sticky',top:8,zIndex:10,textAlign:'center',marginBottom:8}}>
                  <div style={{display:'inline-block',background:'#f87171',color:'#fff',borderRadius:20,padding:'4px 14px',fontSize:12,fontWeight:600,cursor:'pointer',boxShadow:'0 2px 8px rgba(0,0,0,0.3)'}}>
                    ↓ {unreadMsgs} new message{unreadMsgs>1?'s':''}
                  </div>
                </div>
              )}
              {messages.length===0&&<div style={{textAlign:'center',paddingTop:40,color:'rgba(255,255,255,0.25)',fontSize:13}}>No messages yet</div>}
              {messages.map(m=>(
                <div key={m.id} style={{display:'flex',justifyContent:m.sender==='employee'?'flex-end':'flex-start',marginBottom:10}}>
                  <div style={{maxWidth:'78%',background:m.sender==='employee'?'rgba(193,156,86,0.18)':'rgba(255,255,255,0.08)',border:`1px solid rgba(${m.sender==='employee'?'193,156,86':'255,255,255'},0.12)`,borderRadius:m.sender==='employee'?'18px 18px 4px 18px':'18px 18px 18px 4px',padding:'11px 15px'}}>
                    {m.sender==='admin'&&<div style={{fontSize:9,color:'rgba(255,255,255,0.35)',marginBottom:3,fontWeight:600}}>Admin</div>}
                    <div style={{fontSize:14,color:'#fff',lineHeight:1.5}}>{m.content}</div>
                    <div style={{fontSize:9,color:'rgba(255,255,255,0.25)',marginTop:4,textAlign:'right',display:'flex',justifyContent:'flex-end',alignItems:'center',gap:4}}>
                      {new Date(m.created_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}
                      {m.sender==='employee'&&<span style={{color:m.read?'#4ade80':'rgba(255,255,255,0.3)'}}>{m.read?'✓✓':'✓'}</span>}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={msgEndRef} />
            </div>
            <div style={{display:'flex',gap:8}}>
              <input value={newMsg} onChange={e=>setNewMsg(e.target.value)} onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&sendMessage()} placeholder="Message admin..." style={{...S.input,flex:1,borderRadius:22,padding:'12px 18px'}} />
              <button onClick={sendMessage} disabled={!newMsg.trim()} style={{width:46,height:46,borderRadius:'50%',border:'none',background:newMsg.trim()?'#c19c56':'rgba(255,255,255,0.07)',color:newMsg.trim()?'#0a1929':'rgba(255,255,255,0.3)',fontSize:22,cursor:newMsg.trim()?'pointer':'default',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700}}>›</button>
            </div>
          </div>
        )}

        {/* CALENDAR */}
        {tab==='calendar'&&(
          <CalendarView jobs={allJobs} today={today} displayDate={displayDate} onSelect={setSelectedJob} />
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
          </div>
        )}
      </div>

      {/* BOTTOM TAB BAR */}
      <div style={{position:'fixed',bottom:0,left:'50%',transform:'translateX(-50%)',width:'100%',maxWidth:430,background:'rgba(6,13,24,0.97)',backdropFilter:'blur(24px)',WebkitBackdropFilter:'blur(24px)',borderTop:'1px solid rgba(255,255,255,0.08)',display:'flex',zIndex:50,paddingBottom:'env(safe-area-inset-bottom,0px)'}}>
        {bottomTabs.map(t=>(
          <button key={t.key} onClick={()=>setTab(t.key)} style={{flex:1,padding:'10px 4px 8px',border:'none',background:'none',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:3,position:'relative'}}>
            <div style={{fontSize:t.key==='salary'?16:18,fontWeight:700,color:tab===t.key?'#c19c56':'rgba(255,255,255,0.3)',lineHeight:1,fontFamily:t.key==='salary'?'monospace':'inherit',transition:'color 0.15s'}}>{t.icon}</div>
            <div style={{fontSize:9,color:tab===t.key?'#c19c56':'rgba(255,255,255,0.25)',fontWeight:tab===t.key?600:400,transition:'color 0.15s'}}>{t.label}</div>
            {tab===t.key&&<div style={{position:'absolute',bottom:0,left:'50%',transform:'translateX(-50%)',width:20,height:2,background:'#c19c56',borderRadius:1}} />}
            {t.badge>0&&<div style={{position:'absolute',top:6,right:'calc(50% - 14px)',width:16,height:16,borderRadius:'50%',background:'#f87171',border:'2px solid #060d18',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:800,color:'#fff'}}>{t.badge}</div>}
          </button>
        ))}
        {/* More button */}
        <button onClick={()=>setMenuOpen(true)} style={{flex:1,padding:'10px 4px 8px',border:'none',background:'none',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:3}}>
          <div style={{display:'flex',gap:2.5,marginBottom:1}}>{[0,1,2].map(i=><div key={i} style={{width:3.5,height:3.5,borderRadius:'50%',background:'rgba(255,255,255,0.3)'}} />)}</div>
          <div style={{fontSize:9,color:'rgba(255,255,255,0.25)'}}>More</div>
        </button>
      </div>
    </div>
  )
}

function ShiftView({ allJobs, activeJob, elapsed, checklist, setChecklist, notes, setNotes, jobPhotos, PhotoGrid, handleStart, handleComplete, submitting, fmt, displayDate, today, setSelectedJob, S }) {
  const [selectedWeek, setSelectedWeek] = useState(null)
  const [selectedDay, setSelectedDay] = useState(null)
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()

  const getWeeks = () => {
    const weeks = []
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month+1, 0)
    let ws = new Date(firstDay)
    ws.setDate(ws.getDate() - ws.getDay())
    let wn = 1
    while (ws <= lastDay) {
      const days = Array(7).fill(null).map((_,i) => { const d = new Date(ws); d.setDate(d.getDate()+i); return d })
      weeks.push({ num:wn, days, start:new Date(ws) })
      ws.setDate(ws.getDate()+7); wn++
    }
    return weeks
  }

  const weeks = getWeeks()
  const ds = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

  const jobsByDate = {}
  allJobs.forEach(j => {
    const d = displayDate(j)
    if (!jobsByDate[d]) jobsByDate[d] = []
    jobsByDate[d].push(j)
  })

  const getDayStatus = d => {
    const dj = jobsByDate[ds(d)] || []
    if (!dj.length) return null
    if (dj.every(j=>j.status==='completed')) return 'done'
    if (dj.some(j=>j.status==='in_progress')) return 'active'
    if (dj.some(j=>j.status==='assigned')) return 'scheduled'
    return null
  }

  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const sc = { done:'#4ade80', active:'#fbbf24', scheduled:'#60a5fa' }
  const dayJobs = selectedDay ? (jobsByDate[selectedDay]||[]).sort((a,b)=>(a.sequence_order||99)-(b.sequence_order||99)) : []
  const activeInDay = dayJobs.find(j=>j.status==='in_progress')

  return (
    <div>
      <div style={{fontSize:15,fontWeight:600,color:'#fff',marginBottom:14,textAlign:'center'}}>
        {new Date(year,month).toLocaleString('en',{month:'long',year:'numeric'})}
      </div>

      {!selectedDay && weeks.map(week => {
        const hasJobs = week.days.some(d=>(jobsByDate[ds(d)]||[]).length>0)
        const isCurrent = week.days.some(d=>ds(d)===today)
        const doneCount = week.days.filter(d=>getDayStatus(d)==='done').length
        const schedCount = week.days.filter(d=>['scheduled','active'].includes(getDayStatus(d))).length
        const isOpen = selectedWeek===week.num
        return (
          <div key={week.num} style={{marginBottom:10}}>
            <div onClick={()=>hasJobs&&setSelectedWeek(isOpen?null:week.num)}
              style={{background:isOpen?'rgba(193,156,86,0.08)':isCurrent?'rgba(96,165,250,0.06)':'rgba(255,255,255,0.04)',border:`1px solid rgba(${isOpen?'193,156,86':isCurrent?'96,165,250':'255,255,255'},${isOpen?'0.2':isCurrent?'0.12':'0.07'})`,borderRadius:isOpen?'16px 16px 0 0':16,padding:'13px 14px',cursor:hasJobs?'pointer':'default',opacity:hasJobs?1:0.4}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:isOpen?10:0}}>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:isCurrent?'#60a5fa':'#fff'}}>
                    Week {week.num} {isCurrent&&<span style={{fontSize:9,background:'rgba(96,165,250,0.1)',color:'#60a5fa',borderRadius:20,padding:'2px 7px',marginLeft:6}}>current</span>}
                  </div>
                  <div style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginTop:1}}>
                    {week.days[0].toLocaleDateString('en-GB',{day:'numeric',month:'short'})} – {week.days[6].toLocaleDateString('en-GB',{day:'numeric',month:'short'})}
                  </div>
                </div>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  {doneCount>0&&<span style={{fontSize:10,color:'#4ade80',fontWeight:600}}>✓{doneCount}</span>}
                  {schedCount>0&&<span style={{fontSize:10,color:'#60a5fa',fontWeight:600}}>📋{schedCount}</span>}
                  <span style={{fontSize:18,color:'rgba(255,255,255,0.3)'}}>{isOpen?'∧':'›'}</span>
                </div>
              </div>
              {isOpen&&(
                <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:4}}>
                  {week.days.map((d,i)=>{
                    const dstr = ds(d)
                    const status = getDayStatus(d)
                    const isToday = dstr===today
                    const inMonth = d.getMonth()===month
                    const dj = jobsByDate[dstr]||[]
                    return (
                      <div key={i} onClick={e=>{e.stopPropagation();status&&setSelectedDay(dstr)}}
                        style={{borderRadius:10,padding:'6px 4px',textAlign:'center',cursor:status?'pointer':'default',background:dstr===selectedDay?'rgba(193,156,86,0.2)':isToday?'rgba(96,165,250,0.15)':'rgba(255,255,255,0.04)',border:isToday?'1px solid rgba(96,165,250,0.3)':'1px solid rgba(255,255,255,0.06)',opacity:inMonth?1:0.3}}>
                        <div style={{fontSize:8,color:'rgba(255,255,255,0.4)',marginBottom:2}}>{dayNames[i]}</div>
                        <div style={{fontSize:13,fontWeight:isToday?700:400,color:isToday?'#60a5fa':'rgba(255,255,255,0.8)'}}>{d.getDate()}</div>
                        {status&&<div style={{width:6,height:6,borderRadius:'50%',background:sc[status],margin:'3px auto 0'}} />}
                        {dj.length>0&&<div style={{fontSize:7,color:'rgba(255,255,255,0.3)',marginTop:1}}>{dj.length}</div>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )
      })}

      {selectedDay&&(
        <div>
          <button onClick={()=>setSelectedDay(null)} style={{display:'flex',alignItems:'center',gap:6,background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:10,padding:'7px 12px',color:'rgba(255,255,255,0.6)',fontSize:12,cursor:'pointer',marginBottom:14}}>
            ← {new Date(selectedDay+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})}
          </button>

          {dayJobs.length>0&&(
            <div style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:16,padding:'12px 14px',marginBottom:14}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:600,color:'#fff'}}>
                  {dayJobs.every(j=>j.status==='completed')?'✅ All done!':activeInDay?`▶ ${activeInDay.title.split(' —')[0]}`:`Next: ${dayJobs.find(j=>j.status==='assigned')?.title.split(' —')[0]||'—'}`}
                </div>
                <div style={{fontSize:11,color:'#4ade80',fontWeight:600}}>{dayJobs.filter(j=>j.status==='completed').length}/{dayJobs.length}</div>
              </div>
              <div style={{height:4,background:'rgba(255,255,255,0.07)',borderRadius:2,overflow:'hidden'}}>
                <div style={{height:'100%',width:(dayJobs.filter(j=>j.status==='completed').length/dayJobs.length*100)+'%',background:'linear-gradient(90deg,#4ade80,#22c55e)',borderRadius:2,transition:'width 0.4s'}} />
              </div>
            </div>
          )}

          {dayJobs.length===0&&<div style={{textAlign:'center',padding:'30px 0',color:'rgba(255,255,255,0.25)',fontSize:13}}>No jobs this day</div>}

          {dayJobs.map((j,idx)=>{
            const isActive=j.status==='in_progress', isDone=j.status==='completed'
            const isNext=!isDone&&!isActive&&dayJobs.slice(0,idx).every(p=>p.status==='completed')
            const isLocked=!isDone&&!isActive&&!isNext
            const duration=j.started_at&&j.completed_at?Math.round((new Date(j.completed_at)-new Date(j.started_at))/60000):null
            return (
              <div key={j.id} style={{marginBottom:10,opacity:isLocked?0.35:1}}>
                <div style={{background:isActive?'rgba(74,222,128,0.07)':isDone?'rgba(74,222,128,0.03)':'rgba(255,255,255,0.04)',border:`1px solid rgba(${isActive?'74,222,128':isDone?'74,222,128':'255,255,255'},${isActive?'0.2':isDone?'0.08':'0.07'})`,borderRadius:18,padding:14}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:isActive?14:0}}>
                    <div style={{width:34,height:34,borderRadius:'50%',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:700,background:isDone?'#4ade80':isActive?'rgba(74,222,128,0.15)':isNext?'rgba(193,156,86,0.15)':'rgba(255,255,255,0.05)',border:isActive?'2px solid #4ade80':isNext?'2px solid rgba(193,156,86,0.3)':'none',color:isDone?'#080f1a':isActive?'#4ade80':isNext?'#c19c56':'rgba(255,255,255,0.25)'}}>
                      {isDone?'✓':isActive?'▶':idx+1}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:600,color:isDone?'rgba(255,255,255,0.35)':'#fff',textDecoration:isDone?'line-through':'none',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                        {j.title.replace(/ — .*/,'')}
                      </div>
                      <div style={{display:'flex',gap:8,marginTop:2,flexWrap:'wrap'}}>
                        {isActive&&<span style={{fontSize:10,color:'#4ade80',fontFamily:'monospace',fontWeight:700}}>▶ {fmt(elapsed)}</span>}
                        {isDone&&j.completed_at&&<span style={{fontSize:9,color:'#4ade80'}}>🏁 {new Date(j.completed_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</span>}
                        {duration&&<span style={{fontSize:9,color:'rgba(255,255,255,0.25)'}}>⏱ {duration}m</span>}
                        {j.description?.includes('Key box')&&<span style={{fontSize:9,color:'rgba(255,255,255,0.3)',background:'rgba(255,255,255,0.05)',borderRadius:20,padding:'1px 6px'}}>🔑</span>}
                      </div>
                    </div>
                    <div style={{display:'flex',gap:5,flexShrink:0}}>
                      {j.address?.startsWith('http')&&<a href={j.address} target="_blank" rel="noreferrer" style={{width:30,height:30,borderRadius:9,background:'rgba(96,165,250,0.08)',border:'1px solid rgba(96,165,250,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,textDecoration:'none'}}>🗺</a>}
                      <button onClick={()=>setSelectedJob(j)} style={{width:30,height:30,borderRadius:9,background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.07)',color:'rgba(255,255,255,0.4)',fontSize:11,cursor:'pointer',fontWeight:600}}>i</button>
                    </div>
                  </div>
                  {isActive&&(
                    <div>
                      {j.description&&<div style={{background:'rgba(255,255,255,0.04)',borderRadius:10,padding:'9px 11px',marginBottom:10,fontSize:12,color:'rgba(255,255,255,0.6)',lineHeight:1.7,whiteSpace:'pre-line'}}>{j.description}</div>}
                      {checklist.length>0&&(
                        <div style={{marginBottom:12}}>
                          <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}><span style={{fontSize:9,color:'rgba(255,255,255,0.35)',textTransform:'uppercase',letterSpacing:1}}>Checklist</span><span style={{fontSize:9,color:'#4ade80',fontWeight:600}}>{checklist.filter(t=>t.done).length}/{checklist.length}</span></div>
                          <div style={{height:3,background:'rgba(255,255,255,0.06)',borderRadius:2,marginBottom:8,overflow:'hidden'}}><div style={{height:'100%',width:(checklist.length?checklist.filter(t=>t.done).length/checklist.length*100:0)+'%',background:'#4ade80',borderRadius:2}} /></div>
                          {checklist.map((t,i)=>(
                            <div key={i} onClick={()=>setChecklist(cl=>cl.map((x,ji)=>ji===i?{...x,done:!x.done}:x))} style={{display:'flex',alignItems:'center',gap:11,padding:'10px 0',borderBottom:'1px solid rgba(255,255,255,0.04)',cursor:'pointer',userSelect:'none',WebkitUserSelect:'none'}}>
                              <div style={{width:20,height:20,borderRadius:6,border:'1.5px solid',flexShrink:0,borderColor:t.done?'#4ade80':'rgba(255,255,255,0.15)',background:t.done?'#4ade80':'transparent',display:'flex',alignItems:'center',justifyContent:'center'}}>
                                {t.done&&<span style={{fontSize:11,color:'#080f1a',fontWeight:900}}>✓</span>}
                              </div>
                              <span style={{fontSize:13,color:t.done?'rgba(255,255,255,0.25)':'#fff',textDecoration:t.done?'line-through':'none'}}>{t.label}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Notes..." style={{width:'100%',padding:'10px',fontSize:13,borderRadius:10,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(255,255,255,0.04)',color:'#fff',fontFamily:'inherit',boxSizing:'border-box',resize:'none',minHeight:60,marginBottom:10}} />
                      <PhotoGrid slot="end" label={`Photos${j.photo_required?' (required)':''}`} />
                      <button onClick={()=>handleCompleteWithSig(activeJob)} disabled={submitting} style={{width:'100%',padding:'14px',borderRadius:13,border:'none',background:submitting?'rgba(255,255,255,0.07)':'linear-gradient(135deg,#c19c56,#e8c47a)',color:submitting?'rgba(255,255,255,0.25)':'#0a1929',fontSize:15,fontWeight:800,cursor:submitting?'not-allowed':'pointer',marginTop:2}}>
                        {submitting?'Saving...':idx===dayJobs.length-1?'🏁 Finish Day':'🏁 Done → Next'}
                      </button>
                    </div>
                  )}
                  {isNext&&!activeJob&&(
                    <div style={{marginTop:12}}>
                      <button onClick={()=>handleStart(j)} disabled={submitting} style={{width:'100%',padding:'13px',borderRadius:12,border:'none',background:'linear-gradient(135deg,#0F6E56,#16a37e)',color:'#fff',fontSize:14,fontWeight:700,cursor:submitting?'not-allowed':'pointer'}}>
                        ▶ Start — {j.title.split(' —')[0]}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {dayJobs.every(j=>j.status==='completed')&&dayJobs.length>0&&(
            <div style={{textAlign:'center',padding:'24px',background:'rgba(74,222,128,0.05)',border:'1px solid rgba(74,222,128,0.12)',borderRadius:18,marginTop:6}}>
              <div style={{fontSize:40,marginBottom:8}}>🎉</div>
              <div style={{fontSize:17,fontWeight:700,color:'#4ade80',marginBottom:4}}>Shift Complete!</div>
              <div style={{fontSize:12,color:'rgba(255,255,255,0.35)'}}>All {dayJobs.length} locations done</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DayGroupView({ allJobs, displayDate, today, setSelectedJob, handleStart, handleComplete, handleCompleteWithSig, activeJob, elapsed, checklist, setChecklist, notes, setNotes, PhotoGrid, submitting, fmt, S }) {
  const [filter, setFilter] = useState('all')
  const [openDay, setOpenDay] = useState(null)

  const filtered = allJobs.filter(j=>{
    if (filter==='upcoming') return j.status==='assigned'&&j.scheduled_date>=today
    if (filter==='past') return j.status==='completed'
    if (filter==='cancelled') return j.status==='cancelled'
    return j.status!=='cancelled'
  })

  const byDate = {}
  filtered.forEach(j=>{ const d=displayDate(j); if(!byDate[d]) byDate[d]=[]; byDate[d].push(j) })
  const sortedDates = Object.keys(byDate).sort((a,b)=>filter==='upcoming'?a.localeCompare(b):b.localeCompare(a))

  const getDayStatus = jobs => {
    if (jobs.every(j=>j.status==='completed')) return 'done'
    if (jobs.some(j=>j.status==='in_progress')) return 'active'
    if (jobs.some(j=>j.status==='assigned')) return 'scheduled'
    return 'cancelled'
  }

  const sc = { done:'#4ade80', active:'#fbbf24', scheduled:'#60a5fa', cancelled:'rgba(255,255,255,0.2)' }
  const sl = { done:'✓ Complete', active:'▶ In Progress', scheduled:'Scheduled', cancelled:'Cancelled' }

  return (
    <div>
      <div style={{display:'flex',gap:6,marginBottom:14,overflowX:'auto',paddingBottom:2}}>
        {[['all','All'],['upcoming','Upcoming'],['past','Done'],['cancelled','Cancelled']].map(([k,l])=>(
          <button key={k} onClick={()=>setFilter(k)} style={{padding:'7px 14px',borderRadius:20,border:'1px solid',flexShrink:0,borderColor:filter===k?'#c19c56':'rgba(255,255,255,0.08)',background:filter===k?'rgba(193,156,86,0.12)':'rgba(255,255,255,0.03)',color:filter===k?'#c19c56':'rgba(255,255,255,0.4)',fontSize:12,fontWeight:filter===k?600:400,cursor:'pointer'}}>{l}</button>
        ))}
      </div>
      {sortedDates.length===0&&<div style={{textAlign:'center',paddingTop:40,color:'rgba(255,255,255,0.25)',fontSize:13}}>No jobs</div>}
      {sortedDates.map(date=>{
        const dayJobs=byDate[date].sort((a,b)=>(a.sequence_order||99)-(b.sequence_order||99))
        const status=getDayStatus(dayJobs)
        const isOpen=openDay===date
        const isToday=date===today
        const doneCount=dayJobs.filter(j=>j.status==='completed').length
        const activeInDay=dayJobs.find(j=>j.status==='in_progress')
        return (
          <div key={date} style={{marginBottom:10}}>
            <div onClick={()=>setOpenDay(isOpen?null:date)} style={{background:isOpen?'rgba(193,156,86,0.08)':isToday?'rgba(96,165,250,0.06)':'rgba(255,255,255,0.04)',border:`1px solid rgba(${isOpen?'193,156,86':isToday?'96,165,250':'255,255,255'},${isOpen?'0.2':isToday?'0.15':'0.07'})`,borderRadius:isOpen?'18px 18px 0 0':18,padding:'14px 16px',cursor:'pointer'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                    <div style={{fontSize:14,fontWeight:700,color:isToday?'#60a5fa':'#fff'}}>
                      {new Date(date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})}
                      {isToday&&<span style={{fontSize:9,color:'#60a5fa',background:'rgba(96,165,250,0.1)',borderRadius:20,padding:'2px 7px',marginLeft:6}}>today</span>}
                    </div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontSize:11,color:sc[status],fontWeight:600}}>{sl[status]}</span>
                    <span style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>{dayJobs.length} locations</span>
                    {status==='active'&&<span style={{fontSize:11,color:'#fbbf24',fontFamily:'monospace',fontWeight:700}}>▶ {fmt(elapsed)}</span>}
                  </div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{display:'flex',gap:3}}>{dayJobs.slice(0,8).map((j,i)=><div key={i} style={{width:7,height:7,borderRadius:'50%',background:j.status==='completed'?'#4ade80':j.status==='in_progress'?'#fbbf24':'rgba(255,255,255,0.15)'}} />)}{dayJobs.length>8&&<span style={{fontSize:8,color:'rgba(255,255,255,0.3)'}}>+{dayJobs.length-8}</span>}</div>
                  <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',fontWeight:600}}>{doneCount}/{dayJobs.length}</div>
                  <div style={{fontSize:18,color:'rgba(255,255,255,0.3)'}}>{isOpen?'∧':'›'}</div>
                </div>
              </div>
              <div style={{height:3,background:'rgba(255,255,255,0.07)',borderRadius:2,marginTop:10,overflow:'hidden'}}>
                <div style={{height:'100%',width:(doneCount/dayJobs.length*100)+'%',background:status==='done'?'#4ade80':'linear-gradient(90deg,#60a5fa,#4ade80)',borderRadius:2,transition:'width 0.4s'}} />
              </div>
            </div>
            {isOpen&&(
              <div style={{background:'rgba(255,255,255,0.02)',border:'1px solid rgba(193,156,86,0.12)',borderTop:'none',borderRadius:'0 0 18px 18px',padding:'10px 12px 14px'}}>
                {dayJobs.map((j,idx)=>{
                  const isActive=j.status==='in_progress',isDone=j.status==='completed'
                  const isNext=!isDone&&!isActive&&dayJobs.slice(0,idx).every(p=>p.status==='completed')
                  const isLocked=!isDone&&!isActive&&!isNext
                  const duration=j.started_at&&j.completed_at?Math.round((new Date(j.completed_at)-new Date(j.started_at))/60000):null
                  return (
                    <div key={j.id} style={{marginBottom:8,opacity:isLocked?0.35:1}}>
                      <div style={{background:isActive?'rgba(74,222,128,0.07)':isDone?'rgba(74,222,128,0.03)':'rgba(255,255,255,0.04)',border:`1px solid rgba(${isActive?'74,222,128':isDone?'74,222,128':'255,255,255'},${isActive?'0.2':isDone?'0.07':'0.06'})`,borderRadius:14,padding:12}}>
                        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:isActive?12:0}}>
                          <div style={{width:30,height:30,borderRadius:'50%',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,background:isDone?'#4ade80':isActive?'rgba(74,222,128,0.15)':isNext?'rgba(193,156,86,0.15)':'rgba(255,255,255,0.05)',border:isActive?'2px solid #4ade80':isNext?'2px solid rgba(193,156,86,0.3)':'none',color:isDone?'#080f1a':isActive?'#4ade80':isNext?'#c19c56':'rgba(255,255,255,0.25)'}}>
                            {isDone?'✓':isActive?'▶':idx+1}
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:13,fontWeight:600,color:isDone?'rgba(255,255,255,0.35)':'#fff',textDecoration:isDone?'line-through':'none',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{j.title.replace(/ — .*/,'')}</div>
                            <div style={{display:'flex',gap:8,marginTop:2,flexWrap:'wrap'}}>
                              {isActive&&<span style={{fontSize:10,color:'#4ade80',fontFamily:'monospace',fontWeight:700}}>▶ {fmt(elapsed)}</span>}
                              {isDone&&j.started_at&&<span style={{fontSize:9,color:'rgba(255,255,255,0.3)'}}>▶ {new Date(j.started_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</span>}
                              {isDone&&j.completed_at&&<span style={{fontSize:9,color:'#4ade80'}}>🏁 {new Date(j.completed_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</span>}
                              {duration&&<span style={{fontSize:9,color:'rgba(255,255,255,0.25)'}}>⏱ {duration}m</span>}
                            </div>
                          </div>
                          <div style={{display:'flex',gap:4,flexShrink:0}}>
                            {j.address?.startsWith('http')&&<a href={j.address} target="_blank" rel="noreferrer" style={{width:28,height:28,borderRadius:8,background:'rgba(96,165,250,0.08)',border:'1px solid rgba(96,165,250,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,textDecoration:'none'}}>🗺</a>}
                            <button onClick={()=>setSelectedJob(j)} style={{width:28,height:28,borderRadius:8,background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.07)',color:'rgba(255,255,255,0.4)',fontSize:10,cursor:'pointer',fontWeight:600}}>i</button>
                          </div>
                        </div>
                        {isActive&&(
                          <div>
                            {j.description&&<div style={{background:'rgba(255,255,255,0.04)',borderRadius:8,padding:'8px 10px',marginBottom:10,fontSize:12,color:'rgba(255,255,255,0.6)',lineHeight:1.6,whiteSpace:'pre-line'}}>{j.description}</div>}
                            {checklist.length>0&&(
                              <div style={{marginBottom:10}}>
                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}><span style={{fontSize:9,color:'rgba(255,255,255,0.35)',textTransform:'uppercase',letterSpacing:1}}>Checklist</span><span style={{fontSize:9,color:'#4ade80',fontWeight:600}}>{checklist.filter(t=>t.done).length}/{checklist.length}</span></div>
                                <div style={{height:3,background:'rgba(255,255,255,0.06)',borderRadius:2,marginBottom:8,overflow:'hidden'}}><div style={{height:'100%',width:(checklist.length?checklist.filter(t=>t.done).length/checklist.length*100:0)+'%',background:'#4ade80',borderRadius:2}} /></div>
                                {checklist.map((t,i)=>(
                                  <div key={i} onClick={()=>setChecklist(cl=>cl.map((x,ji)=>ji===i?{...x,done:!x.done}:x))} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 0',borderBottom:'1px solid rgba(255,255,255,0.04)',cursor:'pointer',userSelect:'none',WebkitUserSelect:'none'}}>
                                    <div style={{width:20,height:20,borderRadius:6,border:'1.5px solid',flexShrink:0,borderColor:t.done?'#4ade80':'rgba(255,255,255,0.15)',background:t.done?'#4ade80':'transparent',display:'flex',alignItems:'center',justifyContent:'center'}}>{t.done&&<span style={{fontSize:11,color:'#080f1a',fontWeight:900}}>✓</span>}</div>
                                    <span style={{fontSize:13,color:t.done?'rgba(255,255,255,0.25)':'#fff',textDecoration:t.done?'line-through':'none'}}>{t.label}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Notes..." style={{width:'100%',padding:'10px',fontSize:13,borderRadius:10,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(255,255,255,0.04)',color:'#fff',fontFamily:'inherit',boxSizing:'border-box',resize:'none',minHeight:60,marginBottom:10}} />
                            <PhotoGrid slot="end" label={`Photos${j.photo_required?' (required)':''}`} />
                            <button onClick={()=>handleCompleteWithSig(activeJob)} disabled={submitting} style={{width:'100%',padding:'13px',borderRadius:12,border:'none',background:submitting?'rgba(255,255,255,0.07)':'linear-gradient(135deg,#c19c56,#e8c47a)',color:submitting?'rgba(255,255,255,0.25)':'#0a1929',fontSize:15,fontWeight:800,cursor:submitting?'not-allowed':'pointer',marginTop:4}}>
                              {submitting?'Saving...':idx===dayJobs.length-1?'🏁 Finish Day':'🏁 Done → Next'}
                            </button>
                          </div>
                        )}
                        {isNext&&!activeJob&&(
                          <div style={{marginTop:10}}>
                            <button onClick={()=>handleStart(j)} disabled={submitting} style={{width:'100%',padding:'12px',borderRadius:11,border:'none',background:'linear-gradient(135deg,#0F6E56,#16a37e)',color:'#fff',fontSize:14,fontWeight:700,cursor:submitting?'not-allowed':'pointer'}}>
                              ▶ Start — {j.title.split(' —')[0]}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
                {dayJobs.every(j=>j.status==='completed')&&<div style={{textAlign:'center',padding:'20px',background:'rgba(74,222,128,0.05)',border:'1px solid rgba(74,222,128,0.1)',borderRadius:14,marginTop:6}}><div style={{fontSize:32,marginBottom:6}}>🎉</div><div style={{fontSize:15,fontWeight:700,color:'#4ade80'}}>Day Complete!</div><div style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginTop:3}}>All {dayJobs.length} locations done</div></div>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function CalendarView({ jobs, today, displayDate, onSelect }) {
  const [cm, setCm] = useState(() => { const d=new Date(); return {year:d.getFullYear(),month:d.getMonth()} })
  const { year, month } = cm
  const firstDay = new Date(year,month,1).getDay()
  const daysInMonth = new Date(year,month+1,0).getDate()
  const monthStr = `${year}-${String(month+1).padStart(2,'0')}`
  const jobsByDate = {}
  jobs.forEach(j=>{ const d=displayDate(j); if(d?.startsWith(monthStr)){ if(!jobsByDate[d]) jobsByDate[d]=[]; jobsByDate[d].push(j) } })
  const gc = dj => { if(!dj||!dj.length) return null; if(dj.every(j=>j.status==='completed')) return '#4ade80'; if(dj.some(j=>j.status==='in_progress')) return '#fbbf24'; if(dj.some(j=>j.status==='assigned')) return '#60a5fa'; return null }
  const [sel, setSel] = useState(null)
  const selJobs = sel?(jobsByDate[sel]||[]):[]
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <button onClick={()=>setCm(m=>{const d=new Date(m.year,m.month-1);return{year:d.getFullYear(),month:d.getMonth()}})} style={{width:36,height:36,borderRadius:10,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(255,255,255,0.04)',color:'#fff',fontSize:16,cursor:'pointer'}}>‹</button>
        <div style={{fontSize:15,fontWeight:600,color:'#fff'}}>{new Date(year,month).toLocaleString('en',{month:'long',year:'numeric'})}</div>
        <button onClick={()=>setCm(m=>{const d=new Date(m.year,m.month+1);return{year:d.getFullYear(),month:d.getMonth()}})} style={{width:36,height:36,borderRadius:10,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(255,255,255,0.04)',color:'#fff',fontSize:16,cursor:'pointer'}}>›</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3,marginBottom:4}}>
        {['S','M','T','W','T','F','S'].map((d,i)=><div key={i} style={{textAlign:'center',fontSize:9,color:'rgba(255,255,255,0.3)',fontWeight:600,padding:'4px 0'}}>{d}</div>)}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3,marginBottom:16}}>
        {Array(firstDay).fill(null).map((_,i)=><div key={'e'+i} />)}
        {Array(daysInMonth).fill(null).map((_,i)=>{
          const day=i+1
          const dStr=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const dj=jobsByDate[dStr]||[]
          const color=gc(dj)
          const isToday=dStr===today
          const isSel=dStr===sel
          return (
            <div key={day} onClick={()=>dj.length>0&&setSel(isSel?null:dStr)} style={{aspectRatio:'1',borderRadius:10,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',cursor:dj.length>0?'pointer':'default',background:isSel?'rgba(193,156,86,0.2)':isToday?'rgba(96,165,250,0.15)':'rgba(255,255,255,0.03)',border:isSel?'1px solid #c19c56':isToday?'1px solid rgba(96,165,250,0.4)':'1px solid rgba(255,255,255,0.05)'}}>
              <div style={{fontSize:13,fontWeight:isToday?700:400,color:isToday?'#60a5fa':'rgba(255,255,255,0.8)'}}>{day}</div>
              {color&&<div style={{width:5,height:5,borderRadius:'50%',background:color,marginTop:2}} />}
              {dj.length>1&&<div style={{fontSize:7,color:'rgba(255,255,255,0.3)',marginTop:1}}>{dj.length}</div>}
            </div>
          )
        })}
      </div>
      <div style={{display:'flex',gap:12,marginBottom:16,justifyContent:'center'}}>
        {[['#4ade80','Done'],['#60a5fa','Scheduled'],['#fbbf24','Active']].map(([c,l])=>(
          <div key={l} style={{display:'flex',alignItems:'center',gap:5}}><div style={{width:8,height:8,borderRadius:'50%',background:c}} /><span style={{fontSize:10,color:'rgba(255,255,255,0.4)'}}>{l}</span></div>
        ))}
      </div>
      {sel&&(
        <div>
          <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',letterSpacing:1,textTransform:'uppercase',marginBottom:10}}>{new Date(sel+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})}</div>
          {selJobs.sort((a,b)=>(a.sequence_order||99)-(b.sequence_order||99)).map(j=>{
            const sc={completed:'#4ade80',assigned:'#60a5fa',in_progress:'#fbbf24',cancelled:'rgba(255,255,255,0.2)'}[j.status]
            const duration=j.started_at&&j.completed_at?Math.round((new Date(j.completed_at)-new Date(j.started_at))/60000):null
            return (
              <div key={j.id} onClick={()=>onSelect(j)} style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:14,padding:'12px 14px',marginBottom:8,cursor:'pointer'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:4}}>
                  <div style={{flex:1,marginRight:8}}><div style={{fontSize:13,fontWeight:600,color:'#fff'}}>{j.title.replace(/ — .*/,'')}</div><div style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginTop:1}}>{j.scheduled_time}</div></div>
                  <span style={{fontSize:9,color:sc,fontWeight:700,textTransform:'uppercase'}}>{j.status}</span>
                </div>
                <div style={{display:'flex',gap:10,fontSize:9,color:'rgba(255,255,255,0.25)'}}>
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
    </div>
  )
}

function SignatureModal({ onConfirm, onCancel, jobTitle }) {
  const canvasRef = useRef()
  const [drawing, setDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)
  const lastPos = useRef(null)

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    if (e.touches) {
      return { x:(e.touches[0].clientX-rect.left)*scaleX, y:(e.touches[0].clientY-rect.top)*scaleY }
    }
    return { x:(e.clientX-rect.left)*scaleX, y:(e.clientY-rect.top)*scaleY }
  }

  const startDraw = (e) => {
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const pos = getPos(e, canvas)
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    lastPos.current = pos
    setDrawing(true)
    setHasSignature(true)
  }

  const draw = (e) => {
    if (!drawing) return
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const pos = getPos(e, canvas)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#fff'
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(pos.x, pos.y)
    lastPos.current = pos
  }

  const endDraw = () => setDrawing(false)

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
  }

  const confirm = () => {
    const canvas = canvasRef.current
    const dataUrl = canvas.toDataURL('image/png')
    onConfirm(dataUrl)
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',zIndex:300,display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
      <div style={{background:'#0d1f35',borderRadius:'24px 24px 0 0',padding:'20px 20px 50px'}}>
        <div style={{width:40,height:4,background:'rgba(255,255,255,0.15)',borderRadius:2,margin:'0 auto 18px'}} />
        <div style={{fontSize:16,fontWeight:700,color:'#fff',marginBottom:4,textAlign:'center'}}>Sign to Complete</div>
        <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',textAlign:'center',marginBottom:16}}>{jobTitle}</div>

        {/* Canvas */}
        <div style={{position:'relative',borderRadius:14,overflow:'hidden',border:'1px solid rgba(255,255,255,0.15)',marginBottom:14,background:'rgba(255,255,255,0.05)'}}>
          <canvas ref={canvasRef} width={380} height={160}
            style={{width:'100%',height:160,display:'block',touchAction:'none'}}
            onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
            onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
          />
          {!hasSignature&&<div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',color:'rgba(255,255,255,0.2)',fontSize:14,pointerEvents:'none'}}>Sign here with your finger</div>}
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
          <button onClick={clear} style={{padding:'13px',borderRadius:12,border:'1px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.5)',fontSize:13,cursor:'pointer'}}>Clear</button>
          <button onClick={onCancel} style={{padding:'13px',borderRadius:12,border:'1px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.5)',fontSize:13,cursor:'pointer'}}>Cancel</button>
          <button onClick={confirm} disabled={!hasSignature} style={{padding:'13px',borderRadius:12,border:'none',background:hasSignature?'linear-gradient(135deg,#c19c56,#e8c47a)':'rgba(255,255,255,0.07)',color:hasSignature?'#0a1929':'rgba(255,255,255,0.25)',fontSize:13,fontWeight:700,cursor:hasSignature?'pointer':'not-allowed'}}>
            ✓ Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
