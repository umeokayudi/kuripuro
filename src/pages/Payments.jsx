import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function Payments() {
  const [employees, setEmployees] = useState([])
  const [payments, setPayments] = useState([])
  const [filter, setFilter] = useState('')
  const [form, setForm] = useState({ employee_id:'', amount:'', payment_date:'', period:'', description:'' })
  const [tab, setTab] = useState('calendar')

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    const [e, p] = await Promise.all([
      supabase.from('employees').select('id,full_name').eq('is_active',true).order('full_name'),
      supabase.from('salary_payments').select('*').order('payment_date', { ascending: true }),
    ])
    setEmployees(e.data||[])
    setPayments(p.data||[])
  }

  const upd = (k,v) => setForm(f=>({...f,[k]:v}))

  const handleAdd = async () => {
    if (!form.employee_id || !form.amount || !form.payment_date) return toast.error('Fill required fields')
    const emp = employees.find(e=>e.id===form.employee_id)
    const { error } = await supabase.from('salary_payments').insert({
      employee_id: form.employee_id,
      employee_name: emp?.full_name,
      amount: parseFloat(form.amount),
      payment_date: form.payment_date,
      period: form.period,
      description: form.description,
      status: 'scheduled',
    })
    if (error) return toast.error(error.message)
    toast.success('Payment scheduled!')
    setForm({ employee_id:'', amount:'', payment_date:'', period:'', description:'' })
    loadAll()
  }

  const markPaid = async (id) => {
    await supabase.from('salary_payments').update({ status:'paid' }).eq('id',id)
    toast.success('Marked as paid')
    loadAll()
  }

  const markCancelled = async (id) => {
    await supabase.from('salary_payments').update({ status:'cancelled' }).eq('id',id)
    loadAll()
  }

  const filtered = filter ? payments.filter(p=>p.employee_id===filter) : payments
  const upcoming = filtered.filter(p=>p.status==='scheduled' && new Date(p.payment_date) >= new Date())
  const overdue = filtered.filter(p=>p.status==='scheduled' && new Date(p.payment_date) < new Date())
  const paid = filtered.filter(p=>p.status==='paid')

  const statusStyle = s => ({
    scheduled: 'badge-blue',
    paid: 'badge-green',
    cancelled: 'badge-red',
  }[s])

  // Calendar view — group by month
  const byMonth = {}
  filtered.forEach(p => {
    const m = p.payment_date?.slice(0,7)
    if (!byMonth[m]) byMonth[m] = []
    byMonth[m].push(p)
  })

  const totalScheduled = upcoming.reduce((s,p)=>s+Number(p.amount),0)
  const totalPaid = paid.reduce((s,p)=>s+Number(p.amount),0)
  const totalOverdue = overdue.reduce((s,p)=>s+Number(p.amount),0)

  return (
    <div>
      <div className="metrics-grid" style={{ marginBottom:16 }}>
        <div className="metric-card"><div className="metric-label">Upcoming</div><div className="metric-value" style={{color:'var(--blue)'}}>¥{totalScheduled.toLocaleString()}</div></div>
        <div className="metric-card"><div className="metric-label">Overdue</div><div className="metric-value" style={{color:'var(--red)'}}>¥{totalOverdue.toLocaleString()}</div></div>
        <div className="metric-card"><div className="metric-label">Paid this month</div><div className="metric-value positive">¥{totalPaid.toLocaleString()}</div></div>
        <div className="metric-card"><div className="metric-label">Total payments</div><div className="metric-value">{payments.length}</div></div>
      </div>

      <div className="tab-pills">
        <button className={`tab-pill${tab==='calendar'?' active':''}`} onClick={()=>setTab('calendar')}>📅 Calendar</button>
        <button className={`tab-pill${tab==='list'?' active':''}`} onClick={()=>setTab('list')}>List</button>
        <button className={`tab-pill${tab==='new'?' active':''}`} onClick={()=>setTab('new')}>+ Schedule Payment</button>
      </div>

      {/* Filter */}
      <div className="card" style={{marginBottom:12,padding:'10px 14px'}}>
        <select value={filter} onChange={e=>setFilter(e.target.value)} style={{fontSize:13,border:'1px solid var(--border)',borderRadius:6,padding:'6px 10px',background:'var(--surface)',color:'var(--text)'}}>
          <option value="">All employees</option>
          {employees.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
      </div>

      {tab==='calendar' && (
        <div>
          {overdue.length > 0 && (
            <div className="card" style={{marginBottom:12,border:'1px solid var(--red-bg)'}}>
              <div className="card-title" style={{color:'var(--red)'}}>⚠️ Overdue Payments</div>
              {overdue.map(p=>(
                <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
                  <div>
                    <div style={{fontWeight:500,fontSize:13}}>{p.employee_name}</div>
                    <div style={{fontSize:11,color:'var(--red)'}}>Due: {p.payment_date} · {p.description||p.period}</div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontWeight:600,color:'var(--red)'}}>¥{Number(p.amount).toLocaleString()}</span>
                    <button className="btn btn-sm btn-success" onClick={()=>markPaid(p.id)}>Mark Paid</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {Object.keys(byMonth).sort().map(month=>(
            <div key={month} className="card" style={{marginBottom:12}}>
              <div className="card-title">📅 {month}</div>
              {byMonth[month].map(p=>(
                <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
                  <div>
                    <div style={{fontWeight:500,fontSize:13}}>{p.employee_name}</div>
                    <div style={{fontSize:12,color:'var(--text3)'}}>{p.payment_date} · {p.description||p.period||'Salary'}</div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontWeight:600,fontSize:14}}>¥{Number(p.amount).toLocaleString()}</span>
                    <span className={`badge ${statusStyle(p.status)}`}>{p.status}</span>
                    {p.status==='scheduled' && (
                      <div style={{display:'flex',gap:4}}>
                        <button className="btn btn-sm btn-success" onClick={()=>markPaid(p.id)}>Paid</button>
                        <button className="btn btn-sm" onClick={()=>markCancelled(p.id)}>✕</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div style={{display:'flex',justifyContent:'flex-end',marginTop:8,paddingTop:8,borderTop:'1px solid var(--border)'}}>
                <span style={{fontSize:13,color:'var(--text3)'}}>Total: </span>
                <span style={{fontSize:13,fontWeight:600,marginLeft:6}}>¥{byMonth[month].reduce((s,p)=>s+Number(p.amount),0).toLocaleString()}</span>
              </div>
            </div>
          ))}

          {Object.keys(byMonth).length===0 && <div className="card"><div style={{color:'var(--text3)',fontSize:13}}>No payments scheduled.</div></div>}
        </div>
      )}

      {tab==='list' && (
        <div className="card">
          <table>
            <thead><tr><th>Employee</th><th>Amount</th><th>Date</th><th>Period</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtered.map(p=>(
                <tr key={p.id}>
                  <td style={{fontWeight:500}}>{p.employee_name}</td>
                  <td style={{fontWeight:600}}>¥{Number(p.amount).toLocaleString()}</td>
                  <td>{p.payment_date}</td>
                  <td style={{fontSize:12,color:'var(--text3)'}}>{p.period||p.description||'—'}</td>
                  <td><span className={`badge ${statusStyle(p.status)}`}>{p.status}</span></td>
                  <td>
                    {p.status==='scheduled' && (
                      <div style={{display:'flex',gap:4}}>
                        <button className="btn btn-sm btn-success" onClick={()=>markPaid(p.id)}>Paid</button>
                        <button className="btn btn-sm" onClick={()=>markCancelled(p.id)}>✕</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length===0 && <div style={{color:'var(--text3)',fontSize:13,padding:'10px 0'}}>No payments.</div>}
        </div>
      )}

      {tab==='new' && (
        <div className="card">
          <div className="card-title">Schedule Payment</div>
          <div className="grid-2">
            <div className="form-group"><label>Employee *</label>
              <select value={form.employee_id} onChange={e=>upd('employee_id',e.target.value)}>
                <option value="">Select...</option>
                {employees.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Amount (¥) *</label><input type="number" value={form.amount} onChange={e=>upd('amount',e.target.value)} placeholder="350000" /></div>
            <div className="form-group"><label>Payment Date *</label><input type="date" value={form.payment_date} onChange={e=>upd('payment_date',e.target.value)} /></div>
            <div className="form-group"><label>Period</label><input value={form.period} onChange={e=>upd('period',e.target.value)} placeholder="June 2026" /></div>
            <div className="form-group" style={{gridColumn:'1/-1'}}><label>Description</label><input value={form.description} onChange={e=>upd('description',e.target.value)} placeholder="Monthly salary, advance, bonus..." /></div>
          </div>
          <button className="btn btn-primary" onClick={handleAdd}>📅 Schedule Payment</button>
        </div>
      )}
    </div>
  )
}
