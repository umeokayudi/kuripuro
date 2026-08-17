import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

const tokyoToday = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).split(' ')[0]

export default function Dashboard() {
  const [clients, setClients] = useState([])
  const [employees, setEmployees] = useState([])
  const [todayJobs, setTodayJobs] = useState([])
  const [staleCount, setStaleCount] = useState(0)
  const [evals, setEvals] = useState([])
  const [loading, setLoading] = useState(true)
  const [clock, setClock] = useState(new Date())
  const [lastUpdate, setLastUpdate] = useState(null)

  useEffect(() => {
    load()
    const t = setInterval(() => setClock(new Date()), 1000)
    const r = setInterval(load, 15000)
    return () => { clearInterval(t); clearInterval(r) }
  }, [])

  const load = async () => {
    const today = tokyoToday()
    const [c, e, j, ev, stale] = await Promise.all([
      supabase.from('clients').select('*').eq('is_active', true),
      supabase.from('employees').select('id,full_name,score,is_active').eq('is_active', true).order('full_name'),
      supabase.from('jobs').select('*').eq('scheduled_date', today).order('scheduled_time'),
      supabase.from('evaluations').select('*').order('created_at', { ascending: false }).limit(5),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'assigned').lt('scheduled_date', today),
    ])
    setClients(c.data || [])
    setEmployees(e.data || [])
    setTodayJobs(j.data || [])
    setEvals(ev.data || [])
    setStaleCount(stale.count || 0)
    setLastUpdate(new Date())
    setLoading(false)
  }

  const cancelStaleJobs = async () => {
    const today = tokyoToday()
    if (!window.confirm(`Cancelar todos os jobs "assigned" anteriores a ${today}?`)) return
    const { error } = await supabase.from('jobs').update({ status: 'cancelled' }).eq('status', 'assigned').lt('scheduled_date', today)
    if (error) return toast.error(error.message)
    toast.success('Jobs obsoletos cancelados')
    load()
  }

  const fmt = n => '¥' + Number(n || 0).toLocaleString()
  const revenue = clients.reduce((s, c) => s + Number(c.monthly_revenue || 0), 0)
  const cost = clients.reduce((s, c) => s + Number(c.monthly_cost || 0), 0)
  const profit = revenue - cost

  const byEmp = {}
  todayJobs.forEach(j => {
    const k = j.employee_name || 'Unknown'
    if (!byEmp[k]) byEmp[k] = []
    byEmp[k].push(j)
  })

  const sortedClients = [...clients].sort((a, b) =>
    (Number(b.monthly_revenue || 0) - Number(b.monthly_cost || 0)) - (Number(a.monthly_revenue || 0) - Number(a.monthly_cost || 0))
  )
  const maxProfit = Math.max(...clients.map(c => Number(c.monthly_revenue || 0) - Number(c.monthly_cost || 0)), 1)
  const statusColor = s => ({ assigned: '#60a5fa', in_progress: '#fbbf24', completed: '#4ade80', cancelled: 'rgba(255,255,255,0.2)' }[s] || '#60a5fa')

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>KuriPuro Admin</h2>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            {clock.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Tokyo' })}
            {lastUpdate && <span style={{ marginLeft: 10 }}>· Updated {lastUpdate.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })}</span>}
            <button onClick={load} style={{ marginLeft: 10, fontSize: 10, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text3)', cursor: 'pointer' }}>🔄</button>
          </div>
        </div>
        <div style={{ fontSize: 36, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text)', letterSpacing: -2 }}>
          {clock.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })}
        </div>
      </div>

      {staleCount > 0 && (
        <div style={{ background: 'rgba(239,159,39,0.08)', border: '1px solid rgba(239,159,39,0.25)', borderRadius: 12, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--text2)' }}>⚠️ {staleCount} jobs assigned obsoletos (datas passadas)</span>
          <button onClick={cancelStaleJobs} className="btn btn-sm" style={{ background: '#EF9F27', color: '#fff', border: 'none', flexShrink: 0 }}>Cancelar obsoletos</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        {[['Monthly Revenue', fmt(revenue), 'var(--text)'], ['Net Profit', fmt(profit), 'var(--green)'], ['Active Employees', employees.length, 'var(--text)'], ['Today Jobs', todayJobs.length, 'var(--text)']].map(([l, v, c]) => (
          <div key={l} className="card" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>{l}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: c }}>{v}</div>
          </div>
        ))}
      </div>

      {todayJobs.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Today's Jobs ({tokyoToday()})</div>
          {Object.entries(byEmp).map(([name, jobs]) => (
            <div key={name} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 6 }}>{name}</div>
              {jobs.map(j => (
                <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                  <span>{j.title?.replace(/ — .*/, '')} · {j.scheduled_time || '—'}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: statusColor(j.status) }}>{j.status}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Recent Evaluations</div>
          {evals.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13 }}>No evaluations yet.</div>}
          {evals.map(e => (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div><div style={{ fontSize: 13, fontWeight: 500 }}>{e.employee_name}</div><div style={{ fontSize: 11, color: 'var(--text3)' }}>{e.category} · {e.eval_date}</div></div>
              <span className={`badge ${e.points_change > 0 ? 'badge-green' : 'badge-red'}`}>{e.points_change > 0 ? '+' : ''}{e.points_change} pts</span>
            </div>
          ))}
        </div>

        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Profit by Client</div>
          {sortedClients.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13 }}>No clients yet.</div>}
          {sortedClients.map(c => {
            const p = Number(c.monthly_revenue || 0) - Number(c.monthly_cost || 0)
            const pct = Math.round(p / maxProfit * 100)
            const color = pct >= 70 ? 'var(--green)' : pct >= 40 ? '#EF9F27' : 'var(--red)'
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <div style={{ width: 120, fontSize: 12, fontWeight: 500, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.company_name}</div>
                <div style={{ flex: 1, height: 14, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: pct + '%', background: color, borderRadius: 3 }} />
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color, width: 70, textAlign: 'right' }}>¥{(p / 1000).toFixed(0)}k</div>
              </div>
            )
          })}
        </div>
      </div>
      {loading && <div style={{ color: 'var(--text3)', fontSize: 12, marginTop: 8 }}>Updating...</div>}
    </div>
  )
}
