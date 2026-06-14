import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Icons } from '../components/Icons'
import { useLang } from '../hooks/useLang'

export default function Dashboard() {
  const { lang } = useLang()
  const jp = lang === 'ja'
  const [data, setData] = useState({ revenue:0, profit:0, activeEmp:0, activeClients:0, todayJobs:[], recentEvals:[], clientProfit:[], maxProfit:1 })
  const [loading, setLoading] = useState(true)
  const [clock, setClock] = useState(new Date())

  useEffect(() => {
    load()
    const t = setInterval(() => setClock(new Date()), 1000)
    const r = setInterval(load, 30000)
    return () => { clearInterval(t); clearInterval(r) }
  }, [])

  const load = async () => {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const [clients, employees, jobs, evals] = await Promise.all([
      supabase.from('clients').select('*').eq('is_active', true),
      supabase.from('employees').select('*').eq('is_active', true).order('full_name'),
      supabase.from('jobs').select('*').eq('scheduled_date', today).order('sequence_order'),
      supabase.from('evaluations').select('*').order('created_at', { ascending:false }).limit(5),
    ])
    const clientList = clients.data || []
    const empList = employees.data || []
    const jobList = jobs.data || []
    const revenue = clientList.reduce((s,c)=>s+Number(c.monthly_revenue||0),0)
    const cost = clientList.reduce((s,c)=>s+Number(c.monthly_cost||0),0)
    const clientProfit = clientList.map(c=>({ name:c.company_name, profit:Number(c.monthly_revenue||0)-Number(c.monthly_cost||0), revenue:Number(c.monthly_revenue||0) })).sort((a,b)=>b.profit-a.profit).slice(0,5)
    const maxProfit = clientProfit[0]?.profit || 1
    setData({ revenue, profit:revenue-cost, activeEmp:empList.length, activeClients:clientList.length, todayJobs:jobList, recentEvals:evals.data||[], clientProfit, maxProfit, employees:empList })
    setLoading(false)
  }

  const statusColor = s => ({assigned:'#60a5fa',in_progress:'#fbbf24',completed:'#4ade80',cancelled:'rgba(255,255,255,0.2)'}[s]||'#60a5fa')
  const margin = data.revenue > 0 ? Math.round(data.profit/data.revenue*100) : 0

  // Group today jobs by employee
  const empGroups = (data.employees||[]).map(e => ({
    emp: e,
    jobs: data.todayJobs.filter(j=>j.employee_id===e.id).sort((a,b)=>(a.sequence_order||99)-(b.sequence_order||99))
  })).filter(g=>g.jobs.length>0)

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <div>
          <h2 style={{fontSize:20,fontWeight:700,margin:0}}>KuriPuro Admin</h2>
          <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{clock.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</div>
        </div>
        <div style={{fontSize:36,fontWeight:700,fontFamily:'monospace',color:'var(--text)',letterSpacing:-2}}>{clock.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}<span style={{fontSize:18,color:'var(--text3)'}}>{String(clock.getSeconds()).padStart(2,'0')}</span></div>
      </div>

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:20}}>
        {[
          [jp?'月間売上':'Monthly Revenue', `¥${(data.revenue/1000).toFixed(0)}k`, 'var(--text)'],
          [jp?'純利益':'Net Profit', `¥${(data.profit/1000).toFixed(0)}k`, 'var(--green)'],
          [jp?'稼働中従業員':'Active Employees', data.activeEmp, 'var(--text)'],
          [jp?'稼働中クライアント':'Active Clients', data.activeClients, 'var(--text)'],
        ].map(([l,v,c])=>(
          <div key={l} className="card" style={{padding:'18px 20px'}}>
            <div style={{fontSize:12,color:'var(--text3)',marginBottom:6}}>{l}</div>
            <div style={{fontSize:28,fontWeight:700,color:c}}>{v}</div>
          </div>
        ))}
      </div>

      {/* Today by employee */}
      <div className="card" style={{marginBottom:16}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <div className="card-title" style={{margin:0}}>{jp?"本日のシフト":"Today's Shift"} — {new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'short'})}</div>
          <div style={{fontSize:12,color:'var(--text3)'}}>{data.todayJobs.length} jobs · {data.todayJobs.filter(j=>j.status==='completed').length} done</div>
        </div>

        {empGroups.length===0&&!loading&&<div style={{color:'var(--text3)',fontSize:13}}>No jobs today.</div>}

        {empGroups.map(({emp, jobs})=>{
          const done = jobs.filter(j=>j.status==='completed').length
          const active = jobs.find(j=>j.status==='in_progress')
          const next = jobs.find(j=>j.status==='assigned')
          const allDone = done === jobs.length
          return (
            <div key={emp.id} style={{marginBottom:16,paddingBottom:16,borderBottom:'1px solid var(--border)'}}>
              {/* Employee header */}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{width:36,height:36,borderRadius:'50%',background:allDone?'rgba(74,222,128,0.15)':active?'rgba(251,191,36,0.15)':'rgba(96,165,250,0.1)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:700,color:allDone?'var(--green)':active?'var(--amber)':'#60a5fa'}}>
                    {emp.full_name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}
                  </div>
                  <div>
                    <div style={{fontWeight:600,fontSize:14}}>{emp.full_name.split(' ')[0]}</div>
                    <div style={{fontSize:11,color:'var(--text3)',marginTop:1}}>
                      {allDone?'✅ All done':active?`▶ ${active.title.replace(/ — .*/,'')}`:next?`Next: ${next.title.replace(/ — .*/,'')}`:'—'}
                    </div>
                  </div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{fontSize:12,fontWeight:600,color:allDone?'var(--green)':'var(--text3)'}}>{done}/{jobs.length}</div>
                  {/* Progress dots */}
                  <div style={{display:'flex',gap:3}}>
                    {jobs.slice(0,12).map((j,i)=>(
                      <div key={i} style={{width:8,height:8,borderRadius:'50%',background:j.status==='completed'?'var(--green)':j.status==='in_progress'?'var(--amber)':'rgba(255,255,255,0.1)'}} />
                    ))}
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div style={{height:4,background:'var(--surface2)',borderRadius:2,overflow:'hidden',marginBottom:10}}>
                <div style={{height:'100%',width:(done/jobs.length*100)+'%',background:allDone?'var(--green)':'linear-gradient(90deg,#60a5fa,#4ade80)',borderRadius:2,transition:'width 0.4s'}} />
              </div>

              {/* Job list */}
              <div style={{display:'flex',flexDirection:'column',gap:4}}>
                {jobs.map((j,idx)=>(
                  <div key={j.id} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 10px',borderRadius:8,background:j.status==='in_progress'?'rgba(251,191,36,0.06)':j.status==='completed'?'rgba(74,222,128,0.03)':'rgba(255,255,255,0.02)'}}>
                    <div style={{width:20,height:20,borderRadius:'50%',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,background:j.status==='completed'?'var(--green)':j.status==='in_progress'?'rgba(251,191,36,0.2)':'rgba(255,255,255,0.06)',color:j.status==='completed'?'#0a1929':j.status==='in_progress'?'var(--amber)':'var(--text3)'}}>
                      {j.status==='completed'?'✓':j.status==='in_progress'?'▶':idx+1}
                    </div>
                    <div style={{flex:1,fontSize:12,color:j.status==='completed'?'var(--text3)':'var(--text)',textDecoration:j.status==='completed'?'line-through':'none'}}>{j.title.replace(/ — .*/,'')}</div>
                    <div style={{fontSize:10,color:'var(--text3)'}}>{j.scheduled_time}</div>
                    <div style={{width:6,height:6,borderRadius:'50%',background:statusColor(j.status),flexShrink:0}} />
                    {j.gps_override&&<span style={{fontSize:9,color:'var(--amber)',background:'rgba(251,191,36,0.1)',borderRadius:20,padding:'1px 5px'}}>⚠️{j.gps_end_distance}m</span>}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div className="grid-2" style={{gap:16}}>
        {/* Recent evals */}
        <div className="card">
          <div className="card-title">{jp?'最近の評価':'Recent Evaluations'}</div>
          {data.recentEvals.length===0&&<div style={{color:'var(--text3)',fontSize:13}}>No evaluations yet.</div>}
          {data.recentEvals.map(e=>(
            <div key={e.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
              <div><div style={{fontSize:13,fontWeight:500}}>{e.employee_name}</div><div style={{fontSize:11,color:'var(--text3)'}}>{e.category} · {e.eval_date}</div></div>
              <span className={`badge ${e.points_change>0?'badge-green':'badge-red'}`}>{e.points_change>0?'+':''}{e.points_change} pts</span>
            </div>
          ))}
        </div>

        {/* Client profit */}
        <div className="card">
          <div className="card-title">{jp?'クライアント別収益':'Profit by Client'}</div>
          {data.clientProfit.length===0&&<div style={{color:'var(--text3)',fontSize:13}}>No clients yet.</div>}
          {data.clientProfit.map(c=>{
            const pct = Math.round(c.profit/data.maxProfit*100)
            const color = pct>=70?'var(--green)':pct>=40?'#EF9F27':'var(--red)'
            return (
              <div key={c.name} style={{display:'flex',alignItems:'center',gap:12,marginBottom:10}}>
                <div style={{width:120,fontSize:12,fontWeight:500,flexShrink:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.name}</div>
                <div style={{flex:1,height:14,background:'var(--surface2)',borderRadius:3,overflow:'hidden'}}>
                  <div style={{height:'100%',width:pct+'%',background:color,borderRadius:3,transition:'width 0.5s'}} />
                </div>
                <div style={{fontSize:12,fontWeight:600,color,width:70,textAlign:'right'}}>¥{(c.profit/1000).toFixed(0)}k</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}