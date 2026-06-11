import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function Salary() {
  const [employees, setEmployees] = useState([])
  const [selected, setSelected] = useState(null)
  const [period, setPeriod] = useState(new Date().toISOString().slice(0,7))
  const [jobs, setJobs] = useState([])
  const [advances, setAdvances] = useState([])
  const [newAdv, setNewAdv] = useState({ amount:'', desc:'' })
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadEmployees() }, [])
  useEffect(() => { if (selected) { loadJobs(); loadAdvances() } }, [selected, period])

  const loadEmployees = async () => {
    const { data } = await supabase.from('employees').select('*').eq('is_active', true).order('full_name')
    setEmployees(data || [])
    setLoading(false)
  }

  const loadJobs = async () => {
    const { data } = await supabase.from('jobs').select('*')
      .eq('employee_id', selected.id)
      .eq('status', 'completed')
      .gte('scheduled_date', period + '-01')
      .lte('scheduled_date', period + '-31')
    setJobs(data || [])
  }

  const loadAdvances = async () => {
    const { data } = await supabase.from('salary_advances').select('*')
      .eq('employee_id', selected.id)
      .eq('period', period)
      .order('created_at')
    setAdvances(data || [])
  }

  const addAdvance = async () => {
    if (!newAdv.amount) return toast.error('Enter amount')
    const { error } = await supabase.from('salary_advances').insert({
      employee_id: selected.id,
      employee_name: selected.full_name,
      period,
      amount: parseFloat(newAdv.amount),
      description: newAdv.desc || 'Advance payment',
    })
    if (error) return toast.error(error.message)
    toast.success('Advance registered')
    setNewAdv({ amount:'', desc:'' })
    loadAdvances()
  }

  const calcSalary = () => {
    if (!selected) return {}
    const [year, month] = period.split('-').map(Number)
    const daysInMonth = new Date(year, month, 0).getDate()

    let base = 0
    if (selected.salary_type === 'fixed') {
      // Pro-rata if contract started this month
      if (selected.contract_start) {
        const start = new Date(selected.contract_start)
        const startMonth = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}`
        if (startMonth === period) {
          const workedDays = daysInMonth - start.getDate() + 1
          base = Math.round((selected.fixed_salary / daysInMonth) * workedDays)
        } else base = selected.fixed_salary || 0
      } else base = selected.fixed_salary || 0
    } else if (selected.salary_type === 'hourly') {
      const totalMins = jobs.reduce((s,j) => {
        if (!j.started_at || !j.completed_at) return s
        return s + (new Date(j.completed_at) - new Date(j.started_at)) / 60000
      }, 0)
      base = Math.round((totalMins / 60) * (selected.hourly_rate || 0))
    } else {
      // mixed
      const totalMins = jobs.reduce((s,j) => {
        if (!j.started_at || !j.completed_at) return s
        return s + (new Date(j.completed_at) - new Date(j.started_at)) / 60000
      }, 0)
      const jobValue = jobs.reduce((s,j) => s + Number(j.value||0), 0)
      base = (selected.fixed_salary || 0) + Math.round((totalMins/60)*(selected.hourly_rate||0)) + Math.round(jobValue * ((selected.job_bonus_rate||0)/100))
    }

    const transport = jobs.reduce((s,j) => s + 0, 0) // transport from checkins if needed
    const totalAdvances = advances.reduce((s,a) => s + Number(a.amount), 0)
    const net = base - totalAdvances

    return { base, transport, totalAdvances, net, daysInMonth }
  }

  const salary = calcSalary()

  const months = []
  for (let i = 0; i < 6; i++) {
    const d = new Date(); d.setMonth(d.getMonth() - i)
    months.push(d.toISOString().slice(0,7))
  }

  return (
    <div>
      <div className="grid-2" style={{ gap:14 }}>
        {/* Employee list */}
        <div>
          <div className="card" style={{ marginBottom:14 }}>
            <div className="card-title">Select Employee</div>
            <div className="form-group">
              <label>Period</label>
              <select value={period} onChange={e=>setPeriod(e.target.value)}>
                {months.map(m=><option key={m}>{m}</option>)}
              </select>
            </div>
            {loading && <div style={{color:'var(--text3)',fontSize:13}}>Loading...</div>}
            {employees.map(e => (
              <div key={e.id} onClick={()=>setSelected(e)} style={{ padding:'10px 12px', borderRadius:8, cursor:'pointer', background: selected?.id===e.id ? 'var(--navy)' : 'var(--surface2)', marginBottom:6, border: selected?.id===e.id ? '1px solid var(--navy)' : '1px solid transparent' }}>
                <div style={{ fontWeight:500, fontSize:13, color: selected?.id===e.id ? '#fff' : 'var(--text)' }}>{e.full_name}</div>
                <div style={{ fontSize:11, color: selected?.id===e.id ? 'rgba(255,255,255,0.6)' : 'var(--text3)' }}>
                  {e.salary_type === 'fixed' ? `Fixed ¥${Number(e.fixed_salary||0).toLocaleString()}/mo` : e.salary_type === 'hourly' ? `¥${e.hourly_rate}/h` : 'Mixed'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Salary detail */}
        <div>
          {!selected && <div className="card"><div style={{color:'var(--text3)',fontSize:13}}>Select an employee to view salary</div></div>}

          {selected && <>
            <div className="card" style={{ marginBottom:14 }}>
              <div className="card-title">📋 Contract — {selected.full_name}</div>
              <div className="grid-2" style={{ gap:8 }}>
                {[
                  ['Contract Type', selected.contract_type],
                  ['Salary Type', selected.salary_type],
                  ['Base Salary', selected.salary_type==='fixed' ? `¥${Number(selected.fixed_salary||0).toLocaleString()}/mo` : `¥${selected.hourly_rate}/h`],
                  ['Start Date', selected.contract_start || '—'],
                  ['End Date', selected.contract_end || '—'],
                  ['Attendance Bonus', selected.attendance_bonus ? `¥${Number(selected.attendance_bonus).toLocaleString()}` : '—'],
                  ['Weekly Advance', selected.advance_per_week ? `¥${Number(selected.advance_per_week).toLocaleString()}` : '—'],
                  ['Transport', selected.transport_reimbursed ? 'Reimbursed' : 'Not reimbursed'],
                ].map(([l,v]) => (
                  <div key={l} style={{ background:'var(--surface2)', borderRadius:8, padding:'8px 10px' }}>
                    <div style={{ fontSize:10, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.5px' }}>{l}</div>
                    <div style={{ fontSize:13, fontWeight:500, marginTop:2 }}>{v || '—'}</div>
                  </div>
                ))}
              </div>
              {selected.notes && <div style={{ marginTop:10, background:'var(--surface2)', borderRadius:8, padding:'10px 12px', fontSize:12, color:'var(--text2)' }}>{selected.notes}</div>}
            </div>

            <div className="card" style={{ marginBottom:14 }}>
              <div className="card-title">💴 Salary Calculation — {period}</div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {[
                  ['Base salary', `¥${salary.base?.toLocaleString()}`],
                  ['Jobs completed', jobs.length],
                  ['Advances deducted', `-¥${salary.totalAdvances?.toLocaleString()}`],
                ].map(([l,v]) => (
                  <div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid var(--border)', fontSize:13 }}>
                    <span style={{ color:'var(--text2)' }}>{l}</span>
                    <span style={{ fontWeight:500 }}>{v}</span>
                  </div>
                ))}
                <div style={{ display:'flex', justifyContent:'space-between', padding:'10px 0', fontSize:16, fontWeight:700 }}>
                  <span>NET TOTAL</span>
                  <span style={{ color:'var(--green)' }}>¥{salary.net?.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="card" style={{ marginBottom:14 }}>
              <div className="card-title">⬇️ Jobs this period</div>
              {jobs.length === 0 && <div style={{color:'var(--text3)',fontSize:13}}>No completed jobs</div>}
              {jobs.map(j => (
                <div key={j.id} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid var(--border)', fontSize:13 }}>
                  <div>
                    <div style={{ fontWeight:500 }}>{j.title}</div>
                    <div style={{ fontSize:11, color:'var(--text3)' }}>{j.scheduled_date}</div>
                  </div>
                  <span style={{ color:'var(--green)', fontWeight:500 }}>¥{Number(j.value||0).toLocaleString()}</span>
                </div>
              ))}
            </div>

            <div className="card">
              <div className="card-title">💸 Advances — {period}</div>
              {advances.map(a => (
                <div key={a.id} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid var(--border)', fontSize:13 }}>
                  <div>
                    <div style={{ fontWeight:500 }}>{a.description}</div>
                    <div style={{ fontSize:11, color:'var(--text3)' }}>{a.created_at?.slice(0,10)}</div>
                  </div>
                  <span style={{ color:'var(--red)', fontWeight:500 }}>-¥{Number(a.amount).toLocaleString()}</span>
                </div>
              ))}
              <div style={{ display:'flex', gap:8, marginTop:12 }}>
                <input type="number" value={newAdv.amount} onChange={e=>setNewAdv(a=>({...a,amount:e.target.value}))} placeholder="Amount ¥" style={{ width:120 }} className="form-group" />
                <input value={newAdv.desc} onChange={e=>setNewAdv(a=>({...a,desc:e.target.value}))} placeholder="Description" style={{ flex:1 }} />
                <button className="btn btn-primary" onClick={addAdvance}>+ Add</button>
              </div>
            </div>
          </>}
        </div>
      </div>
    </div>
  )
}
