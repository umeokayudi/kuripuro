import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function LiveTracking() {
  const [employees, setEmployees] = useState([])
  const [jobs, setJobs] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load(); const t = setInterval(load, 30000); return ()=>clearInterval(t) }, [])

  const load = async () => {
    const [e, j] = await Promise.all([
      supabase.from('employees').select('id,full_name,score,is_active').eq('is_active',true).order('full_name'),
      supabase.from('jobs').select('*').in('status',['assigned','in_progress']).order('scheduled_date'),
    ])
    setEmployees(e.data||[])
    setJobs(j.data||[])
    setLoading(false)
  }

  const getEmpJobs = (empId) => jobs.filter(j=>j.employee_id===empId)
  const getActiveJob = (empId) => jobs.find(j=>j.employee_id===empId&&j.status==='in_progress')
  const getTodayJobs = (empId) => {
    const today = new Date().toISOString().split('T')[0]
    return jobs.filter(j=>j.employee_id===empId&&j.scheduled_date===today)
  }

  const statusColor = s => s>=90?'#4ade80':s>=70?'#fbbf24':'#f87171'

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <h2 style={{fontSize:18,fontWeight:700}}>Live Tracking</h2>
        <div style={{fontSize:12,color:'var(--text3)'}}>Auto-refresh 30s</div>
      </div>

      {loading&&<div style={{color:'var(--text3)',fontSize:13}}>Loading...</div>}

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
        {employees.map(emp=>{
          const activeJob = getActiveJob(emp.id)
          const todayJobs = getTodayJobs(emp.id)
          const done = todayJobs.filter(j=>j.status==='completed').length
          return (
            <div key={emp.id} onClick={()=>setSelected(selected===emp.id?null:emp.id)}
              style={{background:'var(--surface)',border:`1px solid ${activeJob?'rgba(74,222,128,0.3)':'var(--border)'}`,borderRadius:14,padding:14,cursor:'pointer',transition:'all 0.2s'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                <div>
                  <div style={{fontWeight:600,fontSize:14}}>{emp.full_name.split(' ')[0]}</div>
                  <div style={{fontSize:11,color:'var(--text3)',marginTop:1}}>
                    {activeJob?<span style={{color:'#4ade80',fontWeight:600}}>● Working</span>:todayJobs.length>0?<span style={{color:'var(--text3)'}}>● Idle</span>:<span style={{color:'rgba(255,255,255,0.2)'}}>○ No shift</span>}
                  </div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:16,fontWeight:700,color:statusColor(emp.score||100)}}>{emp.score||100}</div>
                  <div style={{fontSize:9,color:'var(--text3)'}}>score</div>
                </div>
              </div>

              {activeJob&&(
                <div style={{background:'rgba(74,222,128,0.08)',border:'1px solid rgba(74,222,128,0.15)',borderRadius:8,padding:'8px 10px',marginBottom:8}}>
                  <div style={{fontSize:11,fontWeight:600,color:'#4ade80',marginBottom:2}}>▶ {activeJob.title.replace(/ — .*/,'').substring(0,25)}</div>
                  <div style={{fontSize:10,color:'var(--text3)'}}>Started: {activeJob.started_at?new Date(activeJob.started_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):'—'}</div>
                  {activeJob.address?.startsWith('http')&&<a href={activeJob.address} target="_blank" rel="noreferrer" style={{fontSize:10,color:'#60a5fa',textDecoration:'none'}}>🗺 View location</a>}
                </div>
              )}

              {todayJobs.length>0&&(
                <div>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                    <span style={{fontSize:10,color:'var(--text3)'}}>Today's progress</span>
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
        const today = new Date().toISOString().split('T')[0]
        const todayJobs = empJobs.filter(j=>j.scheduled_date===today)
        const upcoming = empJobs.filter(j=>j.scheduled_date>today).slice(0,5)
        if (!emp) return null
        return (
          <div className="card">
            <div className="card-title">{emp.full_name} — Today's Schedule</div>
            {todayJobs.length===0&&<div style={{color:'var(--text3)',fontSize:13}}>No jobs today.</div>}
            {todayJobs.sort((a,b)=>(a.sequence_order||99)-(b.sequence_order||99)).map((j,idx)=>(
              <div key={j.id} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
                <div style={{width:28,height:28,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,flexShrink:0,
                  background:j.status==='completed'?'#4ade80':j.status==='in_progress'?'#fbbf24':'var(--surface2)',
                  color:j.status==='completed'||j.status==='in_progress'?'#0a1929':'var(--text3)'}}>
                  {j.status==='completed'?'✓':j.status==='in_progress'?'▶':idx+1}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:500}}>{j.title.replace(/ — .*/,'')}</div>
                  <div style={{fontSize:11,color:'var(--text3)',display:'flex',gap:10,marginTop:2}}>
                    {j.started_at&&<span>▶ {new Date(j.started_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</span>}
                    {j.completed_at&&<span>🏁 {new Date(j.completed_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</span>}
                    {j.started_at&&j.completed_at&&<span>⏱ {Math.round((new Date(j.completed_at)-new Date(j.started_at))/60000)}m</span>}
                  </div>
                </div>
                <div style={{display:'flex',gap:6,alignItems:'center'}}>
                  {j.address?.startsWith('http')&&<a href={j.address} target="_blank" rel="noreferrer" className="btn btn-sm">🗺</a>}
                  <span className={`badge ${j.status==='completed'?'badge-green':j.status==='in_progress'?'badge-amber':'badge-blue'}`}>{j.status}</span>
                </div>
              </div>
            ))}

            {upcoming.length>0&&(
              <div style={{marginTop:14}}>
                <div style={{fontSize:12,fontWeight:600,color:'var(--text3)',marginBottom:8,textTransform:'uppercase',letterSpacing:0.5}}>Upcoming</div>
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
    </div>
  )
}
