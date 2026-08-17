import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { buildDeepCleanProgress, currentYearMonth } from '../lib/cleaningType'
import toast from 'react-hot-toast'

const tokyoToday = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).split(' ')[0]

export default function Dashboard() {
  const [clients, setClients] = useState([])
  const [employees, setEmployees] = useState([])
  const [todayJobs, setTodayJobs] = useState([])
  const [staleCount, setStaleCount] = useState(0)
  const [evals, setEvals] = useState([])
  const [monthJobs, setMonthJobs] = useState([])
  const [progressMonth, setProgressMonth] = useState(currentYearMonth())
  const [loading, setLoading] = useState(true)
  const [clock, setClock] = useState(new Date())
  const [lastUpdate, setLastUpdate] = useState(null)

  const load = async () => {
    const today = tokyoToday()
    const monthStart = progressMonth + '-01'
    const monthEnd = progressMonth + '-31'
    const [c, e, j, ev, stale, mj] = await Promise.all([
      supabase.from('clients').select('*').eq('is_active', true),
      supabase.from('employees').select('id,full_name,score,is_active').eq('is_active', true).order('full_name'),
      supabase.from('jobs').select('*').eq('scheduled_date', today).order('scheduled_time'),
      supabase.from('evaluations').select('*').order('created_at', { ascending: false }).limit(5),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'assigned').lt('scheduled_date', today),
      supabase.from('jobs').select('*').gte('scheduled_date', monthStart).lte('scheduled_date', monthEnd).neq('status', 'cancelled'),
    ])
    setClients(c.data || [])
    setEmployees(e.data || [])
    setTodayJobs(j.data || [])
    setEvals(ev.data || [])
    setStaleCount(stale.count || 0)
    setMonthJobs(mj.data || [])
    setLastUpdate(new Date())
    setLoading(false)
  }

  useEffect(() => {
    load()
    const t = setInterval(() => setClock(new Date()), 1000)
    const r = setInterval(load, 15000)
    return () => { clearInterval(t); clearInterval(r) }
  }, [progressMonth])

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

  const deepProgress = useMemo(() => buildDeepCleanProgress(monthJobs, progressMonth), [monthJobs, progressMonth])
  const monthLabel = new Date(progressMonth + '-01T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

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

      <div className="card" style={{ marginBottom: 20, borderLeft: '4px solid #fbbf24' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>✨ On The Planet — Limpezas Profundas</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
              Contrato: toda terça-feira · {deepProgress.tuesdays.length} terça(s) em {monthLabel} · {deepProgress.totals.expected} entregas previstas
            </div>
          </div>
          <input type="month" value={progressMonth} onChange={e => setProgressMonth(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13, fontWeight: 600 }} />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          {[
            ['Concluídas', deepProgress.totals.completed, '#4ade80'],
            ['Pendentes', deepProgress.totals.pending, '#60a5fa'],
            ['Faltam agendar', Math.max(0, deepProgress.totals.expected - deepProgress.totals.scheduled), '#f87171'],
            ['Progresso', `${deepProgress.totals.pct}%`, '#fbbf24'],
          ].map(([l, v, c]) => (
            <div key={l} style={{ background: 'var(--surface2)', borderRadius: 10, padding: '12px 16px', minWidth: 100 }}>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{l}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: c }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ height: 10, background: 'var(--surface2)', borderRadius: 5, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ height: '100%', width: `${deepProgress.totals.pct}%`, background: 'linear-gradient(90deg,#fbbf24,#4ade80)', borderRadius: 5, transition: 'width 0.4s' }} />
        </div>

        {deepProgress.tuesdaySummary.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 8 }}>Por terça-feira</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {deepProgress.tuesdaySummary.map(({ date, expected, done }) => {
                const ok = done >= expected
                const d = new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })
                return (
                  <div key={date} style={{ padding: '8px 12px', borderRadius: 8, background: ok ? 'rgba(74,222,128,0.12)' : 'rgba(251,191,36,0.1)', border: `1px solid ${ok ? 'rgba(74,222,128,0.3)' : 'rgba(251,191,36,0.25)'}`, fontSize: 12 }}>
                    <div style={{ fontWeight: 700 }}>Ter {d}</div>
                    <div style={{ color: ok ? '#4ade80' : '#fbbf24', fontWeight: 600 }}>{done}/{expected}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginBottom: 8 }}>Por restaurante</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
          {Object.entries(deepProgress.byLocation).map(([loc, data]) => {
            const pct = data.expected ? Math.round((data.completed / data.expected) * 100) : 0
            const ok = data.completed >= data.expected
            return (
              <div key={loc} style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--surface2)', border: `1px solid ${ok ? 'rgba(74,222,128,0.25)' : 'var(--border)'}` }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{loc}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>
                  <span>{data.completed}/{data.expected} feitas</span>
                  <span style={{ color: ok ? '#4ade80' : '#fbbf24', fontWeight: 700 }}>{pct}%</span>
                </div>
                <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: ok ? '#4ade80' : '#fbbf24', borderRadius: 2 }} />
                </div>
                {data.missing > 0 && <div style={{ fontSize: 10, color: '#f87171', marginTop: 4 }}>⚠ {data.missing} não agendada(s)</div>}
              </div>
            )
          })}
        </div>
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
