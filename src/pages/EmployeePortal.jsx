import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { distanceMeters, getCurrentPosition } from '../lib/geocode'
import toast from 'react-hot-toast'

export default function EmployeePortal() {
  const { user, logout } = useAuth()
  const [tab, setTab] = useState('jobs')
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
  const timerRef = useRef()
  const startRef = useRef()
  const endRef = useRef()

  useEffect(() => { loadJobs(); loadSalary(); loadHistory() }, [])

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
      .eq('employee_id', user.id)
      .in('status', ['assigned','in_progress'])
      .gte('scheduled_date', today)
      .order('scheduled_date')
    const regular = (data||[]).filter(j=>j.job_category!=='spot'||j.spot_status==='accepted')
    const spots = (data||[]).filter(j=>j.job_category==='spot'&&j.spot_status==='pending')
    setJobs(regular)
    setSpotJobs(spots)
    const inProgress = regular.find(j=>j.status==='in_progress')
    if (inProgress) {
      setActiveJob(inProgress)
      const cl = inProgress.checklist_template ? inProgress.checklist_template.split('\n').filter(Boolean).map(l=>({label:l,done:false})) : []
      setChecklist(cl)
    }
  }

  const loadSalary = async () => {
    const month = new Date().toISOString().slice(0,7)
    const { data } = await supabase.from('jobs').select('*')
      .eq('employee_id',user.id).eq('status','completed').gte('scheduled_date',month+'-01')
    if (!data) return
    const totalMins = data.reduce((s,j)=>{
      if (!j.started_at||!j.completed_at) return s
      return s+(new Date(j.completed_at)-new Date(j.started_at))/60000
    },0)
    const spotEarned = data.filter(j=>j.job_category==='spot').reduce((s,j)=>s+Number(j.spot_value||0),0)
    const base = user.salary_type==='hourly'?(totalMins/60)*(user.hourly_rate||0):(user.fixed_salary||0)
    setSalaryData({ jobs:data.length, hours:(totalMins/60).toFixed(1), base:Math.round(base), spotEarned, total:Math.round(base)+spotEarned })
  }

  const loadHistory = async () => {
    const { data } = await supabase.from('jobs').select('*')
      .eq('employee_id',user.id).eq('status','completed')
      .order('scheduled_date',{ascending:false}).limit(30)
    setHistory(data||[])
  }

  const checkGPS = async (job) => {
    if (!job.gps_lat||!job.gps_lng) return true
    setGpsStatus('Checking location...')
    try {
      const pos = await getCurrentPosition()
      const dist = distanceMeters(pos.lat,pos.lng,Number(job.gps_lat),Number(job.gps_lng))
      if (dist>100) { setGpsStatus(`Too far: ${Math.round(dist)}m`); toast.error(`${Math.round(dist)}m from location. Must be within 100m.`); return false }
      setGpsStatus(`✓ ${Math.round(dist)}m`)
      return true
    } catch { setGpsStatus('GPS unavailable'); return true }
  }

  const handleAcceptSpot = async (job) => {
    await supabase.from('jobs').update({ spot_status:'accepted', status:'assigned', spot_responded_at:new Date().toISOString() }).eq('id',job.id)
    toast.success(`Accepted! +¥${Number(job.spot_value||0).toLocaleString()} added to salary.`)
    loadJobs()
  }

  const handleDeclineSpot = async (job) => {
    await supabase.from('jobs').update({ spot_status:'declined', status:'cancelled', spot_responded_at:new Date().toISOString() }).eq('id',job.id)
    toast('Declined.')
    loadJobs()
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
    const { data, error } = await supabase.from('jobs').update({
      status:'in_progress', started_at:new Date().toISOString(), photo_start_url:photoUrl
    }).eq('id',job.id).select().single()
    if (error) { toast.error(error.message); setSubmitting(false); return }
    const cl = job.checklist_template ? job.checklist_template.split('\n').filter(Boolean).map(l=>({label:l,done:false})) : []
    setChecklist(cl); setActiveJob(data)
    toast.success('Started!')
    setSubmitting(false)
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
    await supabase.from('jobs').update({
      status:'completed', completed_at:new Date().toISOString(),
      notes_employee:notes, photo_end_url:photoUrl,
      checklist_template:JSON.stringify(checklist),
    }).eq('id',activeJob.id)
    clearInterval(timerRef.current)
    setActiveJob(null); setElapsed(0); setChecklist([]); setNotes('')
    setPhotos({start:null,end:null}); setPreviews({start:null,end:null})
    toast.success('Job completed! 🎉')
    loadJobs(); loadSalary(); loadHistory()
    setTab('jobs')
    setSubmitting(false)
  }

  const fmt = s=>`${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`

  const PhotoSlot = ({ slot, label, required }) => (
    <div>
      <input type="file" accept="image/*" capture="environment"
        ref={slot==='start'?startRef:endRef} style={{display:'none'}}
        onChange={e=>{const f=e.target.files[0];if(f){setPhotos(p=>({...p,[slot]:f}));setPreviews(p=>({...p,[slot]:URL.createObjectURL(f)}))}}} />
      <div onClick={()=>(slot==='start'?startRef:endRef).current.click()}
        style={{width:'100%',aspectRatio:'16/9',borderRadius:12,overflow:'hidden',cursor:'pointer',
          border:previews[slot]?'2px solid #4ade80':'2px dashed rgba(255,255,255,0.2)',
          background:'rgba(255,255,255,0.04)',display:'flex',flexDirection:'column',
          alignItems:'center',justifyContent:'center',gap:8,color:'rgba(255,255,255,0.5)',fontSize:14}}>
        {previews[slot]
          ? <img src={previews[slot]} style={{width:'100%',height:'100%',objectFit:'cover'}} />
          : <><span style={{fontSize:36}}>📷</span><span>{label}{required?' (required)':''}</span></>}
      </div>
      {previews[slot]&&<div style={{fontSize:12,color:'#4ade80',textAlign:'center',marginTop:4}}>✓ Photo added</div>}
    </div>
  )

  // Shared styles
  const card = { background:'rgba(255,255,255,0.06)', borderRadius:16, padding:16, marginBottom:12 }
  const TA = { width:'100%', padding:'12px', fontSize:14, borderRadius:10, border:'1px solid rgba(255,255,255,0.15)', background:'rgba(255,255,255,0.07)', color:'#fff', fontFamily:'inherit', boxSizing:'border-box', resize:'vertical', minHeight:80 }
  const Btn = ({ children, onClick, disabled, color='#0F6E56', textColor='#fff' }) => (
    <button onClick={onClick} disabled={disabled} style={{width:'100%',padding:'16px',borderRadius:14,border:'none',background:disabled?'rgba(255,255,255,0.1)':color,color:disabled?'rgba(255,255,255,0.3)':textColor,fontSize:16,fontWeight:700,cursor:disabled?'not-allowed':'pointer',transition:'opacity 0.2s'}}>
      {children}
    </button>
  )

  const now = new Date()
  const timeStr = now.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})
  const dateStr = now.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})

  return (
    <div style={{minHeight:'100vh',background:'#0a1929',display:'flex',flexDirection:'column',maxWidth:430,margin:'0 auto',position:'relative'}}>

      {/* Header */}
      <div style={{background:'#0d2137',padding:'16px 18px 12px',borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
          <div>
            <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',letterSpacing:1,textTransform:'uppercase'}}>KuriPuro by JBM</div>
            <div style={{fontSize:20,fontWeight:700,color:'#fff',marginTop:2}}>{user.name.split(' ')[0]}</div>
            <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',marginTop:1}}>{timeStr} · {dateStr}</div>
          </div>
          <button onClick={logout} style={{background:'rgba(255,255,255,0.08)',border:'1px solid rgba(255,255,255,0.1)',color:'rgba(255,255,255,0.6)',padding:'8px 14px',borderRadius:10,cursor:'pointer',fontSize:13}}>
            Logout
          </button>
        </div>

        {/* GPS status */}
        {gpsStatus && (
          <div style={{marginTop:8,background:'rgba(255,255,255,0.05)',borderRadius:8,padding:'6px 10px',fontSize:12,color:gpsStatus.includes('✓')?'#4ade80':'rgba(255,255,255,0.5)'}}>
            📍 {gpsStatus}
          </div>
        )}

        {/* Active job timer banner */}
        {activeJob && (
          <div style={{marginTop:10,background:'rgba(74,222,128,0.1)',border:'1px solid rgba(74,222,128,0.3)',borderRadius:10,padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <div style={{fontSize:11,color:'#4ade80',fontWeight:600}}>IN PROGRESS</div>
              <div style={{fontSize:13,color:'#fff',fontWeight:500,marginTop:1}}>{activeJob.title}</div>
            </div>
            <div style={{fontSize:24,fontWeight:700,color:'#4ade80',fontFamily:'monospace'}}>{fmt(elapsed)}</div>
          </div>
        )}

        {/* Spot badge */}
        {spotJobs.length>0 && (
          <div onClick={()=>setTab('spots')} style={{marginTop:8,background:'rgba(193,156,86,0.15)',border:'1px solid rgba(193,156,86,0.4)',borderRadius:10,padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}}>
            <div style={{fontSize:13,color:'#c19c56',fontWeight:600}}>⚡ {spotJobs.length} spot job{spotJobs.length>1?'s':''} waiting</div>
            <div style={{fontSize:12,color:'#c19c56'}}>Tap to view →</div>
          </div>
        )}
      </div>

      {/* Tab bar */}
      <div style={{display:'flex',background:'#0d2137',borderBottom:'1px solid rgba(255,255,255,0.06)',position:'sticky',top:0,zIndex:10}}>
        {[['jobs','Jobs'],['spots',`⚡${spotJobs.length>0?` ${spotJobs.length}`:''}`],['salary','Salary'],['history','History']].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:'12px 4px',border:'none',background:'none',color:tab===k?'#c19c56':'rgba(255,255,255,0.35)',fontSize:12,fontWeight:tab===k?700:400,borderBottom:tab===k?'2px solid #c19c56':'2px solid transparent',cursor:'pointer',transition:'color 0.15s'}}>
            {l}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{flex:1,padding:'16px 14px 100px',overflowY:'auto'}}>

        {/* ===== JOBS ===== */}
        {tab==='jobs' && <>
          {activeJob && (
            <div>
              {/* Checklist */}
              {checklist.length>0 && (
                <div style={card}>
                  <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',letterSpacing:1,textTransform:'uppercase',marginBottom:10}}>Checklist — {checklist.filter(t=>t.done).length}/{checklist.length}</div>
                  <div style={{height:4,background:'rgba(255,255,255,0.1)',borderRadius:2,marginBottom:12,overflow:'hidden'}}>
                    <div style={{height:'100%',width:(checklist.filter(t=>t.done).length/checklist.length*100)+'%',background:'#4ade80',borderRadius:2,transition:'width 0.3s'}} />
                  </div>
                  {checklist.map((t,i)=>(
                    <div key={i} onClick={()=>setChecklist(c=>c.map((x,j)=>j===i?{...x,done:!x.done}:x))}
                      style={{display:'flex',alignItems:'center',gap:12,padding:'12px 0',borderBottom:'1px solid rgba(255,255,255,0.05)',cursor:'pointer',userSelect:'none'}}>
                      <div style={{width:24,height:24,borderRadius:6,border:'2px solid',flexShrink:0,
                        borderColor:t.done?'#4ade80':'rgba(255,255,255,0.25)',
                        background:t.done?'#4ade80':'transparent',
                        display:'flex',alignItems:'center',justifyContent:'center'}}>
                        {t.done&&<span style={{fontSize:14,color:'#0a1929',fontWeight:900}}>✓</span>}
                      </div>
                      <span style={{fontSize:15,color:t.done?'rgba(255,255,255,0.35)':'#fff',textDecoration:t.done?'line-through':'none',lineHeight:1.3}}>{t.label}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Notes */}
              <div style={card}>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',letterSpacing:1,textTransform:'uppercase',marginBottom:8}}>Service Notes</div>
                <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Describe what was done..." style={TA} />
              </div>

              {/* End photo */}
              <div style={card}>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',letterSpacing:1,textTransform:'uppercase',marginBottom:10}}>
                  End Photo {activeJob.photo_required&&<span style={{color:'#f87171'}}>— REQUIRED</span>}
                </div>
                <PhotoSlot slot="end" label="Take end photo" required={activeJob.photo_required} />
              </div>

              <Btn onClick={handleComplete} disabled={submitting} color='#c19c56' textColor='#0a1929'>
                {submitting?'Saving...':'🏁 Complete Job'}
              </Btn>
            </div>
          )}

          {!activeJob && jobs.filter(j=>j.status==='assigned').length===0 && (
            <div style={{textAlign:'center',paddingTop:60}}>
              <div style={{fontSize:56,marginBottom:16}}>☀️</div>
              <div style={{fontSize:18,fontWeight:600,color:'#fff',marginBottom:8}}>No jobs today</div>
              <div style={{fontSize:14,color:'rgba(255,255,255,0.4)'}}>Check back later or look for spot jobs</div>
            </div>
          )}

          {jobs.filter(j=>j.status==='assigned').map(j=>(
            <div key={j.id} style={{...card, border:'1px solid rgba(255,255,255,0.08)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                <div style={{flex:1,marginRight:12}}>
                  <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                    {j.job_category==='spot'&&<span style={{fontSize:10,background:'#c19c56',color:'#0a1929',padding:'2px 7px',borderRadius:20,fontWeight:700}}>SPOT</span>}
                    <span style={{fontSize:16,fontWeight:700,color:'#fff'}}>{j.title}</span>
                  </div>
                  <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',marginBottom:2}}>📅 {j.scheduled_date} {j.scheduled_time&&`· ${j.scheduled_time}`}</div>
                  <div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>📍 {j.address}</div>
                </div>
                <div style={{background:'rgba(193,156,86,0.15)',borderRadius:10,padding:'8px 12px',textAlign:'center',flexShrink:0}}>
                  <div style={{fontSize:16,fontWeight:700,color:'#c19c56'}}>¥{Number(j.spot_value||j.value||0).toLocaleString()}</div>
                </div>
              </div>
              {j.description&&<div style={{fontSize:13,color:'rgba(255,255,255,0.55)',background:'rgba(255,255,255,0.04)',borderRadius:8,padding:'10px',marginBottom:12,lineHeight:1.5}}>{j.description}</div>}
              {j.photo_required&&!activeJob&&(
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginBottom:8}}>📷 Start photo required</div>
                  <PhotoSlot slot="start" label="Take start photo" required={false} />
                </div>
              )}
              <Btn onClick={()=>handleStart(j)} disabled={submitting||!!activeJob} color='#0F6E56'>
                {activeJob?'Finish active job first':'▶ Start Job'}
              </Btn>
            </div>
          ))}
        </>}

        {/* ===== SPOTS ===== */}
        {tab==='spots' && (
          <div>
            {spotJobs.length===0 ? (
              <div style={{textAlign:'center',paddingTop:60}}>
                <div style={{fontSize:48,marginBottom:16}}>⚡</div>
                <div style={{fontSize:16,fontWeight:600,color:'rgba(255,255,255,0.6)'}}>No spot jobs pending</div>
              </div>
            ) : spotJobs.map(j=>(
              <div key={j.id} style={{background:'rgba(193,156,86,0.08)',border:'1px solid rgba(193,156,86,0.25)',borderRadius:16,padding:16,marginBottom:14}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                  <div style={{flex:1,marginRight:12}}>
                    <div style={{fontSize:17,fontWeight:700,color:'#fff',marginBottom:4}}>{j.title}</div>
                    <div style={{fontSize:12,color:'rgba(255,255,255,0.45)',marginBottom:2}}>📅 {j.scheduled_date} {j.scheduled_time&&`· ${j.scheduled_time}`}</div>
                    <div style={{fontSize:12,color:'rgba(255,255,255,0.45)'}}>📍 {j.address}</div>
                  </div>
                  <div style={{background:'rgba(193,156,86,0.2)',borderRadius:12,padding:'10px 14px',textAlign:'center',flexShrink:0}}>
                    <div style={{fontSize:10,color:'#c19c56',fontWeight:600}}>EXTRA</div>
                    <div style={{fontSize:20,fontWeight:700,color:'#c19c56'}}>+¥{Number(j.spot_value||0).toLocaleString()}</div>
                  </div>
                </div>
                {j.description&&<div style={{fontSize:13,color:'rgba(255,255,255,0.55)',background:'rgba(255,255,255,0.04)',borderRadius:8,padding:'10px',marginBottom:14,lineHeight:1.5}}>{j.description}</div>}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                  <button onClick={()=>handleAcceptSpot(j)} style={{padding:'15px',borderRadius:12,border:'none',background:'#0F6E56',color:'#fff',fontSize:15,fontWeight:700,cursor:'pointer'}}>
                    ✅ Accept
                  </button>
                  <button onClick={()=>handleDeclineSpot(j)} style={{padding:'15px',borderRadius:12,border:'none',background:'rgba(255,255,255,0.08)',color:'rgba(255,255,255,0.6)',fontSize:15,fontWeight:700,cursor:'pointer'}}>
                    ✕ Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ===== SALARY ===== */}
        {tab==='salary' && (
          <div>
            <div style={{fontSize:13,color:'rgba(255,255,255,0.4)',marginBottom:16,textAlign:'center'}}>
              {new Date().toLocaleString('en',{month:'long',year:'numeric'})}
            </div>
            {salaryData ? (
              <>
                <div style={{background:'linear-gradient(135deg,rgba(193,156,86,0.2),rgba(193,156,86,0.05))',border:'1px solid rgba(193,156,86,0.3)',borderRadius:20,padding:'24px 20px',textAlign:'center',marginBottom:16}}>
                  <div style={{fontSize:12,color:'rgba(255,255,255,0.5)',letterSpacing:1,textTransform:'uppercase',marginBottom:6}}>Estimated Total</div>
                  <div style={{fontSize:42,fontWeight:700,color:'#c19c56',lineHeight:1}}>¥{salaryData.total.toLocaleString()}</div>
                  {salaryData.spotEarned>0&&<div style={{fontSize:13,color:'rgba(255,255,255,0.5)',marginTop:8}}>includes ¥{salaryData.spotEarned.toLocaleString()} from spot jobs</div>}
                  <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginTop:6}}>* confirmed by admin</div>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:16}}>
                  {[['Jobs done',salaryData.jobs,'📋'],['Hours worked',salaryData.hours+'h','⏱'],['Base pay','¥'+salaryData.base.toLocaleString(),'💴'],['Spot earned','¥'+salaryData.spotEarned.toLocaleString(),'⚡']].map(([l,v,icon])=>(
                    <div key={l} style={{background:'rgba(255,255,255,0.05)',borderRadius:14,padding:'14px 12px'}}>
                      <div style={{fontSize:20,marginBottom:4}}>{icon}</div>
                      <div style={{fontSize:18,fontWeight:700,color:'#fff'}}>{v}</div>
                      <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginTop:2}}>{l}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : <div style={{textAlign:'center',color:'rgba(255,255,255,0.4)',paddingTop:40}}>Loading...</div>}
          </div>
        )}

        {/* ===== HISTORY ===== */}
        {tab==='history' && (
          <div>
            {history.length===0&&<div style={{textAlign:'center',paddingTop:60,color:'rgba(255,255,255,0.4)'}}>No completed jobs yet</div>}
            {history.map(j=>(
              <div key={j.id} style={{...card,border:'1px solid rgba(255,255,255,0.06)'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
                  <div style={{flex:1,marginRight:10}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
                      {j.job_category==='spot'&&<span style={{fontSize:10,background:'#c19c56',color:'#0a1929',padding:'2px 6px',borderRadius:20,fontWeight:700}}>SPOT</span>}
                      <span style={{fontSize:14,fontWeight:600,color:'#fff'}}>{j.title}</span>
                    </div>
                    <div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>{j.scheduled_date} · {j.client_name||'—'}</div>
                    {j.started_at&&j.completed_at&&<div style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginTop:2}}>
                      ⏱ {Math.round((new Date(j.completed_at)-new Date(j.started_at))/60000)} min
                    </div>}
                  </div>
                  <div style={{fontSize:15,fontWeight:700,color:'#c19c56',flexShrink:0}}>
                    ¥{Number(j.spot_value||j.value||0).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
