import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { distanceMeters, getCurrentPosition } from '../lib/geocode'
import toast from 'react-hot-toast'

const ROUTES = ['Subway — Hibiya Line','Bus — Line 21','Own bicycle','Walking','Train — JR Yamanote','Other']

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
    const regular = (data||[]).filter(j=>j.job_category!=='spot' || j.spot_status==='accepted')
    const spots = (data||[]).filter(j=>j.job_category==='spot' && j.spot_status==='pending')
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
      .eq('employee_id', user.id).eq('status','completed').gte('scheduled_date',month+'-01')
    if (!data) return
    const totalMins = data.reduce((s,j)=>{
      if (!j.started_at||!j.completed_at) return s
      return s+(new Date(j.completed_at)-new Date(j.started_at))/60000
    },0)
    const spotEarned = data.filter(j=>j.job_category==='spot').reduce((s,j)=>s+Number(j.spot_value||0),0)
    const base = user.salary_type==='hourly' ? (totalMins/60)*(user.hourly_rate||0) : (user.fixed_salary||0)
    setSalaryData({ jobs:data.length, hours:(totalMins/60).toFixed(1), base:Math.round(base), spotEarned, total:Math.round(base)+spotEarned, reports:data })
  }

  const loadHistory = async () => {
    const { data } = await supabase.from('jobs').select('*')
      .eq('employee_id',user.id).eq('status','completed')
      .order('scheduled_date',{ascending:false}).limit(20)
    setHistory(data||[])
  }

  const checkGPS = async (job) => {
    if (!job.gps_lat||!job.gps_lng) return true
    setGpsStatus('Checking location...')
    try {
      const pos = await getCurrentPosition()
      const dist = distanceMeters(pos.lat,pos.lng,Number(job.gps_lat),Number(job.gps_lng))
      if (dist>100) { setGpsStatus(`Too far: ${Math.round(dist)}m (max 100m)`); toast.error(`${Math.round(dist)}m from location`); return false }
      setGpsStatus(`✓ ${Math.round(dist)}m away`)
      return true
    } catch { setGpsStatus('GPS unavailable'); return true }
  }

  const handleAcceptSpot = async (job) => {
    await supabase.from('jobs').update({ spot_status:'accepted', status:'assigned' }).eq('id',job.id)
    toast.success(`Spot job accepted! +¥${Number(job.spot_value||0).toLocaleString()} will be added to your salary.`)
    loadJobs()
  }

  const handleDeclineSpot = async (job) => {
    await supabase.from('jobs').update({ spot_status:'declined', status:'cancelled', spot_responded_at:new Date().toISOString() }).eq('id',job.id)
    toast('Spot job declined.')
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
    toast.success('Job started!')
    setSubmitting(false)
  }

  const handleComplete = async () => {
    if (activeJob.photo_required && !photos.end) return toast.error('Photo required!')
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
    setSubmitting(false)
  }

  const fmt = s => `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`
  const IS = { width:'100%', padding:'9px 11px', fontSize:13, borderRadius:8, border:'1px solid rgba(255,255,255,0.15)', background:'rgba(255,255,255,0.07)', color:'#fff', fontFamily:'inherit', boxSizing:'border-box' }

  const PhotoSlot = ({ slot, label, required }) => (
    <div>
      <input type="file" accept="image/*" capture="environment" ref={slot==='start'?startRef:endRef} style={{display:'none'}}
        onChange={e=>{const f=e.target.files[0];if(f){setPhotos(p=>({...p,[slot]:f}));setPreviews(p=>({...p,[slot]:URL.createObjectURL(f)}))}}} />
      <div onClick={()=>(slot==='start'?startRef:endRef).current.click()} style={{aspectRatio:'1',borderRadius:10,overflow:'hidden',cursor:'pointer',border:previews[slot]?'2px solid #4ade80':'2px dashed rgba(255,255,255,0.2)',background:'rgba(255,255,255,0.04)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,color:'rgba(255,255,255,0.4)',fontSize:12}}>
        {previews[slot]?<img src={previews[slot]} style={{width:'100%',height:'100%',objectFit:'cover'}} />:<><span style={{fontSize:28}}>📷</span><span>{label}{required?' *':''}</span></>}
      </div>
    </div>
  )

  return (
    <div style={{minHeight:'100vh',background:'#0d2137',display:'flex',flexDirection:'column'}}>
      <div style={{padding:'14px 18px',display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:'1px solid rgba(255,255,255,0.08)'}}>
        <div><div style={{fontSize:15,fontWeight:700,color:'#c19c56'}}>KuriPuro</div><div style={{fontSize:11,color:'rgba(255,255,255,0.45)'}}>{user.name}</div></div>
        <button onClick={logout} style={{background:'rgba(255,255,255,0.1)',border:'none',color:'#fff',padding:'7px 14px',borderRadius:8,cursor:'pointer',fontSize:13,fontWeight:600}}>Logout</button>
      </div>

      <div style={{display:'flex',borderBottom:'1px solid rgba(255,255,255,0.08)'}}>
        {[['jobs','📋 Jobs'],['spots','⚡ Spots'+(spotJobs.length>0?` (${spotJobs.length})`:'')],['salary','💴 Salary'],['history','📅 History']].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:'10px 0',border:'none',background:'none',color:tab===k?'#c19c56':'rgba(255,255,255,0.4)',fontSize:12,fontWeight:tab===k?600:400,borderBottom:tab===k?'2px solid #c19c56':'2px solid transparent',cursor:'pointer'}}>{l}</button>
        ))}
      </div>

      <div style={{flex:1,padding:18,maxWidth:480,margin:'0 auto',width:'100%',overflowY:'auto'}}>

        {/* SPOTS TAB */}
        {tab==='spots' && (
          <div>
            <div style={{fontSize:13,color:'rgba(255,255,255,0.5)',marginBottom:14}}>Extra jobs offered by admin. Accept to add them to your schedule.</div>
            {spotJobs.length===0 && <div style={{textAlign:'center',paddingTop:40,color:'rgba(255,255,255,0.3)'}}><div style={{fontSize:36}}>⚡</div><div style={{marginTop:8}}>No spot jobs pending</div></div>}
            {spotJobs.map(j=>(
              <div key={j.id} style={{background:'rgba(193,156,86,0.1)',border:'1px solid rgba(193,156,86,0.3)',borderRadius:12,padding:'16px',marginBottom:12}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                  <div style={{fontSize:16,fontWeight:700,color:'#fff'}}>{j.title}</div>
                  <div style={{fontSize:18,fontWeight:700,color:'#c19c56'}}>+¥{Number(j.spot_value||0).toLocaleString()}</div>
                </div>
                <div style={{fontSize:12,color:'rgba(255,255,255,0.5)',marginBottom:4}}>📅 {j.scheduled_date} {j.scheduled_time}</div>
                <div style={{fontSize:12,color:'rgba(255,255,255,0.5)',marginBottom:8}}>📍 {j.address}</div>
                {j.description && <div style={{fontSize:12,color:'rgba(255,255,255,0.6)',background:'rgba(255,255,255,0.05)',borderRadius:6,padding:'8px',marginBottom:12}}>{j.description}</div>}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                  <button onClick={()=>handleAcceptSpot(j)} style={{padding:'12px',borderRadius:10,border:'none',background:'#0F6E56',color:'#fff',fontSize:14,fontWeight:700,cursor:'pointer'}}>✅ Accept</button>
                  <button onClick={()=>handleDeclineSpot(j)} style={{padding:'12px',borderRadius:10,border:'none',background:'rgba(163,45,45,0.6)',color:'#fff',fontSize:14,fontWeight:700,cursor:'pointer'}}>❌ Decline</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* JOBS TAB */}
        {tab==='jobs' && (
          <>
            {gpsStatus && <div style={{background:'rgba(255,255,255,0.06)',borderRadius:8,padding:'8px 12px',fontSize:12,color:'rgba(255,255,255,0.6)',marginBottom:12}}>{gpsStatus}</div>}

            {activeJob && (
              <div style={{marginBottom:16}}>
                <div style={{background:'rgba(193,156,86,0.15)',border:'1px solid rgba(193,156,86,0.4)',borderRadius:12,padding:'14px 16px',marginBottom:14}}>
                  <div style={{fontSize:11,color:'rgba(255,255,255,0.5)',marginBottom:2}}>IN PROGRESS {activeJob.job_category==='spot'&&<span style={{color:'#c19c56'}}>⚡ SPOT</span>}</div>
                  <div style={{fontSize:18,fontWeight:700,color:'#fff'}}>{activeJob.title}</div>
                  <div style={{fontSize:12,color:'rgba(255,255,255,0.5)',marginTop:2}}>{activeJob.address}</div>
                  <div style={{fontSize:28,fontWeight:700,color:'#4ade80',marginTop:10,fontFamily:'monospace'}}>{fmt(elapsed)}</div>
                </div>

                {checklist.length>0 && (
                  <div style={{marginBottom:14}}>
                    <div style={{fontSize:12,color:'rgba(255,255,255,0.5)',marginBottom:8}}>CHECKLIST</div>
                    {checklist.map((t,i)=>(
                      <div key={i} onClick={()=>setChecklist(c=>c.map((x,j)=>j===i?{...x,done:!x.done}:x))} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 0',borderBottom:'1px solid rgba(255,255,255,0.06)',cursor:'pointer'}}>
                        <div style={{width:20,height:20,borderRadius:4,border:'2px solid',borderColor:t.done?'#4ade80':'rgba(255,255,255,0.3)',background:t.done?'#4ade80':'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                          {t.done&&<span style={{fontSize:12,color:'#0d2137',fontWeight:700}}>✓</span>}
                        </div>
                        <span style={{fontSize:14,color:t.done?'rgba(255,255,255,0.4)':'#fff',textDecoration:t.done?'line-through':'none'}}>{t.label}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{marginBottom:12}}>
                  <label style={{fontSize:12,color:'rgba(255,255,255,0.5)',display:'block',marginBottom:5}}>Notes</label>
                  <textarea value={notes} onChange={e=>setNotes(e.target.value)} style={{...IS,minHeight:70,resize:'vertical'}} placeholder="Service notes..." />
                </div>

                <div style={{marginBottom:14}}>
                  <label style={{fontSize:12,color:'rgba(255,255,255,0.5)',display:'block',marginBottom:8}}>📷 End Photo {activeJob.photo_required&&<span style={{color:'#f87171'}}>* required</span>}</label>
                  <PhotoSlot slot="end" label="End photo" required={activeJob.photo_required} />
                </div>

                <button onClick={handleComplete} disabled={submitting} style={{width:'100%',padding:'15px',borderRadius:12,border:'none',background:'#c19c56',color:'#0d2137',fontSize:16,fontWeight:700,cursor:'pointer'}}>
                  {submitting?'Saving...':'🏁 Complete Job'}
                </button>
              </div>
            )}

            {!activeJob && jobs.length===0 && (
              <div style={{textAlign:'center',paddingTop:50,color:'rgba(255,255,255,0.4)'}}>
                <div style={{fontSize:40,marginBottom:12}}>📋</div>
                <div>No jobs assigned</div>
                {spotJobs.length>0 && <div style={{marginTop:12,color:'#c19c56',fontSize:13}}>⚡ You have {spotJobs.length} spot job{spotJobs.length>1?'s':''} pending!</div>}
              </div>
            )}

            {jobs.filter(j=>j.status==='assigned').map(j=>(
              <div key={j.id} style={{background:'rgba(255,255,255,0.05)',borderRadius:12,padding:'14px 16px',marginBottom:12}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'start',marginBottom:8}}>
                  <div>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <span style={{fontSize:15,fontWeight:700,color:'#fff'}}>{j.title}</span>
                      {j.job_category==='spot'&&<span style={{fontSize:10,background:'#c19c56',color:'#0d2137',padding:'2px 6px',borderRadius:10,fontWeight:700}}>SPOT</span>}
                    </div>
                    <div style={{fontSize:12,color:'rgba(255,255,255,0.4)',marginTop:2}}>{j.scheduled_date} {j.scheduled_time}</div>
                    <div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>{j.address}</div>
                  </div>
                  <div style={{fontSize:14,fontWeight:700,color:'#c19c56'}}>¥{Number(j.spot_value||j.value||0).toLocaleString()}</div>
                </div>
                {j.description&&<div style={{fontSize:12,color:'rgba(255,255,255,0.5)',background:'rgba(255,255,255,0.04)',borderRadius:6,padding:'8px',marginBottom:10}}>{j.description}</div>}
                {j.photo_required&&(
                  <div style={{marginBottom:10}}>
                    <label style={{fontSize:11,color:'rgba(255,255,255,0.4)',display:'block',marginBottom:6}}>📷 Start photo required</label>
                    <PhotoSlot slot="start" label="Start" required={false} />
                  </div>
                )}
                <button onClick={()=>handleStart(j)} disabled={submitting||!!activeJob} style={{width:'100%',padding:'12px',borderRadius:10,border:'none',background:activeJob?'rgba(255,255,255,0.1)':'#0F6E56',color:'#fff',fontSize:14,fontWeight:700,cursor:activeJob?'not-allowed':'pointer',opacity:activeJob?0.5:1}}>
                  {activeJob?'Finish active job first':'✅ Start Job'}
                </button>
              </div>
            ))}
          </>
        )}

        {/* SALARY TAB */}
        {tab==='salary' && (
          <div>
            <div style={{fontSize:17,fontWeight:700,color:'#fff',marginBottom:16}}>My Salary — {new Date().toLocaleString('en',{month:'long',year:'numeric'})}</div>
            {salaryData ? <>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
                {[['Jobs done',salaryData.jobs],['Hours',salaryData.hours+'h'],['Base pay','¥'+salaryData.base.toLocaleString()],['Spot earned','¥'+salaryData.spotEarned.toLocaleString()]].map(([l,v])=>(
                  <div key={l} style={{background:'rgba(255,255,255,0.06)',borderRadius:10,padding:'14px'}}>
                    <div style={{fontSize:11,color:'rgba(255,255,255,0.4)'}}>{l}</div>
                    <div style={{fontSize:20,fontWeight:700,color:'#c19c56',marginTop:4}}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{background:'rgba(193,156,86,0.15)',border:'1px solid rgba(193,156,86,0.3)',borderRadius:12,padding:'16px',textAlign:'center',marginBottom:14}}>
                <div style={{fontSize:12,color:'rgba(255,255,255,0.5)'}}>ESTIMATED TOTAL</div>
                <div style={{fontSize:32,fontWeight:700,color:'#c19c56',marginTop:4}}>¥{salaryData.total.toLocaleString()}</div>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginTop:4}}>* Final amount confirmed by admin</div>
              </div>
              {salaryData.spotEarned>0 && (
                <div style={{fontSize:13,color:'rgba(255,255,255,0.5)',textAlign:'center'}}>
                  ⚡ Includes ¥{salaryData.spotEarned.toLocaleString()} from spot jobs
                </div>
              )}
            </> : <div style={{color:'rgba(255,255,255,0.4)'}}>Loading...</div>}
          </div>
        )}

        {/* HISTORY TAB */}
        {tab==='history' && (
          <div>
            <div style={{fontSize:17,fontWeight:700,color:'#fff',marginBottom:16}}>Work History</div>
            {history.length===0&&<div style={{color:'rgba(255,255,255,0.4)',fontSize:13}}>No completed jobs yet.</div>}
            {history.map(j=>(
              <div key={j.id} style={{background:'rgba(255,255,255,0.05)',borderRadius:10,padding:'12px 14px',marginBottom:10}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <span style={{fontSize:14,fontWeight:600,color:'#fff'}}>{j.title}</span>
                    {j.job_category==='spot'&&<span style={{fontSize:10,background:'#c19c56',color:'#0d2137',padding:'2px 6px',borderRadius:10,fontWeight:700}}>SPOT</span>}
                  </div>
                  <div style={{fontSize:13,fontWeight:600,color:'#c19c56'}}>¥{Number(j.spot_value||j.value||0).toLocaleString()}</div>
                </div>
                <div style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>{j.scheduled_date} · {j.client_name}</div>
                {j.started_at&&j.completed_at&&<div style={{fontSize:11,color:'rgba(255,255,255,0.3)',marginTop:2}}>
                  {Math.round((new Date(j.completed_at)-new Date(j.started_at))/60000)} min
                </div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
