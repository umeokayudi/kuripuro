import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function Dashboard() {
  const [clients, setClients] = useState([])
  const [employees, setEmployees] = useState([])
  const [todayJobs, setTodayJobs] = useState([])
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
    setLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const [c, e, j, ev] = await Promise.all([
      supabase.from('clients').select('*').eq('is_active', true),
      supabase.from('employees').select('*').eq('is_active', true).order('full_name'),
      Promise.resolve({data:[]}),
      supabase.from('evaluations').select('*').order('created_at', { ascending: false }).limit(5),
    ])
    setClients(c.data || [])
    setEmployees(e.data || [])
    setTodayJobs(j.data || [])
    setEvals(ev.data || [])
    setLastUpdate(new Date())
    setLoading(false)
  }

  const fmt = n => '¥' + Number(n || 0).toLocaleString()
  const revenue = clients.reduce((s, c) => s + Number(c.monthly_revenue || 0), 0)
  const cost = clients.reduce((s, c) => s + Number(c.monthly_cost || 0), 0)
  const profit = revenue - cost
  const margin = revenue > 0 ? Math.round(profit / revenue * 100) : 0

  const statusColor = s => ({ assigned: '#60a5fa', in_progress: '#fbbf24', completed: '#4ade80', cancelled: 'rgba(255,255,255,0.2)' }[s] || '#60a5fa')

  const byEmp = {}
  todayJobs.forEach(j => {
    const k = j.employee_name || 'Unknown'
    if (!byEmp[k]) byEmp[k] = []
    byEmp[k].push(j)
  })

  const maxProfit = Math.max(...clients.map(c => Number(c.monthly_revenue || 0) - Number(c.monthly_cost || 0)), 1)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>KuriPuro Admin</h2>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
            {clock.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {lastUpdate && <span style={{ marginLeft: 10, color: 'var(--text3)' }}>· Updated {lastUpdate.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
            <button onClick={load} style={{ marginLeft: 10, fontSize: 10, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text3)', cursor: 'pointer' }}>🔄</button>
          </div>
        </div>
        <div style={{ fontSize: 36, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text)', letterSpacing: -2 }}>
          {clock.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
          <span style={{ fontSize: 18, color: 'var(--text3)' }}>{String(clock.getSeconds()).padStart(2, '0')}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        {[['Monthly Revenue', fmt(revenue), 'var(--text)'], ['Net Profit', fmt(profit), 'var(--green)'], ['Active Employees', employees.length, 'var(--text)'], ['Active Clients', clients.length, 'var(--text)']].map(([l, v, c]) => (
          <div key={l} className="card" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>{l}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: c }}>{v}</div>
          </div>
        ))}
      </div>

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
          {clients.length === 0 && <div style={{ color: 'var(--text3)', fontSize: 13 }}>No clients yet.</div>}
          {clients.sort((a, b) => (Number(b.monthly_revenue || 0) - Number(b.monthly_cost || 0)) - (Number(a.monthly_revenue || 0) - Number(a.monthly_cost || 0))).map(c => {
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
    </div>
  )
}
