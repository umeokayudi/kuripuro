import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { hasMapsLink, mapsOpenUrl } from '../lib/mapsLink'
import { apiFetch } from '../lib/apiFetch'
import JobPhotos from '../components/JobPhotos'
import PhotoLightbox from '../components/PhotoLightbox'
import toast from 'react-hot-toast'
import { useLang, fill } from '../hooks/useLang'
import { tokyoToday } from '../lib/dates'
import { JOB_GPS_SETUP_SQL, fenceOk, isLocationFresh, liveDistanceToJob, liveFocusJob, mapsPointUrl, mergeLocationHints, summarizeStaffStatus } from '../lib/jobGps'
import { isMissingColumnError } from '../lib/schemaError'
import { SUPABASE_SQL_URL } from '../lib/salarySetupSql'

export default function LiveTracking() {
  const { t } = useLang()
  const L = t.live
  const [employees, setEmployees] = useState([])
  const [jobs, setJobs] = useState([])
  const [locations, setLocations] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [photoInfo, setPhotoInfo] = useState(null)
  const [cleaning, setCleaning] = useState(false)
  const [retros, setRetros] = useState([])
  const [lightbox, setLightbox] = useState(null)
  const [gpsSchemaMissing, setGpsSchemaMissing] = useState(false)

  const checkPhotos = async () => {
    try {
      const r = await apiFetch('/api/cleanup-photos')
      if (!r.ok) throw new Error('HTTP ' + r.status)
      setPhotoInfo(await r.json())
    } catch(e) { setPhotoInfo({ error: e.message }) }
  }

  const cleanPhotos = async () => {
    if (!window.confirm(L.cleanConfirm)) return
    setCleaning(true)
    try {
      const r = await apiFetch('/api/cleanup-photos', { method: 'POST' })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const res = await r.json()
      if (res.error) throw new Error(res.error)
      toast.success(fill(L.cleaned, { n: res.filesDeleted || 0 }))
      setPhotoInfo(res)
    } catch(e) { toast.error('Erro: '+e.message) }
    setCleaning(false)
  }

  useEffect(() => { load(); const t = setInterval(load, 30000); return ()=>clearInterval(t) }, [])

  const loadRetros = async () => {
    const { data } = await supabase.from('jobs')
      .select('id,title,scheduled_date,employee_name,retro_report,retro_ai_summary,retro_value,value,checklist_done,checklist_total,admin_reviewed,photo_start_url,photo_end_url')
      .not('retro_report','is',null).eq('admin_reviewed',false)
      .order('scheduled_date',{ascending:false}).limit(20)
    setRetros(data||[])
  }

  const approveRetro = async (id) => {
    const { error } = await supabase.from('jobs').update({ admin_reviewed: true }).eq('id', id)
    if (error) return toast.error(error.message)
    toast.success(L.reviewedToast)
    loadRetros()
  }

  const load = async () => {
    loadRetros()
    const today = tokyoToday()
    const [e, activeRes, completedTodayRes, locRes, gpsProbe] = await Promise.all([
      supabase.from('employees').select('id,full_name,score,is_active,last_lat,last_lng,last_location_at,location_sharing').eq('is_active',true).order('full_name'),
      supabase.from('jobs').select('*').in('status',['assigned','in_progress']).order('scheduled_date'),
      supabase.from('jobs').select('*').eq('status','completed').eq('scheduled_date', today),
      supabase.from('locations').select('id,name,address,gps_lat,gps_lng'),
      supabase.from('jobs').select('id,gps_start_lat').limit(1),
    ])
    setGpsSchemaMissing(isMissingColumnError(gpsProbe.error, 'gps_start_lat'))
    setEmployees(e.data||[])
    const byId = new Map()
    for (const j of [...(activeRes.data||[]), ...(completedTodayRes.data||[])]) byId.set(j.id, j)
    setJobs([...byId.values()])
    setLocations(mergeLocationHints(locRes.data || []))
    setLoading(false)
  }

  const getEmpJobs = (empId) => jobs.filter(j=>j.employee_id===empId)
  const getTodayJobs = (empId) => {
    const today = tokyoToday()
    return jobs.filter(j=>j.employee_id===empId&&j.scheduled_date===today)
  }
  const today = tokyoToday()
  const summary = summarizeStaffStatus(employees, jobs, today)

  const gpsLink = (lat, lng, label, ok) => {
    const href = mapsPointUrl(lat, lng)
    if (!href) return null
    return (
      <a href={href} target="_blank" rel="noreferrer" onClick={ev=>ev.stopPropagation()}
        style={{fontSize:10,color:ok===false?'#f87171':ok?'#4ade80':'#60a5fa',textDecoration:'none'}}>
        📍 {label}
      </a>
    )
  }

  // Calcula atraso: primeiro job de hoje ainda não iniciado cujo horário-alvo já passou
  const getLateness = (empId) => {
    const now = new Date()
    const nowTokyo = new Date(now.toLocaleString('en-US',{timeZone:'Asia/Tokyo'}))
    const todayJobs = getTodayJobs(empId).filter(j=>j.status!=='completed'&&j.status!=='cancelled')
    let worstLate = 0
    for (const j of todayJobs) {
      if (!j.scheduled_time || j.status==='in_progress') continue
      const [h,m] = j.scheduled_time.split(':').map(Number)
      const target = new Date(nowTokyo); target.setHours(h,m,0,0)
      const lateMin = Math.round((nowTokyo - target)/60000)
      if (lateMin > worstLate) worstLate = lateMin
    }
    return worstLate
  }

  const statusColor = s => s>=90?'#4ade80':s>=70?'#fbbf24':'#f87171'

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8,gap:12,flexWrap:'wrap'}}>
        <h2 style={{fontSize:22,fontWeight:700,margin:0}}>{L.title}</h2>
        <div style={{fontSize:12,color:'var(--text3)'}}>{L.autoRefresh}</div>
      </div>
      <div style={{fontSize:12,color:'var(--text3)',marginBottom:14,lineHeight:1.45}}>{L.liveHint}</div>

      {gpsSchemaMissing && (
        <div style={{background:'rgba(239,159,39,0.1)',border:'1px solid rgba(239,159,39,0.3)',borderRadius:12,padding:14,marginBottom:16}}>
          <div style={{fontWeight:600,marginBottom:4}}>⚠️ {L.gpsSetupNeeded}</div>
          <div style={{fontSize:12,color:'var(--text2)',marginBottom:10}}>{L.gpsSetupHint}</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <button type="button" className="btn btn-sm btn-primary" onClick={async ()=>{
              try { await navigator.clipboard.writeText(JOB_GPS_SETUP_SQL); toast.success(t.payroll.copiedSql) }
              catch { toast.error(t.payroll.copySql) }
            }}>{t.payroll.copySql}</button>
            <a className="btn btn-sm" href={SUPABASE_SQL_URL} target="_blank" rel="noreferrer">{t.payroll.openSql}</a>
          </div>
        </div>
      )}

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10,marginBottom:16}}>
        {[
          [L.workingNow, summary.working, '#4ade80'],
          [L.onShift, summary.idle, '#60a5fa'],
          [L.unscheduled || L.folga, summary.unscheduled, 'var(--text3)'],
        ].map(([label, n, color]) => (
          <div key={label} style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,padding:'12px 14px'}}>
            <div style={{fontSize:11,color:'var(--text3)'}}>{label}</div>
            <div style={{fontSize:22,fontWeight:800,color,marginTop:2}}>{n}</div>
          </div>
        ))}
      </div>

      <div style={{background:'var(--surface)',border:'1px solid var(--border)',borderRadius:12,padding:14,marginBottom:16}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
          <div>
            <div style={{fontSize:13,fontWeight:600}}>📸 {L.photoStorage}</div>
            {photoInfo ? (
              photoInfo.error ? <div style={{fontSize:12,color:'var(--red)'}}>{photoInfo.error}</div> :
              <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>
                {fill(L.photoCount, { n: photoInfo.filesFound, date: photoInfo.cutoffDate })}{photoInfo.mode==='deleted'?fill(L.photoDeleted, { n: photoInfo.filesDeleted }):''}
              </div>
            ) : <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{L.photoCheckHint}</div>}
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={checkPhotos} className="btn btn-sm">{L.check}</button>
            <button onClick={cleanPhotos} disabled={cleaning} className="btn btn-sm" style={{background:'#DC2626',color:'#fff',border:'none'}}>{cleaning?L.cleaning:`🗑️ ${L.cleanOld}`}</button>
          </div>
        </div>
      </div>

      {retros.length>0&&(
        <div style={{background:'rgba(193,156,86,0.06)',border:'1px solid rgba(193,156,86,0.25)',borderRadius:12,padding:14,marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:700,color:'#c19c56',marginBottom:10}}>📝 {fill(L.retroReview, { n: retros.length })}</div>
          {retros.map(r=>(
            <div key={r.id} style={{background:'var(--surface)',borderRadius:10,padding:12,marginBottom:8,border:'1px solid var(--border)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:600}}>{(r.title||'').replace(/ — .*/,'')} <span style={{fontSize:11,color:'var(--text3)',fontWeight:400}}>· {r.employee_name} · {r.scheduled_date}</span></div>
                  <div style={{fontSize:12,color:'var(--text2)',marginTop:4,fontStyle:'italic'}}>"{r.retro_report}"</div>
                  <div style={{fontSize:11,color:'var(--text3)',marginTop:4}}>🤖 {r.retro_ai_summary} — {r.checklist_done}/{r.checklist_total} {L.items}</div>
                  <div style={{fontSize:12,marginTop:4}}><b>{L.paid}: ¥{Number(r.retro_value||0).toLocaleString()}</b> {Number(r.value||0)>Number(r.retro_value||0)&&<span style={{color:'var(--red)'}}>({L.of} ¥{Number(r.value).toLocaleString()})</span>}</div>
                  {(r.photo_start_url || r.photo_end_url) && (
                    <div style={{ marginTop: 8 }}>
                      <JobPhotos
                        photoStartUrl={r.photo_start_url}
                        photoEndUrl={r.photo_end_url}
                        beforeLabel={L.before}
                        afterLabel={L.after}
                        size={52}
                        onPhotoClick={setLightbox}
                      />
                    </div>
                  )}
                </div>
                <button onClick={()=>approveRetro(r.id)} className="btn btn-sm" style={{background:'#16a34a',color:'#fff',border:'none',flexShrink:0}}>✓ {L.reviewed}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {loading&&<div style={{color:'var(--text3)',fontSize:13}}>Loading...</div>}

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))',gap:12,marginBottom:16}}>
        {summary.rows.map(({ employee: emp, key: workKey, job: activeJob, todayJobs }) => {
          const done = todayJobs.filter(j=>j.status==='completed').length
          const lateMin = getLateness(emp.id)
          const locFresh = isLocationFresh(emp.last_location_at) && emp.location_sharing !== false
          const focusJob = activeJob || liveFocusJob(todayJobs)
          const liveM = focusJob ? liveDistanceToJob(emp, focusJob, locations) : null
          const liveOk = fenceOk(liveM)
          const offShift = workKey === 'unscheduled' || workKey === 'folga'
          const statusLabel = workKey === 'working' ? L.workingNow : workKey === 'idle' ? L.onShift : (L.unscheduled || L.folga)
          const statusColorLive = workKey === 'working' ? '#4ade80' : workKey === 'idle' ? '#60a5fa' : 'rgba(255,255,255,0.35)'
          return (
            <div key={emp.id} onClick={()=>setSelected(selected===emp.id?null:emp.id)}
              style={{background:'var(--surface)',border:`1px solid ${lateMin>=15?'rgba(248,113,113,0.4)':workKey==='working'?'rgba(74,222,128,0.35)':offShift?'rgba(255,255,255,0.06)':'var(--border)'}`,borderRadius:14,padding:14,cursor:'pointer',transition:'all 0.2s',opacity:offShift?0.78:1}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                <div>
                  <div style={{fontWeight:600,fontSize:14,display:'flex',alignItems:'center',gap:6}}>
                    {emp.full_name.split(' ')[0]}
                    {lateMin>=5&&<span style={{background:'rgba(248,113,113,0.15)',color:'#f87171',borderRadius:6,padding:'1px 6px',fontSize:10,fontWeight:700}}>⏰ {fill(L.late, { n: lateMin })}</span>}
                  </div>
                  <div style={{fontSize:11,color:'var(--text3)',marginTop:1,display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                    <span style={{color:statusColorLive,fontWeight:700}}>{workKey==='working'?'●':workKey==='idle'?'●':'○'} {statusLabel}</span>
                    {locFresh && gpsLink(emp.last_lat, emp.last_lng, liveM != null ? fill(L.fromStore, { n: liveM }) : L.seeLive, liveOk)}
                    {!locFresh && emp.last_lat && gpsLink(emp.last_lat, emp.last_lng, L.lastFix, null)}
                  </div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:16,fontWeight:700,color:statusColor(emp.score||100)}}>{emp.score||100}</div>
                  <div style={{fontSize:9,color:'var(--text3)'}}>score</div>
                </div>
              </div>

              {offShift && (
                <div style={{fontSize:11,color:'var(--text3)'}}>{L.noJobsToday}</div>
              )}

              {activeJob&&(
                <div style={{background:liveOk===false?'rgba(248,113,113,0.08)':'rgba(74,222,128,0.08)',border:`1px solid ${liveOk===false?'rgba(248,113,113,0.25)':'rgba(74,222,128,0.15)'}`,borderRadius:8,padding:'8px 10px',marginBottom:8}}>
                  <div style={{fontSize:11,fontWeight:600,color:liveOk===false?'#f87171':'#4ade80',marginBottom:2}}>▶ {activeJob.title.replace(/ — .*/,'').substring(0,28)}</div>
                  <div style={{fontSize:10,color:'var(--text3)'}}>{L.started}: {activeJob.started_at?new Date(activeJob.started_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):'—'}</div>
                  {activeJob.gps_start_distance_m != null && (
                    <div style={{fontSize:10,marginTop:2,color:fenceOk(activeJob.gps_start_distance_m)?'#4ade80':'#f87171'}}>
                      {L.gpsStart}: {fill(L.fromStore, { n: Math.round(activeJob.gps_start_distance_m) })} {fenceOk(activeJob.gps_start_distance_m)?L.onSite:L.tooFar}
                    </div>
                  )}
                  {liveM != null && (
                    <div style={{fontSize:10,marginTop:2,color:liveOk?'#4ade80':'#f87171'}}>
                      {L.seeLive}: {fill(L.fromStore, { n: liveM })} {liveOk?L.onSite:L.tooFar}
                    </div>
                  )}
                  {hasMapsLink(activeJob.address, activeJob.title)&&<a href={mapsOpenUrl(activeJob.address, activeJob.title)} target="_blank" rel="noreferrer" onClick={ev=>ev.stopPropagation()} style={{fontSize:10,color:'#60a5fa',textDecoration:'none'}}>🗺 {L.seeLocation}</a>}
                </div>
              )}

              {!activeJob && focusJob && !offShift && (
                <div style={{background:liveOk===false?'rgba(248,113,113,0.08)':'rgba(96,165,250,0.08)',border:`1px solid ${liveOk===false?'rgba(248,113,113,0.25)':'rgba(96,165,250,0.2)'}`,borderRadius:8,padding:'8px 10px',marginBottom:8}}>
                  <div style={{fontSize:11,fontWeight:600,color:liveOk===false?'#f87171':'#60a5fa',marginBottom:2}}>○ {focusJob.title.replace(/ — .*/,'').substring(0,28)}</div>
                  {liveM != null && (
                    <div style={{fontSize:10,marginTop:2,color:liveOk?'#4ade80':'#f87171'}}>
                      {L.seeLive}: {fill(L.fromStore, { n: liveM })} {liveOk?L.onSite:L.tooFar}
                    </div>
                  )}
                  {gpsLink(emp.last_lat, emp.last_lng, locFresh ? L.seeLive : L.lastFix, liveOk)}
                </div>
              )}

              {todayJobs.length>0&&(
                <div>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                    <span style={{fontSize:10,color:'var(--text3)'}}>{L.todayProgress}</span>
                    <span style={{fontSize:10,color:'var(--text2)',fontWeight:600}}>{done}/{todayJobs.length}</span>
                  </div>
                  <div style={{height:4,background:'var(--surface2)',borderRadius:2,overflow:'hidden'}}>
                    <div style={{height:'100%',width:(done/todayJobs.length*100)+'%',background:done===todayJobs.length?'#4ade80':'#60a5fa',borderRadius:2,transition:'width 0.4s'}} />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Selected employee detail */}
      {selected&&(()=>{
        const emp = employees.find(e=>e.id===selected)
        const empJobs = getEmpJobs(selected)
        const todayJobs = empJobs.filter(j=>j.scheduled_date===today)
        const upcoming = empJobs.filter(j=>j.scheduled_date>today).slice(0,5)
        if (!emp) return null
        return (
          <div className="card">
            <div className="card-title" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap'}}>
              <span>{emp.full_name}</span>
              {gpsLink(emp.last_lat, emp.last_lng, isLocationFresh(emp.last_location_at) ? L.seeLive : L.lastFix, null)}
            </div>
            {todayJobs.length===0&&<div style={{color:'var(--text3)',fontSize:13}}>{L.noJobsToday}</div>}
            {todayJobs.sort((a,b)=>(a.sequence_order||99)-(b.sequence_order||99)).map((j,idx)=>(
              <div key={j.id} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
                <div style={{width:28,height:28,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,flexShrink:0,
                  background:j.status==='completed'?'#4ade80':j.status==='in_progress'?'#fbbf24':'var(--surface2)',
                  color:j.status==='completed'||j.status==='in_progress'?'#0a1929':'var(--text3)'}}>
                  {j.status==='completed'?'✓':j.status==='in_progress'?'▶':idx+1}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:500}}>{j.title.replace(/ — .*/,'')}</div>
                  <div style={{fontSize:11,color:'var(--text3)',display:'flex',gap:10,marginTop:2,flexWrap:'wrap'}}>
                    {j.started_at&&<span>▶ {new Date(j.started_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</span>}
                    {j.completed_at&&<span>🏁 {new Date(j.completed_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</span>}
                    {j.started_at&&j.completed_at&&<span>⏱ {Math.round((new Date(j.completed_at)-new Date(j.started_at))/60000)}m</span>}
                    {j.gps_start_distance_m != null && <span style={{color:fenceOk(j.gps_start_distance_m)?'#4ade80':'#f87171'}}>{L.gpsStart} {Math.round(j.gps_start_distance_m)}m</span>}
                    {j.gps_end_distance_m != null && <span style={{color:fenceOk(j.gps_end_distance_m)?'#4ade80':'#f87171'}}>{L.gpsEnd} {Math.round(j.gps_end_distance_m)}m</span>}
                  </div>
                  <div style={{display:'flex',gap:8,marginTop:4,flexWrap:'wrap'}}>
                    {gpsLink(j.gps_start_lat, j.gps_start_lng, L.seeStart, fenceOk(j.gps_start_distance_m))}
                    {gpsLink(j.gps_end_lat, j.gps_end_lng, L.seeEnd, fenceOk(j.gps_end_distance_m))}
                  </div>
                </div>
                <div style={{display:'flex',gap:6,alignItems:'center'}}>
                  {j.status === 'completed' && (j.photo_start_url || j.photo_end_url) && (
                    <JobPhotos
                      photoStartUrl={j.photo_start_url}
                      photoEndUrl={j.photo_end_url}
                      beforeLabel={L.before}
                      afterLabel={L.after}
                      size={40}
                      onPhotoClick={setLightbox}
                    />
                  )}
                  {hasMapsLink(j.address, j.title)&&<a href={mapsOpenUrl(j.address, j.title)} target="_blank" rel="noreferrer" className="btn btn-sm">🗺</a>}
                  <span className={`badge ${j.status==='completed'?'badge-green':j.status==='in_progress'?'badge-amber':'badge-blue'}`}>{j.status}</span>
                </div>
              </div>
            ))}

            {upcoming.length>0&&(
              <div style={{marginTop:14}}>
                <div style={{fontSize:12,fontWeight:600,color:'var(--text3)',marginBottom:8,textTransform:'uppercase',letterSpacing:0.5}}>{L.upcoming}</div>
                {upcoming.map(j=>(
                  <div key={j.id} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid var(--border)',fontSize:12}}>
                    <span style={{color:'var(--text2)'}}>{j.scheduled_date} · {j.title.replace(/ — .*/,'')}</span>
                    <span className="badge badge-blue">{j.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}

      <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} />
    </div>
  )
}
