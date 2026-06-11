import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { distanceMeters, getCurrentPosition } from '../lib/geocode'
import toast from 'react-hot-toast'

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
  const [clock, setClock] = useState(new Date())
  const [empScore, setEmpScore] = useState(user.score||100)
  const [historyFilter, setHistoryFilter] = useState('all')
  const [selectedJob, setSelectedJob] = useState(null)
  const timerRef = useRef()
  const clockRef = useRef()
  const startRef = useRef()
  const endRef = useRef()

  useEffect(() => {
    loadAll()
    clockRef.current = setInterval(() => setClock(new Date()), 1000)
    return () => { clearInterval(clockRef.current); clearInterval(timerRef.current) }
  }, [])

  useEffect(() => {
    if (activeJob?.started_at) {
      const start = new Date(activeJob.started_at)
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now()-start)/1000)), 1000)
    }
    return () => clearInterval(timerRef.current)
  }, [activeJob])

  const loadAll = async () => {
    const today = new Date().toISOString().split('T')[0]
    const [active, all, emp] = await Promise.all([
      supabase.from('jobs').select('*').eq('employee_id',user.id).in('status',['assigned','in_progress']).order('scheduled_date'),
      supabase.from('jobs').select('*').eq('employee_id',user.id).order('scheduled_date',{ascending:false}).limit(100),
      supabase.from('employees').select('score,fixed_salary,salary_type,hourly_rate').eq('id',user.id).single(),
    ])
    const regular = (active.data||[]).filter(j=>j.job_category!=='spot'||j.spot_status==='accepted')
    const spots = (active.data||[]).filter(j=>j.job_category==='spot'&&j.spot_status==='pending')
    setJobs(regular); setSpotJobs(spots); setAllJobs(all.data||[])
    if (emp.data) setEmpScore(emp.data.score||100)
    const inProgress = regular.find(j=>j.status==='in_progress')
    if (inProgress) {
      setActiveJob(inProgress)
      const cl = inProgress.checklist_template ? inProgress.checklist_template.split('\n').filter(Boolean).map(l=>({label:l,done:false})) : []
      setChecklist(cl)
    }
    // salary
    const month = new Date().toISOString().slice(0,7)
    const completed = (all.data||[]).filter(j=>j.status==='completed'&&j.scheduled_date?.startsWith(month))
    const totalMins = completed.reduce((s,j)=>{ if(!j.started_at||!j.completed_at) return s; return s+(new Date(j.completed_at)-new Date(j.started_at))/60000 },0)
    const spotEarned = completed.filter(j=>j.job_category==='spot').reduce((s,j)=>s+Number(j.spot_value||0),0)
    const base = emp.data?.salary_type==='hourly'?(totalMins/60)*(emp.data?.hourly_rate||0):(emp.data?.fixed_salary||0)
    setSalaryData({ jobs:completed.length, hours:(totalMins/60).toFixed(1), base:Math.round(base), spotEarned, total:Math.round(base)+spotEarned })
  }

  const checkGPS = async (job) => {
    if (!job.gps_lat||!job.gps_lng) return true
    setGpsStatus('Checking...')
    try {
      const pos = await getCurrentPosition()
      const dist = distanceMeters(pos.lat,pos.lng,Number(job.gps_lat),Number(job.gps_lng))
      if (dist>100) { setGpsStatus(`${Math.round(dist)}m away`); toast.error(`Too far! ${Math.round(dist)}m from location.`); return false }
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
      const path = `jobs/${job.id}/start.${ext}`
      await supabase.storage.from('service-photos').upload(path,photos.start,{upsert:true})
      const { data:pd } = supabase.storage.from('service-photos').getPublicUrl(path)
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
      const path = `jobs/${activeJob.id}/end.${ext}`
      await supabase.storage.from('service-photos').upload(path,photos.end,{upsert:true})
      const { data:pd } = supabase.storage.from('service-photos').getPublicUrl(path)
      photoUrl = pd.publicUrl
    }
    await supabase.from('jobs').update({ status:'completed',completed_at:new Date().toISOString(),notes_employee:notes,photo_end_url:photoUrl,checklist_template:JSON.stringify(checklist) }).eq('id',activeJob.id)
    clearInterval(timerRef.current)
    setActiveJob(null); setElapsed(0); setChecklist([]); setNotes('')
    setPhotos({start:null,end:null}); setPreviews({start:null,end:null})
    toast.success('🎉 Completed!'); loadAll(); setTab('home'); setSubmitting(false)
  }

  const fmt = s=>`${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`
  const scoreColor = s=>s>=90?'#4ade80':s>=70?'#fbbf24':'#f87171'
  const today = new Date().toISOString().split('T')[0]

  const filteredAllJobs = allJobs.filter(j=>{
    if (historyFilter==='upcoming') return j.status==='assigned'&&j.scheduled_date>=today
    if (historyFilter==='past') return j.status==='completed'
    if (historyFilter==='cancelled') return j.status==='cancelled'
    return true
  })

  const PhotoSlot = ({ slot, label, required }) => (
    <div>
      <input type="file" accept="image/*" capture="environment" ref={slot==='start'?startRef:endRef} style={{display:'none'}}
        onChange={e=>{const f=e.target.files[0];if(f){setPhotos(p=>({...p,[slot]:f}));setPreviews(p=>({...p,[slot]:URL.createObjectURL(f)}))}}} />
      <div onClick={()=>(slot==='start'?startRef:endRef).current.click()}
        style={{width:'100%',aspectRatio:'4/3',borderRadius:16,overflow:'hidden',cursor:'pointer',
          border:previews[slot]?'2px solid #4ade80':'2px dashed rgba(255,255,255,0.12)',
          background:'rgba(255,255,255,0.03)',display:'flex',flexDirection:'column',
          alignItems:'center',justifyContent:'center',gap:10,color:'rgba(255,255,255,0.35)',transition:'all 0.2s'}}>
        {previews[slot]?<img src={previews[slot]} style={{width:'100%',height:'100%',objectFit:'cover'}} />
          :<><span style={{fontSize:42}}>📷</span><span style={{fontSize:14,fontWeight:500}}>{label}{required?' *':''}</span><span style={{fontSize:12,opacity:0.6}}>Tap to take photo</span></>}
      </div>
      {previews[slot]&&<div style={{fontSize:12,color:'#4ade80',textAlign:'center',marginTop:6,fontWeight:500}}>✓ Photo ready</div>}
    </div>
  )

  const menuItems = [
    {key:'home',icon:'🏠',label:'Dashboard'},
    {key:'jobs',icon:'📋',label:'My Jobs'},
    {key:'spots',icon:'⚡',label:'Spot Jobs',badge:spotJobs.length},
    {key:'history',icon:'📅',label:'All Jobs'},
    {key:'salary',icon:'💴',label:'Salary'},
  ]

  // Job detail modal
  const JobModal = ({ job, onClose }) => {
    const duration = job.started_at&&job.completed_at ? Math.round((new Date(job.completed_at)-new Date(job.started_at))/60000) : null
    const cl = (() => { try { return JSON.parse(job.checklist_template||'[]') } catch { return [] } })()
    return (
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',zIndex:200,display:'flex',flexDirection:'column',justifyContent:'flex-end'}} onClick={onClose}>
        <div style={{background:'#0d2137',borderRadius:'20px 20px 0 0',padding:20,maxHeight:'85vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
          <div style={{width:40,height:4,background:'rgba(255,255,255,0.2)',borderRadius:2,margin:'0 auto 16px'}} />
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:14}}>
            <div style={{flex:1,marginRight:12}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                {job.job_category==='spot'&&<span style={{fontSize:10,background:'#c19c56',color:'#0a1929',padding:'2px 8px',borderRadius:20,fontWeight:800}}>SPOT</span>}
                <span style={{fontSize:18,fontWeight:700,color:'#fff'}}>{job.title}</span>
              </div>
              <div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>{job.client_name} · {job.scheduled_date}</div>
            </div>
            <div style={{fontSize:20,fontWeight:800,color:'#c19c56'}}>¥{Number(job.spot_value||job.value||0).toLocaleString()}</div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:14}}>
            {[
              ['📍 Location',job.address||'—'],
              ['📅 Date',job.scheduled_date||'—'],
              ['▶ Check-in',job.started_at?new Date(job.started_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):'—'],
              ['🏁 Check-out',job.completed_at?new Date(job.completed_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):'—'],
              ['⏱ Duration',duration?`${duration} min`:'—'],
              ['Status',job.status],
            ].map(([l,v])=>(
              <div key={l} style={{background:'rgba(255,255,255,0.05)',borderRadius:10,padding:'10px 12px'}}>
                <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:3}}>{l}</div>
                <div style={{fontSize:13,fontWeight:500,color:'#fff'}}>{v}</div>
              </div>
            ))}
          </div>

          {job.description&&<div style={{background:'rgba(255,255,255,0.04)',borderRadius:10,padding:'10px 12px',marginBottom:12}}>
            <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:4}}>Description</div>
            <div style={{fontSize:13,color:'rgba(255,255,255,0.7)',lineHeight:1.5}}>{job.description}</div>
          </div>}

          {job.notes_employee&&<div style={{background:'rgba(255,255,255,0.04)',borderRadius:10,padding:'10px 12px',marginBottom:12}}>
            <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:4}}>Your Notes</div>
            <div style={{fontSize:13,color:'rgba(255,255,255,0.7)',lineHeight:1.5}}>{job.notes_employee}</div>
          </div>}

          {cl.length>0&&<div style={{marginBottom:14}}>
            <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:8,letterSpacing:1,textTransform:'uppercase'}}>Checklist — {cl.filter(t=>t.done).length}/{cl.length} done</div>
            {cl.map((t,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                <div style={{width:20,height:20,borderRadius:5,background:t.done?'#4ade80':'rgba(255,255,255,0.1)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                  {t.done&&<span style={{fontSize:12,color:'#080f1a',fontWeight:900}}>✓</span>}
                </div>
                <span style={{fontSize:13,color:t.done?'rgba(255,255,255,0.4)':'rgba(255,255,255,0.7)',textDecoration:t.done?'line-through':'none'}}>{t.label}</span>
              </div>
            ))}
          </div>}

          {/* Photos */}
          {(job.photo_start_url||job.photo_end_url)&&(
            <div style={{marginBottom:14}}>
              <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginBottom:8,letterSpacing:1,textTransform:'uppercase'}}>Photos</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                {job.photo_start_url&&<div><div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginBottom:4}}>START</div><img src={job.photo_start_url} style={{width:'100%',borderRadius:10,objectFit:'cover',aspectRatio:'4/3'}} /></div>}
                {job.photo_end_url&&<div><div style={{fontSize:10,color:'rgba(255,255,255,0.3)',marginBottom:4}}>END</div><img src={job.photo_end_url} style={{width:'100%',borderRadius:10,objectFit:'cover',aspectRatio:'4/3'}} /></div>}
              </div>
            </div>
          )}

          <button onClick={onClose} style={{width:'100%',padding:'15px',borderRadius:14,border:'none',background:'rgba(255,255,255,0.08)',color:'rgba(255,255,255,0.6)',fontSize:15,fontWeight:600,cursor:'pointer'}}>Close</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{minHeight:'100vh',background:'#080f1a',display:'flex',flexDirection:'column',maxWidth:430,margin:'0 auto',WebkitTapHighlightColor:'transparent'}}>

      {selectedJob&&<JobModal job={selectedJob} onClose={()=>setSelectedJob(null)} />}

      {/* BG glows */}
      <div style={{position:'fixed',top:-80,left:-80,width:280,height:280,background:'radial-gradient(circle,rgba(193,156,86,0.12) 0%,transparent 70%)',pointerEvents:'none',zIndex:0}} />
      <div style={{position:'fixed',bottom:-60,right:-60,width:240,height:240,background:'radial-gradient(circle,rgba(74,222,128,0.07) 0%,transparent 70%)',pointerEvents:'none',zIndex:0}} />

      {/* HEADER */}
      <div style={{position:'sticky',top:0,zIndex:50,background:'rgba(8,15,26,0.96)',backdropFilter:'blur(20px)',WebkitBackdropFilter:'blur(20px)',borderBottom:'1px solid rgba(255,255,255,0.05)',padding:'16px 16px 12px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
          <div>
            <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',letterSpacing:2,textTransform:'uppercase',marginBottom:2}}>KuriPuro</div>
            <div style={{fontSize:21,fontWeight:700,color:'#fff',letterSpacing:-0.5,lineHeight:1}}>{user.name.split(' ')[0]}</div>
            <div style={{fontSize:11,color:'rgba(255,255,255,0.35)',marginTop:3}}>{clock.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'short'})}</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <div style={{background:`rgba(${empScore>=90?'74,222,128':empScore>=70?'251,191,36':'248,113,113'},0.12)`,border:`1px solid rgba(${empScore>=90?'74,222,128':empScore>=70?'251,191,36':'248,113,113'},0.25)`,borderRadius:12,padding:'6px 10px',textAlign:'center',minWidth:52}}>
              <div style={{fontSize:19,fontWeight:800,color:scoreColor(empScore),lineHeight:1}}>{empScore}</div>
              <div style={{fontSize:8,color:'rgba(255,255,255,0.3)',textTransform:'uppercase',letterSpacing:0.8,marginTop:1}}>Score</div>
            </div>
            <button onClick={()=>setMenuOpen(!menuOpen)} style={{width:38,height:38,borderRadius:11,background:'rgba(255,255,255,0.07)',border:'1px solid rgba(255,255,255,0.08)',color:'#fff',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3.5,flexShrink:0}}>
              {[0,1,2].map(i=><div key={i} style={{width:3.5,height:3.5,borderRadius:'50%',background:'rgba(255,255,255,0.6)'}} />)}
            </button>
          </div>
        </div>

        {/* Clock */}
        <div style={{fontSize:44,fontWeight:700,color:'#fff',fontFamily:'monospace',letterSpacing:-2,lineHeight:1,marginTop:10}}>
          {clock.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}
          <span style={{fontSize:22,color:'rgba(255,255,255,0.3)',marginLeft:2,fontWeight:400}}>{String(clock.getSeconds()).padStart(2,'0')}</span>
        </div>

        {/* Status pills */}
        <div style={{display:'flex',gap:6,marginTop:10,flexWrap:'wrap'}}>
          {gpsStatus&&<div style={{background:'rgba(255,255,255,0.05)',borderRadius:20,padding:'4px 10px',fontSize:10,color:gpsStatus.includes('✓')?'#4ade80':'rgba(255,255,255,0.4)',fontWeight:500}}>📍 {gpsStatus}</div>}
          {activeJob&&<div style={{background:'rgba(74,222,128,0.12)',border:'1px solid rgba(74,222,128,0.25)',borderRadius:20,padding:'4px 12px',fontSize:12,color:'#4ade80',fontWeight:700,fontFamily:'monospace'}}>▶ {fmt(elapsed)}</div>}
          {spotJobs.length>0&&<div onClick={()=>setTab('spots')} style={{background:'rgba(193,156,86,0.12)',border:'1px solid rgba(193,156,86,0.25)',borderRadius:20,padding:'4px 10px',fontSize:10,color:'#c19c56',cursor:'pointer',fontWeight:600}}>⚡ {spotJobs.length} spot{spotJobs.length>1?'s':''}</div>}
        </div>
      </div>

      {/* 3-dot dropdown */}
      {menuOpen&&(
        <div style={{position:'fixed',inset:0,zIndex:100}} onClick={()=>setMenuOpen(false)}>
          <div style={{position:'absolute',top:130,right:12,background:'#0d2137',border:'1px solid rgba(255,255,255,0.08)',borderRadius:18,overflow:'hidden',minWidth:190,boxShadow:'0 24px 80px rgba(0,0,0,0.6)'}} onClick={e=>e.stopPropagation()}>
            {menuItems.map(item=>(
              <button key={item.key} onClick={()=>{setTab(item.key);setMenuOpen(false)}} style={{width:'100%',padding:'14px 18px',border:'none',background:tab===item.key?'rgba(193,156,86,0.12)':'none',color:tab===item.key?'#c19c56':'rgba(255,255,255,0.75)',fontSize:14,fontWeight:tab===item.key?600:400,cursor:'pointer',display:'flex',alignItems:'center',gap:12,borderBottom:'1px solid rgba(255,255,255,0.04)',textAlign:'left'}}>
                <span style={{fontSize:17}}>{item.icon}</span>
                <span style={{flex:1}}>{item.label}</span>
                {item.badge>0&&<span style={{background:'#c19c56',color:'#0a1929',borderRadius:20,padding:'2px 8px',fontSize:11,fontWeight:800}}>{item.badge}</span>}
              </button>
            ))}
            <div style={{height:'1px',background:'rgba(255,255,255,0.06)'}} />
            <button onClick={logout} style={{width:'100%',padding:'14px 18px',border:'none',background:'none',color:'#f87171',fontSize:14,cursor:'pointer',display:'flex',alignItems:'center',gap:12,textAlign:'left'}}>
              <span style={{fontSize:17}}>🚪</span> Logout
            </button>
          </div>
        </div>
      )}

      {/* CONTENT */}
      <div style={{flex:1,padding:'14px 12px 40px',overflowY:'auto',position:'relative',zIndex:1}}>

        {/* HOME */}
        {tab==='home'&&(
          <div>
            {activeJob&&(
              <div onClick={()=>setTab('jobs')} style={{background:'linear-gradient(135deg,rgba(74,222,128,0.12),rgba(74,222,128,0.04))',border:'1px solid rgba(74,222,128,0.25)',borderRadius:20,padding:16,marginBottom:12,cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:10,color:'#4ade80',fontWeight:700,letterSpacing:1,marginBottom:4}}>● IN PROGRESS</div>
                  <div style={{fontSize:16,fontWeight:700,color:'#fff'}}>{activeJob.title}</div>
                  <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginTop:2}}>Tap to continue →</div>
                </div>
                <div style={{fontSize:26,fontWeight:700,color:'#4ade80',fontFamily:'monospace'}}>{fmt(elapsed)}</div>
              </div>
            )}

            <div style={{fontSize:10,color:'rgba(255,255,255,0.35)',letterSpacing:1.5,textTransform:'uppercase',marginBottom:10}}>Today</div>
            {jobs.filter(j=>j.scheduled_date===today&&j.status==='assigned').length===0&&!activeJob&&(
              <div style={{background:'rgba(255,255,255,0.03)',borderRadius:16,padding:'20px',textAlign:'center',color:'rgba(255,255,255,0.25)',fontSize:13,marginBottom:12}}>No jobs today</div>
            )}
            {jobs.filter(j=>j.scheduled_date===today&&j.status==='assigned').map(j=>(
              <div key={j.id} style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:16,padding:'14px',marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div style={{flex:1,marginRight:10}}>
                  <div style={{fontSize:14,fontWeight:600,color:'#fff'}}>{j.title}</div>
                  <div style={{fontSize:11,color:'rgba(255,255,255,0.35)',marginTop:2}}>{j.scheduled_time||'No time set'} · {j.client_name||'—'}</div>
                  <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginTop:1}}>📍 {j.address}</div>
                </div>
                <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6}}>
                  <div style={{fontSize:13,fontWeight:700,color:'#c19c56'}}>¥{Number(j.spot_value||j.value||0).toLocaleString()}</div>
                  <button onClick={()=>handleStart(j)} disabled={submitting||!!activeJob} style={{padding:'7px 14px',borderRadius:9,border:'none',background:activeJob?'rgba(255,255,255,0.05)':'#0F6E56',color:activeJob?'rgba(255,255,255,0.25)':'#fff',fontSize:12,fontWeight:700,cursor:activeJob?'not-allowed':'pointer'}}>
                    {activeJob?'Busy':'▶'}
                  </button>
                </div>
              </div>
            ))}

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:4,marginBottom:14}}>
              {[['📋',salaryData?.jobs||0,'Jobs'],['⏱',(salaryData?.hours||0)+'h','Hours'],['💴','¥'+(salaryData?.total||0).toLocaleString(),'Earned']].map(([icon,v,l])=>(
                <div key={l} style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:14,padding:'12px 8px',textAlign:'center'}}>
                  <div style={{fontSize:18,marginBottom:4}}>{icon}</div>
                  <div style={{fontSize:14,fontWeight:700,color:'#fff'}}>{v}</div>
                  <div style={{fontSize:9,color:'rgba(255,255,255,0.3)',marginTop:2,textTransform:'uppercase',letterSpacing:0.5}}>{l}</div>
                </div>
              ))}
            </div>

            <div style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:16,padding:14,marginBottom:12}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                <div style={{fontSize:12,color:'rgba(255,255,255,0.5)',fontWeight:500}}>Performance</div>
                <div style={{fontSize:16,fontWeight:800,color:scoreColor(empScore)}}>{empScore}<span style={{fontSize:10,color:'rgba(255,255,255,0.25)'}}>/100</span></div>
              </div>
              <div style={{height:6,background:'rgba(255,255,255,0.07)',borderRadius:3,overflow:'hidden'}}>
                <div style={{height:'100%',width:empScore+'%',borderRadius:3,background:`linear-gradient(90deg,${scoreColor(empScore)},${scoreColor(empScore)}88)`,transition:'width 0.6s'}} />
              </div>
              <div style={{fontSize:10,color:'rgba(255,255,255,0.25)',marginTop:5}}>{empScore>=90?'🌟 Excellent':empScore>=70?'👍 Good':'⚠️ Needs improvement'}</div>
            </div>

            {spotJobs.length>0&&(
              <div onClick={()=>setTab('spots')} style={{background:'rgba(193,156,86,0.08)',border:'1px solid rgba(193,156,86,0.2)',borderRadius:16,padding:'14px 16px',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:'#c19c56'}}>⚡ {spotJobs.length} Spot Job{spotJobs.length>1?'s':''}</div>
                  <div style={{fontSize:11,color:'rgba(255,255,255,0.35)',marginTop:2}}>Tap to view & respond</div>
                </div>
                <div style={{fontSize:20,color:'#c19c56'}}>›</div>
              </div>
            )}
          </div>
        )}

        {/* JOBS */}
        {tab==='jobs'&&(
          <div>
            {activeJob&&(
              <div style={{background:'rgba(13,33,55,0.95)',border:'1px solid rgba(74,222,128,0.25)',borderRadius:20,padding:16,marginBottom:14}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                  <div><div style={{fontSize:10,color:'#4ade80',fontWeight:700,letterSpacing:1}}>IN PROGRESS</div><div style={{fontSize:17,fontWeight:700,color:'#fff',marginTop:3}}>{activeJob.title}</div><div style={{fontSize:11,color:'rgba(255,255,255,0.35)',marginTop:2}}>📍 {activeJob.address}</div></div>
                  <div style={{fontSize:26,fontWeight:700,color:'#4ade80',fontFamily:'monospace'}}>{fmt(elapsed)}</div>
                </div>
                {checklist.length>0&&(
                  <div style={{marginBottom:12}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                      <div style={{fontSize:10,color:'rgba(255,255,255,0.35)',letterSpacing:1,textTransform:'uppercase'}}>Checklist</div>
                      <div style={{fontSize:10,color:'#4ade80',fontWeight:600}}>{checklist.filter(t=>t.done).length}/{checklist.length}</div>
                    </div>
                    <div style={{height:3,background:'rgba(255,255,255,0.07)',borderRadius:2,marginBottom:10,overflow:'hidden'}}>
                      <div style={{height:'100%',width:(checklist.length?checklist.filter(t=>t.done).length/checklist.length*100:0)+'%',background:'#4ade80',borderRadius:2,transition:'width 0.3s'}} />
                    </div>
                    {checklist.map((t,i)=>(
                      <div key={i} onClick={()=>setChecklist(c=>c.map((x,j)=>j===i?{...x,done:!x.done}:x))}
                        style={{display:'flex',alignItems:'center',gap:12,padding:'12px 0',borderBottom:'1px solid rgba(255,255,255,0.04)',cursor:'pointer',userSelect:'none',WebkitUserSelect:'none'}}>
                        <div style={{width:22,height:22,borderRadius:6,border:'1.5px solid',flexShrink:0,borderColor:t.done?'#4ade80':'rgba(255,255,255,0.18)',background:t.done?'#4ade80':'transparent',display:'flex',alignItems:'center',justifyContent:'center',transition:'all 0.2s'}}>
                          {t.done&&<span style={{fontSize:13,color:'#080f1a',fontWeight:900}}>✓</span>}
                        </div>
                        <span style={{fontSize:15,color:t.done?'rgba(255,255,255,0.3)':'#fff',textDecoration:t.done?'line-through':'none',lineHeight:1.3}}>{t.label}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:10,color:'rgba(255,255,255,0.35)',letterSpacing:1,textTransform:'uppercase',marginBottom:7}}>Notes</div>
                  <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Describe the service..." style={{width:'100%',padding:'12px',fontSize:14,borderRadius:12,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(255,255,255,0.04)',color:'#fff',fontFamily:'inherit',boxSizing:'border-box',resize:'vertical',minHeight:80}} />
                </div>
                <div style={{marginBottom:14}}>
                  <div style={{fontSize:10,color:'rgba(255,255,255,0.35)',letterSpacing:1,textTransform:'uppercase',marginBottom:8}}>End Photo {activeJob.photo_required&&<span style={{color:'#f87171'}}>· REQUIRED</span>}</div>
                  <PhotoSlot slot="end" label="End photo" required={activeJob.photo_required} />
                </div>
                <button onClick={handleComplete} disabled={submitting} style={{width:'100%',padding:'17px',borderRadius:16,border:'none',background:submitting?'rgba(255,255,255,0.08)':'linear-gradient(135deg,#c19c56,#e8c47a)',color:submitting?'rgba(255,255,255,0.3)':'#0a1929',fontSize:17,fontWeight:800,cursor:submitting?'not-allowed':'pointer'}}>
                  {submitting?'Saving...':'🏁 Complete Job'}
                </button>
              </div>
            )}
            {jobs.filter(j=>j.status==='assigned').map(j=>(
              <div key={j.id} style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:18,padding:14,marginBottom:10}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                  <div style={{flex:1,marginRight:10}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                      {j.job_category==='spot'&&<span style={{fontSize:9,background:'#c19c56',color:'#0a1929',padding:'2px 7px',borderRadius:20,fontWeight:800}}>SPOT</span>}
                      <span style={{fontSize:15,fontWeight:700,color:'#fff'}}>{j.title}</span>
                    </div>
                    <div style={{fontSize:11,color:'rgba(255,255,255,0.35)',marginBottom:1}}>📅 {j.scheduled_date}{j.scheduled_time&&` · ${j.scheduled_time}`}</div>
                    <div style={{fontSize:11,color:'rgba(255,255,255,0.35)'}}>📍 {j.address}</div>
                  </div>
                  <div style={{fontSize:14,fontWeight:700,color:'#c19c56',flexShrink:0}}>¥{Number(j.spot_value||j.value||0).toLocaleString()}</div>
                </div>
                {j.description&&<div style={{fontSize:12,color:'rgba(255,255,255,0.45)',background:'rgba(255,255,255,0.03)',borderRadius:9,padding:'9px 11px',marginBottom:10,lineHeight:1.5}}>{j.description}</div>}
                {j.photo_required&&!activeJob&&<div style={{marginBottom:10}}><div style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginBottom:7}}>📷 Start photo</div><PhotoSlot slot="start" label="Start photo" required={false} /></div>}
                <button onClick={()=>handleStart(j)} disabled={submitting||!!activeJob} style={{width:'100%',padding:'14px',borderRadius:13,border:'none',background:activeJob?'rgba(255,255,255,0.05)':'linear-gradient(135deg,#0F6E56,#16a37e)',color:activeJob?'rgba(255,255,255,0.25)':'#fff',fontSize:15,fontWeight:700,cursor:activeJob?'not-allowed':'pointer'}}>
                  {activeJob?'Finish active job first':'▶ Start Job'}
                </button>
              </div>
            ))}
            {!activeJob&&jobs.filter(j=>j.status==='assigned').length===0&&<div style={{textAlign:'center',paddingTop:50}}><div style={{fontSize:48}}>☀️</div><div style={{fontSize:16,color:'rgba(255,255,255,0.4)',marginTop:10}}>No pending jobs</div></div>}
          </div>
        )}

        {/* SPOTS */}
        {tab==='spots'&&(
          <div>
            {spotJobs.length===0?<div style={{textAlign:'center',paddingTop:60}}><div style={{fontSize:46}}>⚡</div><div style={{fontSize:15,color:'rgba(255,255,255,0.35)',marginTop:10}}>No spot jobs pending</div></div>
            :spotJobs.map(j=>(
              <div key={j.id} style={{background:'rgba(193,156,86,0.07)',border:'1px solid rgba(193,156,86,0.18)',borderRadius:20,padding:16,marginBottom:12}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
                  <div style={{flex:1,marginRight:10}}>
                    <div style={{fontSize:17,fontWeight:700,color:'#fff',marginBottom:4}}>{j.title}</div>
                    <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:2}}>📅 {j.scheduled_date}{j.scheduled_time&&` · ${j.scheduled_time}`}</div>
                    <div style={{fontSize:11,color:'rgba(255,255,255,0.4)'}}>📍 {j.address}</div>
                  </div>
                  <div style={{background:'rgba(193,156,86,0.15)',border:'1px solid rgba(193,156,86,0.25)',borderRadius:12,padding:'8px 12px',textAlign:'center',flexShrink:0}}>
                    <div style={{fontSize:9,color:'#c19c56',fontWeight:700,letterSpacing:1}}>EXTRA</div>
                    <div style={{fontSize:20,fontWeight:800,color:'#c19c56'}}>+¥{Number(j.spot_value||0).toLocaleString()}</div>
                  </div>
                </div>
                {j.description&&<div style={{fontSize:13,color:'rgba(255,255,255,0.5)',background:'rgba(255,255,255,0.03)',borderRadius:9,padding:'9px 11px',marginBottom:12,lineHeight:1.5}}>{j.description}</div>}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                  <button onClick={()=>handleAcceptSpot(j)} style={{padding:'15px',borderRadius:13,border:'none',background:'linear-gradient(135deg,#0F6E56,#16a37e)',color:'#fff',fontSize:15,fontWeight:700,cursor:'pointer'}}>✅ Accept</button>
                  <button onClick={()=>handleDeclineSpot(j)} style={{padding:'15px',borderRadius:13,border:'1px solid rgba(255,255,255,0.08)',background:'rgba(255,255,255,0.04)',color:'rgba(255,255,255,0.5)',fontSize:15,fontWeight:700,cursor:'pointer'}}>✕ Decline</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* HISTORY */}
        {tab==='history'&&(
          <div>
            {/* Filter pills */}
            <div style={{display:'flex',gap:6,marginBottom:14,overflowX:'auto',paddingBottom:2}}>
              {[['all','All'],['upcoming','Upcoming'],['past','Completed'],['cancelled','Cancelled']].map(([k,l])=>(
                <button key={k} onClick={()=>setHistoryFilter(k)} style={{padding:'7px 14px',borderRadius:20,border:'1px solid',flexShrink:0,borderColor:historyFilter===k?'#c19c56':'rgba(255,255,255,0.1)',background:historyFilter===k?'rgba(193,156,86,0.15)':'rgba(255,255,255,0.03)',color:historyFilter===k?'#c19c56':'rgba(255,255,255,0.45)',fontSize:12,fontWeight:historyFilter===k?600:400,cursor:'pointer'}}>
                  {l}
                </button>
              ))}
            </div>
            {filteredAllJobs.length===0&&<div style={{textAlign:'center',paddingTop:40,color:'rgba(255,255,255,0.3)',fontSize:13}}>No jobs found</div>}
            {filteredAllJobs.map(j=>{
              const duration = j.started_at&&j.completed_at?Math.round((new Date(j.completed_at)-new Date(j.started_at))/60000):null
              const statusC = {assigned:'#60a5fa',in_progress:'#fbbf24',completed:'#4ade80',cancelled:'rgba(255,255,255,0.2)'}[j.status]||'#fff'
              return (
                <div key={j.id} onClick={()=>setSelectedJob(j)} style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:16,padding:'13px 14px',marginBottom:8,cursor:'pointer',WebkitTapHighlightColor:'transparent',active:{background:'rgba(255,255,255,0.08)'}}} >
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
                    <div style={{flex:1,marginRight:10}}>
                      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
                        {j.job_category==='spot'&&<span style={{fontSize:9,background:'#c19c56',color:'#0a1929',padding:'1px 6px',borderRadius:20,fontWeight:800}}>SPOT</span>}
                        <span style={{fontSize:14,fontWeight:600,color:'#fff'}}>{j.title}</span>
                      </div>
                      <div style={{fontSize:11,color:'rgba(255,255,255,0.35)'}}>{j.scheduled_date} · {j.client_name||'—'}</div>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
                      <div style={{fontSize:13,fontWeight:700,color:'#c19c56'}}>¥{Number(j.spot_value||j.value||0).toLocaleString()}</div>
                      <div style={{fontSize:9,color:statusC,fontWeight:600,textTransform:'uppercase',letterSpacing:0.5}}>{j.status}</div>
                    </div>
                  </div>
                  <div style={{display:'flex',gap:12,fontSize:10,color:'rgba(255,255,255,0.3)'}}>
                    {j.started_at&&<span>▶ {new Date(j.started_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</span>}
                    {j.completed_at&&<span>🏁 {new Date(j.completed_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</span>}
                    {duration&&<span>⏱ {duration}min</span>}
                    <span style={{marginLeft:'auto',color:'rgba(255,255,255,0.2)'}}>Tap for details ›</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* SALARY */}
        {tab==='salary'&&(
          <div>
            <div style={{background:'linear-gradient(135deg,rgba(193,156,86,0.18),rgba(193,156,86,0.04))',border:'1px solid rgba(193,156,86,0.2)',borderRadius:22,padding:'26px 20px',textAlign:'center',marginBottom:16}}>
              <div style={{fontSize:10,color:'rgba(255,255,255,0.35)',letterSpacing:2,textTransform:'uppercase',marginBottom:6}}>Estimated Salary</div>
              <div style={{fontSize:46,fontWeight:800,color:'#c19c56',letterSpacing:-2,lineHeight:1}}>¥{(salaryData?.total||0).toLocaleString()}</div>
              <div style={{fontSize:11,color:'rgba(255,255,255,0.25)',marginTop:6}}>{new Date().toLocaleString('en',{month:'long',year:'numeric'})} · confirmed by admin</div>
              {(salaryData?.spotEarned||0)>0&&<div style={{fontSize:12,color:'rgba(193,156,86,0.7)',marginTop:6}}>includes ¥{salaryData.spotEarned.toLocaleString()} from ⚡ spot jobs</div>}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              {[['📋','Jobs Done',salaryData?.jobs||0],['⏱','Hours',(salaryData?.hours||0)+'h'],['💴','Base','¥'+(salaryData?.base||0).toLocaleString()],['⚡','Spot','¥'+(salaryData?.spotEarned||0).toLocaleString()]].map(([icon,l,v])=>(
                <div key={l} style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:16,padding:'16px 12px'}}>
                  <div style={{fontSize:22,marginBottom:8}}>{icon}</div>
                  <div style={{fontSize:20,fontWeight:700,color:'#fff'}}>{v}</div>
                  <div style={{fontSize:10,color:'rgba(255,255,255,0.35)',marginTop:3,textTransform:'uppercase',letterSpacing:0.5}}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
