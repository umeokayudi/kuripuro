import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Icons } from '../components/Icons'

export default function Dashboard() {
  const [data, setData] = useState({ revenue:0, profit:0, activeEmp:0, activeClients:0, todayJobs:[], recentEvals:[], clientProfit:[] })
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const month = new Date().toISOString().slice(0,7)

    const [clients, employees, jobs, evals] = await Promise.all([
      supabase.from('clients').select('*').eq('is_active', true),
      supabase.from('employees').select('*').eq('is_active', true),
      supabase.from('jobs').select('*').gte('scheduled_date', today).lte('scheduled_date', today),
      supabase.from('evaluations').select('*').order('created_at', { ascending:false }).limit(5),
    ])

    const clientList = clients.data || []
    const empList = employees.data || []
    const jobList = jobs.data || []
    const evalList = evals.data || []

    const revenue = clientList.reduce((s,c)=>s+Number(c.monthly_revenue||0),0)
    const cost = clientList.reduce((s,c)=>s+Number(c.monthly_cost||0),0)
    const profit = revenue - cost

    const clientProfit = clientList
      .map(c=>({ name:c.company_name, profit:Number(c.monthly_revenue||0)-Number(c.monthly_cost||0), revenue:Number(c.monthly_revenue||0) }))
      .sort((a,b)=>b.profit-a.profit)
      .slice(0,5)

    const maxProfit = clientProfit[0]?.profit || 1

    setData({ revenue, profit, activeEmp:empList.length, activeClients:clientList.length, todayJobs:jobList, recentEvals:evalList, clientProfit, maxProfit })
    setLoading(false)
  }

  const now = new Date()
  const timeStr = now.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',second:'2-digit'})
  const dateStr = now.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'})
  const margin = data.revenue > 0 ? Math.round(data.profit/data.revenue*100) : 0

  const statusColor = s => ({assigned:'badge-blue',in_progress:'badge-amber',completed:'badge-green',cancelled:'badge-red'}[s]||'badge-navy')

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <h2 style={{fontSize:20,fontWeight:700,margin:0}}>KuriPuro Admin</h2>
        <div style={{fontSize:13,color:'var(--text3)'}}>{timeStr} · {dateStr}</div>
      </div>

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:20}}>
        {[
          ['月間売上','Monthly Revenue', `¥${(data.revenue/1000).toFixed(0)}k`, null],
          ['純利益','Net Profit', `¥${(data.profit/1000).toFixed(0)}k`, `${margin}% margin`],
          ['稼働中従業員','Active Employees', data.activeEmp, null],
          ['稼働中クライアント','Active Clients', data.activeClients, null],
        ].map(([labelJP, labelEN, val, sub])=>(
          <div key={labelJP} className="card" style={{padding:'18px 20px'}}>
            <div style={{fontSize:12,color:'var(--text3)',marginBottom:6}}>{labelJP}</div>
            <div style={{fontSize:28,fontWeight:700,color:labelJP==='純利益'?'var(--green)':'var(--text)'}}>{val}</div>
            {sub&&<div style={{fontSize:12,color:'var(--text3)',marginTop:4}}>{sub}</div>}
          </div>
        ))}
      </div>

      <div className="grid-2" style={{gap:16}}>
        {/* Today's jobs */}
        <div className="card">
          <div className="card-title"><Icons.clock /> 本日のジョブ ({data.todayJobs.length})</div>
          {loading&&<div style={{color:'var(--text3)',fontSize:13}}>Loading...</div>}
          {data.todayJobs.length===0&&!loading&&<div style={{color:'var(--text3)',fontSize:13}}>No jobs today.</div>}
          {data.todayJobs.slice(0,8).map(j=>(
            <div key={j.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
              <div>
                <div style={{fontSize:13,fontWeight:500}}>{j.employee_name?.split(' ')[0]} — {j.title.replace(/ — .*/,'').substring(0,20)}</div>
                <div style={{fontSize:11,color:'var(--text3)'}}>{j.scheduled_time||'—'}</div>
              </div>
              <span className={`badge ${statusColor(j.status)}`}>{j.status}</span>
            </div>
          ))}
        </div>

        {/* Recent evaluations */}
        <div className="card">
          <div className="card-title"><Icons.alert /> 最近の評価</div>
          {data.recentEvals.length===0&&!loading&&<div style={{color:'var(--text3)',fontSize:13}}>No evaluations yet.</div>}
          {data.recentEvals.map(e=>(
            <div key={e.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
              <div>
                <div style={{fontSize:13,fontWeight:500}}>{e.employee_name}</div>
                <div style={{fontSize:11,color:'var(--text3)'}}>{e.category} · {e.eval_date}</div>
              </div>
              <span className={`badge ${e.points_change>0?'badge-green':'badge-red'}`}>{e.points_change>0?'+':''}{e.points_change} pts</span>
            </div>
          ))}
        </div>
      </div>

      {/* Client profit bars */}
      <div className="card" style={{marginTop:16}}>
        <div className="card-title"><Icons.trending /> クライアント別収益</div>
        {data.clientProfit.length===0&&!loading&&<div style={{color:'var(--text3)',fontSize:13}}>No clients yet.</div>}
        {data.clientProfit.map(c=>{
          const pct = Math.round(c.profit/data.maxProfit*100)
          const color = pct>=70?'var(--green)':pct>=40?'#EF9F27':'var(--red)'
          return (
            <div key={c.name} style={{display:'flex',alignItems:'center',gap:12,marginBottom:10}}>
              <div style={{width:140,fontSize:13,fontWeight:500,flexShrink:0}}>{c.name}</div>
              <div style={{flex:1,height:18,background:'var(--surface2)',borderRadius:4,overflow:'hidden'}}>
                <div style={{height:'100%',width:pct+'%',background:color,borderRadius:4,transition:'width 0.5s'}} />
              </div>
              <div style={{fontSize:13,fontWeight:600,color,width:80,textAlign:'right'}}>¥{(c.profit/1000).toFixed(0)}k</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
