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
  const [history, setHistory] = useState([])
  const [clock, setClock] = useState(new Date())
  const [empScore, setEmpScore] = useState(user.score || 100)
  const timerRef = useRef()
  const clockRef = useRef()
  const startRef = useRef()
  const endRef = useRef()

  useEffect(() => {
    loadJobs(); loadSalary(); loadHistory()
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

  const loadJobs = async () => {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase.from('jobs').select('*')
      .eq('employee_id', user.id).in('status',['assigned','in_progress'])
      .gte('scheduled_date', today).order('scheduled_date')
    const regular = (data||[]).filter(j=>j.job_category!=='spot'||j.spot_status==='accepted')
    const spots = (data||[]).filter(j=>j.job_category==='spot'&&j.spot_status==='pending')
    setJobs(regular); setSpotJobs(spots)
    const inProgress = regular.find(j=>j.status==='in_progress')
    if (inProgress) {
      setActiveJob(inProgress)
      const cl = inProgress.checklist_template ? inProgress.checklist_template.split('\n').filter(Boolean).map(l=>({label:l,done:false})) : []
      setChecklist(cl)
    }
  }

  const loadSalary = async () => {
    const month = new Date().toISOString().slice(0,7)
    const { data } = await supabase.from('jobs').select('*').eq('employee_id',user.id).eq('status','completed').gte('scheduled_date',month+'-01')
    const { data: empData } = await supabase.from('employees').select('score').eq('id',user.id).single()
    if (empData) setEmpScore(empData.score||100)
    if (!data) return
    const totalMins = data.reduce((s,j)=>{ if (!j.started_at||!j.completed_at) return s; return s+(new Date(j.completed_at)-new Date(j.started_at))/60000 },0)
    const spotEarned = data.filter(j=>j.job_category==='spot').reduce((s,j)=>s+Number(j.spot_value||0),0)
    const base = user.salary_type==='hourly'?(totalMins/60)*(user.hourly_rate||0):(user.fixed_salary||0)
    setSalaryData({ jobs:data.length, hours:(totalMins/60).toFixed(1), base:Math.round(base), spotEarned, total:Math.round(base)+spotEarned })
  }

  const loadHistory = async () => {
    const { data } = await supabase.from('jobs').select('*').eq('employee_id',user.id).eq('status','completed').order('scheduled_date',{ascending:false}).limit(30)
    setHistory(data||[])
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
    await supabase.from('jobs').update({ spot_status:'accepted', status:'assigned', spot_responded_at:new Date().toISOString() }).eq('id',job.id)
    toast.success(`Accepted! +¥${Number(job.spot_value||0).toLocaleString()}`)
    loadJobs()
  }

  const handleDeclineSpot = async (job) => {
    await supabase.from('jobs').update({ spot_status:'declined', status:'cancelled', spot_responded_at:new Date().toISOString() }).eq('id',job.id)
    toast('Declined.'); loadJobs()
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
    const { data, error } = await supabase.from('jobs').update({ status:'in_progress', started_at:new Date().toISOString(), photo_start_url:photoUrl }).eq('id',job.id).select().single()
    if (error) { toast.error(error.message); setSubmitting(false); return }
    const cl = job.checklist_template ? job.checklist_template.split('\n').filter(Boolean).map(l=>({label:l,done:false})) : []
    setChecklist(cl); setActiveJob(data)
    toast.success('Job started! Timer running.'); setSubmitting(false)
  }

  const handleComplete = async () => {
    if (activeJob.photo_required&&!photos.end) return toast.error('📷 Photo required to complete!')
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
    await supabase.from('jobs').update({ status:'completed', completed_at:new Date().toISOString(), notes_employee:notes, photo_end_url:photoUrl, checklist_template:JSON.stringify(checklist) }).eq('id',activeJob.id)
    clearInterval(timerRef.current)
    setActiveJob(null); setElapsed(0); setChecklist([]); setNotes('')
    setPhotos({start:null,end:null}); setPreviews({start:null,end:null})
    toast.success('🎉 Job completed!'); loadJobs(); loadSalary(); loadHistory(); setTab('home'); setSubmitting(false)
  }

  const fmt = s=>`${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`
  const scoreColor = s=>s>=90?'#4ade80':s>=70?'#fbbf24':'#f87171'
  const today = new Date().toISOString().split('T')[0]
  const todayJobs = jobs.filter(j=>j.scheduled_date===today)
  const upcomingJobs = jobs.filter(j=>j.scheduled_date>today)

  const PhotoSlot = ({ slot, label, required }) => (
    <div>
      <input type="file" accept="image/*" capture="environment" ref={slot==='start'?startRef:endRef} style={{display:'none'}}
        onChange={e=>{const f=e.target.files[0];if(f){setPhotos(p=>({...p,[slot]:f}));setPreviews(p=>({...p,[slot]:URL.createObjectURL(f)}))}}} />
      <div onClick={()=>(slot==='start'?startRef:endRef).current.click()}
        style={{width:'100%',aspectRatio:'4/3',borderRadius:16,overflow:'hidden',cursor:'pointer',
          border:previews[slot]?'none':'2px dashed rgba(255,255,255,0.15)',
          background:previews[slot]?'none':'rgba(255,255,255,0.03)',
          display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:10,
          color:'rgba(255,255,255,0.4)',fontSize:14,transition:'all 0.2s'}}>
        {previews[slot]
          ? <img src={previews[slot]} style={{width:'100%',height:'100%',objectFit:'cover'}} />
          : <><span style={{fontSize:40}}>📷</span><span style={{fontSize:14,fontWeight:500}}>{label}{required?' *':''}</span><span style={{fontSize:12,opacity:0.6}}>Tap to take photo</span></>}
      </div>
      {previews[slot]&&<div style={{fontSize:12,color:'#4ade80',textAlign:'center',marginTop:6,fontWeight:500}}>✓ Photo ready</div>}
    </div>
  )

  const menuItems = [
    { key:'home', icon:'🏠', label:'Home' },
    { key:'jobs', icon:'📋', label:'My Jobs' },
    { key:'spots', icon:'⚡', label:'Spot Jobs', badge: spotJobs.length },
    { key:'salary', icon:'💴', label:'Salary' },
    { key:'calendar', icon:'📅', label:'Calendar' },
  ]

  return (
    <div style={{minHeight:'100vh',background:'#080f1a',display:'flex',flexDirection:'column',maxWidth:430,margin:'0 auto',fontFamily:'-apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif',position:'relative',overflow:'hidden'}}>

      {/* Gradient bg */}
      <div style={{position:'fixed',top:-100,left:-100,width:300,height:300,background:'radial-gradient(circle,rgba(193,156,86,0.15) 0%,transparent 70%)',pointerEvents:'none',zIndex:0}} />
      <div style={{position:'fixed',bottom:-50,right:-50,width:200,height:200,background:'radial-gradient(circle,rgba(74,222,128,0.08) 0%,transparent 70%)',pointerEvents:'none',zIndex:0}} />

      {/* Header */}
      <div style={{position:'relative',zIndex:10,background:'rgba(13,33,55,0.95)',backdropFilter:'blur(20px)',borderBottom:'1px solid rgba(255,255,255,0.06)',padding:'20px 18px 16px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:4}}>
          <div>
            <div style={{fontSize:22,fontWeight:700,color:'#fff',letterSpacing:-0.5}}>{user.name.split(' ')[0]}</div>
            <div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginTop:2}}>
              {clock.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})}
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            {/* Score badge */}
            <div style={{background:`rgba(${empScore>=90?'74,222,128':empScore>=70?'251,191,36':'248,113,113'},0.15)`,border:`1px solid rgba(${empScore>=90?'74,222,128':empScore>=70?'251,191,36':'248,113,113'},0.3)`,borderRadius:12,padding:'6px 12px',textAlign:'center'}}>
              <div style={{fontSize:18,fontWeight:700,color:scoreColor(empScore)}}>{empScore}</div>
              <div style={{fontSize:9,color:'rgba(255,255,255,0.4)',textTransform:'uppercase',letterSpacing:0.5}}>Score</div>
            </div>
            {/* 3-dot menu */}
            <button onClick={()=>setMenuOpen(!menuOpen)} style={{width:36,height:36,borderRadius:10,background:'rgba(255,255,255,0.08)',border:'1px solid rgba(255,255,255,0.1)',color:'#fff',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3}}>
              {[0,1,2].map(i=><div key={i} style={{width:4,height:4,borderRadius:'50%',background:'rgba(255,255,255,0.7)'}} />)}
            </button>
          </div>
        </div>

        {/* Clock */}
        <div style={{fontSize:40,fontWeight:700,color:'#fff',fontFamily:'monospace',letterSpacing:-1,lineHeight:1,marginTop:8}}>
          {clock.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}
          <span style={{fontSize:20,color:'rgba(255,255,255,0.4)',marginLeft:4}}>{clock.toLocaleTimeString('ja-JP',{second:'2-digit'}).slice(-2)}</span>
        </div>

        {/* GPS + active timer */}
        <div style={{display:'flex',gap:8,marginTop:10,flexWrap:'wrap'}}>
          {gpsStatus&&<div style={{background:'rgba(255,255,255,0.06)',borderRadius:8,padding:'5px 10px',fontSize:11,color:gpsStatus.includes('✓')?'#4ade80':'rgba(255,255,255,0.5)'}}>📍 {gpsStatus}</div>}
          {activeJob&&<div style={{background:'rgba(74,222,128,0.12)',border:'1px solid rgba(74,222,128,0.3)',borderRadius:8,padding:'5px 12px',fontSize:13,color:'#4ade80',fontWeight:700,fontFamily:'monospace'}}>▶ {fmt(elapsed)}</div>}
          {spotJobs.length>0&&<div onClick={()=>setTab('spots')} style={{background:'rgba(193,156,86,0.15)',border:'1px solid rgba(193,156,86,0.3)',borderRadius:8,padding:'5px 10px',fontSize:11,color:'#c19c56',cursor:'pointer',fontWeight:600}}>⚡ {spotJobs.length} spot{spotJobs.length>1?'s':''}</div>}
        </div>
      </div>

      {/* Dropdown menu */}
      {menuOpen&&(
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,zIndex:100}} onClick={()=>setMenuOpen(false)}>
          <div style={{position:'absolute',top:140,right:14,background:'#0d2137',border:'1px solid rgba(255,255,255,0.1)',borderRadius:16,overflow:'hidden',minWidth:180,boxShadow:'0 20px 60px rgba(0,0,0,0.5)'}} onClick={e=>e.stopPropagation()}>
            {menuItems.map(item=>(
              <button key={item.key} onClick={()=>{setTab(item.key);setMenuOpen(false)}} style={{width:'100%',padding:'14px 18px',border:'none',background:tab===item.key?'rgba(193,156,86,0.15)':'none',color:tab===item.key?'#c19c56':'rgba(255,255,255,0.8)',fontSize:14,fontWeight:tab===item.key?600:400,cursor:'pointer',display:'flex',alignItems:'center',gap:12,borderBottom:'1px solid rgba(255,255,255,0.05)',textAlign:'left'}}>
                <span style={{fontSize:18}}>{item.icon}</span>
                {item.label}
                {item.badge>0&&<span style={{marginLeft:'auto',background:'#c19c56',color:'#0a1929',borderRadius:20,padding:'2px 8px',fontSize:11,fontWeight:700}}>{item.badge}</span>}
              </button>
            ))}
            <button onClick={logout} style={{width:'100%',padding:'14px 18px',border:'none',background:'none',color:'#f87171',fontSize:14,cursor:'pointer',display:'flex',alignItems:'center',gap:12,textAlign:'left'}}>
              <span style={{fontSize:18}}>🚪</span> Logout
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div style={{flex:1,padding:'16px 14px 30px',overflowY:'auto',position:'relative',zIndex:1}}>

        {/* ===== HOME DASHBOARD ===== */}
        {tab==='home'&&(
          <div>
            {/* Active job card */}
            {activeJob&&(
              <div onClick={()=>setTab('jobs')} style={{background:'linear-gradient(135deg,rgba(74,222,128,0.15),rgba(74,222,128,0.05))',border:'1px solid rgba(74,222,128,0.3)',borderRadius:20,padding:18,marginBottom:14,cursor:'pointer'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <div style={{fontSize:11,color:'#4ade80',fontWeight:700,letterSpacing:1,textTransform:'uppercase'}}>● In Progress</div>
                  <div style={{fontSize:22,fontWeight:700,color:'#4ade80',fontFamily:'monospace'}}>{fmt(elapsed)}</div>
                </div>
                <div style={{fontSize:17,fontWeight:700,color:'#fff'}}>{activeJob.title}</div>
                <div style={{fontSize:12,color:'rgba(255,255,255,0.5)',marginTop:4}}>📍 {activeJob.address}</div>
                <div style={{fontSize:12,color:'#4ade80',marginTop:8,fontWeight:500}}>Tap to continue →</div>
              </div>
            )}

            {/* Today's jobs */}
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',letterSpacing:1,textTransform:'uppercase',marginBottom:10}}>Today's Jobs</div>
              {todayJobs.length===0&&!activeJob&&<div style={{background:'rgba(255,255,255,0.03)',borderRadius:14,padding:'20px',textAlign:'center',color:'rgba(255,255,255,0.3)',fontSize:13}}>No jobs scheduled today</div>}
              {todayJobs.filter(j=>j.status==='assigned').map(j=>(
                <div key={j.id} style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:16,padding:'14px',marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div>
                    <div style={{fontSize:14,fontWeight:600,color:'#fff'}}>{j.title}</div>
                    <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',marginTop:2}}>{j.scheduled_time||'—'} · {j.client_name}</div>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6}}>
                    <div style={{fontSize:14,fontWeight:700,color:'#c19c56'}}>¥{Number(j.spot_value||j.value||0).toLocaleString()}</div>
                    <button onClick={()=>handleStart(j)} disabled={submitting||!!activeJob} style={{padding:'6px 14px',borderRadius:8,border:'none',background:activeJob?'rgba(255,255,255,0.06)':'#0F6E56',color:activeJob?'rgba(255,255,255,0.3)':'#fff',fontSize:12,fontWeight:700,cursor:activeJob?'not-allowed':'pointer'}}>
                      {activeJob?'Busy':'▶ Start'}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Stats row */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:14}}>
              {[
                ['Jobs', salaryData?.jobs||0, '📋'],
                ['Hours', (salaryData?.hours||0)+'h', '⏱'],
                ['Earned', '¥'+(salaryData?.total||0).toLocaleString(), '💴'],
              ].map(([l,v,icon])=>(
                <div key={l} style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:14,padding:'12px 10px',textAlign:'center'}}>
                  <div style={{fontSize:18,marginBottom:4}}>{icon}</div>
                  <div style={{fontSize:16,fontWeight:700,color:'#fff'}}>{v}</div>
                  <div style={{fontSize:10,color:'rgba(255,255,255,0.4)',marginTop:2,textTransform:'uppercase',letterSpacing:0.5}}>{l}</div>
                </div>
              ))}
            </div>

            {/* Score bar */}
            <div style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:16,padding:16,marginBottom:14}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                <div style={{fontSize:13,fontWeight:600,color:'rgba(255,255,255,0.7)'}}>Performance Score</div>
                <div style={{fontSize:22,fontWeight:700,color:scoreColor(empScore)}}>{empScore}<span style={{fontSize:12,color:'rgba(255,255,255,0.3)'}}>/100</span></div>
              </div>
              <div style={{height:8,background:'rgba(255,255,255,0.08)',borderRadius:4,overflow:'hidden'}}>
                <div style={{height:'100%',width:empScore+'%',borderRadius:4,background:`linear-gradient(90deg,${scoreColor(empScore)},${scoreColor(empScore)}aa)`,transition:'width 0.6s'}} />
              </div>
              <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginTop:6}}>
                {empScore>=90?'🌟 Excellent performance':empScore>=70?'👍 Good standing':'⚠️ Needs improvement'}
              </div>
            </div>

            {/* Spot jobs */}
            {spotJobs.length>0&&(
              <div onClick={()=>setTab('spots')} style={{background:'rgba(193,156,86,0.1)',border:'1px solid rgba(193,156,86,0.25)',borderRadius:16,padding:16,cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:14,fontWeight:700,color:'#c19c56'}}>⚡ Spot Jobs Available</div>
                  <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',marginTop:2}}>{spotJobs.length} job{spotJobs.length>1?'s':''} waiting for your response</div>
                </div>
                <div style={{fontSize:22,color:'#c19c56'}}>→</div>
              </div>
            )}
          </div>
        )}

        {/* ===== JOBS ===== */}
        {tab==='jobs'&&(
          <div>
            {activeJob&&(
              <div style={{background:'rgba(13,33,55,0.9)',border:'1px solid rgba(74,222,128,0.3)',borderRadius:20,padding:18,marginBottom:16}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                  <div>
                    <div style={{fontSize:11,color:'#4ade80',fontWeight:700,letterSpacing:1}}>IN PROGRESS {activeJob.job_category==='spot'&&'⚡'}</div>
                    <div style={{fontSize:18,fontWeight:700,color:'#fff',marginTop:2}}>{activeJob.title}</div>
                    <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',marginTop:2}}>📍 {activeJob.address}</div>
                  </div>
                  <div style={{textAlign:'center'}}>
                    <div style={{fontSize:28,fontWeight:700,color:'#4ade80',fontFamily:'monospace'}}>{fmt(elapsed)}</div>
                  </div>
                </div>

                {checklist.length>0&&(
                  <div style={{marginBottom:14}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                      <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',letterSpacing:1,textTransform:'uppercase'}}>Checklist</div>
                      <div style={{fontSize:11,color:'#4ade80'}}>{checklist.filter(t=>t.done).length}/{checklist.length}</div>
                    </div>
                    <div style={{height:4,background:'rgba(255,255,255,0.08)',borderRadius:2,marginBottom:10,overflow:'hidden'}}>
                      <div style={{height:'100%',width:(checklist.length?checklist.filter(t=>t.done).length/checklist.length*100:0)+'%',background:'#4ade80',borderRadius:2,transition:'width 0.3s'}} />
                    </div>
                    {checklist.map((t,i)=>(
                      <div key={i} onClick={()=>setChecklist(c=>c.map((x,j)=>j===i?{...x,done:!x.done}:x))}
                        style={{display:'flex',alignItems:'center',gap:12,padding:'13px 0',borderBottom:'1px solid rgba(255,255,255,0.04)',cursor:'pointer',userSelect:'none'}}>
                        <div style={{width:24,height:24,borderRadius:7,border:'2px solid',flexShrink:0,borderColor:t.done?'#4ade80':'rgba(255,255,255,0.2)',background:t.done?'#4ade80':'transparent',display:'flex',alignItems:'center',justifyContent:'center',transition:'all 0.2s'}}>
                          {t.done&&<span style={{fontSize:14,color:'#080f1a',fontWeight:900}}>✓</span>}
                        </div>
                        <span style={{fontSize:15,color:t.done?'rgba(255,255,255,0.3)':'#fff',textDecoration:t.done?'line-through':'none',lineHeight:1.3,transition:'all 0.2s'}}>{t.label}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{marginBottom:14}}>
                  <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',letterSpacing:1,textTransform:'uppercase',marginBottom:8}}>Service Notes</div>
                  <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Describe what was done..." style={{width:'100%',padding:'12px',fontSize:14,borderRadius:12,border:'1px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'#fff',fontFamily:'inherit',boxSizing:'border-box',resize:'vertical',minHeight:80}} />
                </div>

                <div style={{marginBottom:16}}>
                  <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',letterSpacing:1,textTransform:'uppercase',marginBottom:10}}>
                    End Photo {activeJob.photo_required&&<span style={{color:'#f87171'}}>· REQUIRED</span>}
                  </div>
                  <PhotoSlot slot="end" label="End photo" required={activeJob.photo_required} />
                </div>

                <button onClick={handleComplete} disabled={submitting} style={{width:'100%',padding:'18px',borderRadius:16,border:'none',background:submitting?'rgba(255,255,255,0.1)':'linear-gradient(135deg,#c19c56,#e8c47a)',color:submitting?'rgba(255,255,255,0.3)':'#0a1929',fontSize:17,fontWeight:800,cursor:submitting?'not-allowed':'pointer',letterSpacing:0.5}}>
                  {submitting?'Saving...':'🏁 Complete Job'}
                </button>
              </div>
            )}

            {jobs.filter(j=>j.status==='assigned').map(j=>(
              <div key={j.id} style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:20,padding:16,marginBottom:12}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                  <div style={{flex:1,marginRight:12}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                      {j.job_category==='spot'&&<span style={{fontSize:10,background:'#c19c56',color:'#0a1929',padding:'2px 8px',borderRadius:20,fontWeight:800}}>SPOT</span>}
                      <span style={{fontSize:16,fontWeight:700,color:'#fff'}}>{j.title}</span>
                    </div>
                    <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',marginBottom:2}}>📅 {j.scheduled_date}{j.scheduled_time&&` · ${j.scheduled_time}`}</div>
                    <div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>📍 {j.address}</div>
                  </div>
                  <div style={{background:'rgba(193,156,86,0.12)',border:'1px solid rgba(193,156,86,0.2)',borderRadius:12,padding:'8px 12px',textAlign:'center',flexShrink:0}}>
                    <div style={{fontSize:15,fontWeight:700,color:'#c19c56'}}>¥{Number(j.spot_value||j.value||0).toLocaleString()}</div>
                  </div>
                </div>
                {j.description&&<div style={{fontSize:13,color:'rgba(255,255,255,0.5)',background:'rgba(255,255,255,0.03)',borderRadius:10,padding:'10px 12px',marginBottom:12,lineHeight:1.5}}>{j.description}</div>}
                {j.photo_required&&!activeJob&&(
                  <div style={{marginBottom:12}}>
                    <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:8}}>📷 Start photo</div>
                    <PhotoSlot slot="start" label="Start photo" required={false} />
                  </div>
                )}
                <button onClick={()=>handleStart(j)} disabled={submitting||!!activeJob}
                  style={{width:'100%',padding:'15px',borderRadius:14,border:'none',background:activeJob?'rgba(255,255,255,0.06)':'linear-gradient(135deg,#0F6E56,#16a37e)',color:activeJob?'rgba(255,255,255,0.3)':'#fff',fontSize:15,fontWeight:700,cursor:activeJob?'not-allowed':'pointer'}}>
                  {activeJob?'Finish active job first':'▶ Start Job'}
                </button>
              </div>
            ))}

            {!activeJob&&jobs.filter(j=>j.status==='assigned').length===0&&(
              <div style={{textAlign:'center',paddingTop:60}}>
                <div style={{fontSize:56,marginBottom:16}}>☀️</div>
                <div style={{fontSize:18,fontWeight:600,color:'rgba(255,255,255,0.6)'}}>All clear!</div>
                <div style={{fontSize:14,color:'rgba(255,255,255,0.3)',marginTop:6}}>No pending jobs</div>
              </div>
            )}
          </div>
        )}

        {/* ===== SPOTS ===== */}
        {tab==='spots'&&(
          <div>
            {spotJobs.length===0?(
              <div style={{textAlign:'center',paddingTop:60}}>
                <div style={{fontSize:48,marginBottom:16}}>⚡</div>
                <div style={{fontSize:16,color:'rgba(255,255,255,0.4)'}}>No spot jobs pending</div>
              </div>
            ):spotJobs.map(j=>(
              <div key={j.id} style={{background:'rgba(193,156,86,0.07)',border:'1px solid rgba(193,156,86,0.2)',borderRadius:20,padding:18,marginBottom:14}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
                  <div style={{flex:1,marginRight:12}}>
                    <div style={{fontSize:17,fontWeight:700,color:'#fff',marginBottom:4}}>{j.title}</div>
                    <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',marginBottom:2}}>📅 {j.scheduled_date}{j.scheduled_time&&` · ${j.scheduled_time}`}</div>
                    <div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>📍 {j.address}</div>
                  </div>
                  <div style={{background:'rgba(193,156,86,0.2)',border:'1px solid rgba(193,156,86,0.3)',borderRadius:14,padding:'10px 14px',textAlign:'center',flexShrink:0}}>
                    <div style={{fontSize:10,color:'#c19c56',fontWeight:700,letterSpacing:1}}>EXTRA</div>
                    <div style={{fontSize:22,fontWeight:800,color:'#c19c56'}}>+¥{Number(j.spot_value||0).toLocaleString()}</div>
                  </div>
                </div>
                {j.description&&<div style={{fontSize:13,color:'rgba(255,255,255,0.55)',background:'rgba(255,255,255,0.04)',borderRadius:10,padding:'10px 12px',marginBottom:14,lineHeight:1.5}}>{j.description}</div>}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                  <button onClick={()=>handleAcceptSpot(j)} style={{padding:'16px',borderRadius:14,border:'none',background:'linear-gradient(135deg,#0F6E56,#16a37e)',color:'#fff',fontSize:15,fontWeight:700,cursor:'pointer'}}>✅ Accept</button>
                  <button onClick={()=>handleDeclineSpot(j)} style={{padding:'16px',borderRadius:14,border:'1px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.6)',fontSize:15,fontWeight:700,cursor:'pointer'}}>✕ Decline</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ===== SALARY ===== */}
        {tab==='salary'&&(
          <div>
            <div style={{background:'linear-gradient(135deg,rgba(193,156,86,0.2),rgba(193,156,86,0.05))',border:'1px solid rgba(193,156,86,0.25)',borderRadius:24,padding:'28px 20px',textAlign:'center',marginBottom:18}}>
              <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',letterSpacing:2,textTransform:'uppercase',marginBottom:8}}>Estimated Salary</div>
              <div style={{fontSize:48,fontWeight:800,color:'#c19c56',letterSpacing:-2,lineHeight:1}}>¥{(salaryData?.total||0).toLocaleString()}</div>
              <div style={{fontSize:12,color:'rgba(255,255,255,0.3)',marginTop:8}}>{new Date().toLocaleString('en',{month:'long',year:'numeric'})} · confirmed by admin</div>
              {(salaryData?.spotEarned||0)>0&&<div style={{fontSize:13,color:'rgba(193,156,86,0.8)',marginTop:6,fontWeight:500}}>includes ¥{salaryData.spotEarned.toLocaleString()} from spot jobs ⚡</div>}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              {[['📋','Jobs Done',salaryData?.jobs||0],['⏱','Hours',salaryData?.hours||0+'h'],['💴','Base Pay','¥'+(salaryData?.base||0).toLocaleString()],['⚡','Spot Earned','¥'+(salaryData?.spotEarned||0).toLocaleString()]].map(([icon,l,v])=>(
                <div key={l} style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:16,padding:'16px 14px'}}>
                  <div style={{fontSize:22,marginBottom:8}}>{icon}</div>
                  <div style={{fontSize:20,fontWeight:700,color:'#fff'}}>{v}</div>
                  <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginTop:3,textTransform:'uppercase',letterSpacing:0.5}}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== CALENDAR ===== */}
        {tab==='calendar'&&(
          <div>
            <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',letterSpacing:1,textTransform:'uppercase',marginBottom:14}}>Work History</div>
            {history.length===0&&<div style={{textAlign:'center',paddingTop:60,color:'rgba(255,255,255,0.3)'}}>No completed jobs yet</div>}
            {(() => {
              const byDate = {}
              history.forEach(j=>{ const d=j.scheduled_date; if(!byDate[d]) byDate[d]=[]; byDate[d].push(j) })
              return Object.keys(byDate).sort((a,b)=>b.localeCompare(a)).map(date=>(
                <div key={date} style={{marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:600,color:'rgba(255,255,255,0.5)',marginBottom:8,display:'flex',alignItems:'center',gap:8}}>
                    <div style={{height:1,flex:1,background:'rgba(255,255,255,0.06)'}} />
                    {new Date(date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})}
                    <div style={{height:1,flex:1,background:'rgba(255,255,255,0.06)'}} />
                  </div>
                  {byDate[date].map(j=>(
                    <div key={j.id} style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:14,padding:'12px 14px',marginBottom:8}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                        <div style={{flex:1,marginRight:10}}>
                          <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                            {j.job_category==='spot'&&<span style={{fontSize:9,background:'#c19c56',color:'#0a1929',padding:'2px 6px',borderRadius:20,fontWeight:800}}>SPOT</span>}
                            <span style={{fontSize:14,fontWeight:600,color:'#fff'}}>{j.title}</span>
                          </div>
                          <div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>{j.client_name||'—'}</div>
                          {j.started_at&&j.completed_at&&<div style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginTop:3}}>⏱ {Math.round((new Date(j.completed_at)-new Date(j.started_at))/60000)} min</div>}
                        </div>
                        <div style={{textAlign:'right'}}>
                          <div style={{fontSize:14,fontWeight:700,color:'#c19c56'}}>¥{Number(j.spot_value||j.value||0).toLocaleString()}</div>
                          <div style={{fontSize:10,color:'#4ade80',marginTop:2}}>✓ done</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))
            })()}
          </div>
        )}
      </div>
    </div>
  )
}
