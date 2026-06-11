import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

export default function EmployeeProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [emp, setEmp] = useState(null)
  const [jobs, setJobs] = useState([])
  const [evals, setEvals] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [workDays, setWorkDays] = useState([])

  useEffect(() => { loadAll() }, [id])

  const loadAll = async () => {
    setLoading(true)
    const [e, j, ev, p] = await Promise.all([
      supabase.from('employees').select('*').eq('id', id).single(),
      supabase.from('jobs').select('*').eq('employee_id', id).order('scheduled_date', { ascending: false }).limit(20),
      supabase.from('evaluations').select('*').eq('employee_id', id).order('created_at', { ascending: false }).limit(10),
      supabase.from('salary_payments').select('*').eq('employee_id', id).order('payment_date', { ascending: true }).limit(10),
    ])
    setEmp(e.data)
    setForm(e.data || {})
    setWorkDays(e.data?.work_days ? JSON.parse(e.data.work_days) : [])
    setJobs(j.data || [])
    setEvals(ev.data || [])
    setPayments(p.data || [])
    setLoading(false)
  }

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const toggleDay = (day) => {
    setWorkDays(d => d.includes(day) ? d.filter(x => x !== day) : [...d, day])
  }

  const handleSave = async () => {
    const { error } = await supabase.from('employees').update({
      full_name: form.full_name,
      email: form.email,
      password: form.password,
      phone: form.phone,
      address: form.address,
      contract_type: form.contract_type,
      salary_type: form.salary_type,
      hourly_rate: parseFloat(form.hourly_rate) || 0,
      fixed_salary: parseFloat(form.fixed_salary) || 0,
      job_bonus_rate: parseFloat(form.job_bonus_rate) || 0,
      contract_start: form.contract_start || null,
      contract_end: form.contract_end || null,
      advance_per_week: parseFloat(form.advance_per_week) || 0,
      attendance_bonus: parseFloat(form.attendance_bonus) || 0,
      transport_reimbursed: form.transport_reimbursed,
      bank_name: form.bank_name,
      bank_branch: form.bank_branch,
      account_type: form.account_type,
      account_number: form.account_number,
      account_holder_katakana: form.account_holder_katakana,
      notes: form.notes,
      work_days: JSON.stringify(workDays),
      hours_per_shift: parseFloat(form.hours_per_shift) || 0,
      shifts_per_week: parseInt(form.shifts_per_week) || 0,
    }).eq('id', id)
    if (error) return toast.error(error.message)
    toast.success('Saved!')
    setEditing(false)
    loadAll()
  }

  const scoreColor = s => s >= 90 ? '#0F6E56' : s >= 70 ? '#EF9F27' : '#A32D2D'
  const statusColor = s => ({ assigned:'badge-blue', in_progress:'badge-amber', completed:'badge-green', cancelled:'badge-red' }[s])
  const payStatusColor = s => ({ scheduled:'badge-blue', paid:'badge-green', cancelled:'badge-red' }[s])

  if (loading) return <div style={{ color:'var(--text3)', padding:20 }}>Loading...</div>
  if (!emp) return <div style={{ color:'var(--text3)', padding:20 }}>Employee not found</div>

  const savedDays = emp.work_days ? JSON.parse(emp.work_days) : []

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
        <button className="btn" onClick={() => navigate('/employees')}>← Back</button>
        <h2 style={{ fontSize:18, fontWeight:700 }}>{emp.full_name}</h2>
        <span className={`badge ${emp.is_active ? 'badge-green' : 'badge-red'}`}>{emp.is_active ? 'Active' : 'Inactive'}</span>
        <span style={{ fontSize:13, color:'var(--text3)', marginLeft:'auto' }}>{emp.email}</span>
      </div>

      <div className="grid-2" style={{ gap:14 }}>
        {/* LEFT */}
        <div>
          {/* Score */}
          <div className="card" style={{ marginBottom:14, textAlign:'center', padding:'20px 18px' }}>
            <div style={{ fontSize:60, fontWeight:700, color: scoreColor(emp.score||100), lineHeight:1 }}>{emp.score||100}</div>
            <div style={{ fontSize:12, color:'var(--text3)', marginTop:4 }}>Performance Score</div>
            <div style={{ height:8, background:'var(--surface2)', borderRadius:4, margin:'12px 0 4px', overflow:'hidden' }}>
              <div style={{ height:'100%', width:(emp.score||100)+'%', background:scoreColor(emp.score||100), borderRadius:4, transition:'width 0.4s' }} />
            </div>
            <div style={{ display:'flex', justifyContent:'center', gap:8, marginTop:8 }}>
              <span className="badge badge-green">{evals.filter(e=>e.type==='positive').length} positive</span>
              <span className="badge badge-red">{evals.filter(e=>e.type==='complaint').length} complaints</span>
            </div>
          </div>

          {/* Contract & Salary */}
          <div className="card" style={{ marginBottom:14 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
              <div className="card-title" style={{ marginBottom:0 }}>📋 Contract & Salary</div>
              {!editing && <button className="btn btn-sm btn-primary" onClick={()=>setEditing(true)}>✏️ Edit</button>}
            </div>

            {editing ? (
              <>
                <div className="grid-2">
                  <div className="form-group"><label>Full Name</label><input value={form.full_name||''} onChange={e=>upd('full_name',e.target.value)} /></div>
                  <div className="form-group"><label>Email</label><input value={form.email||''} onChange={e=>upd('email',e.target.value)} /></div>
                  <div className="form-group"><label>Password</label><input type="text" value={form.password||''} onChange={e=>upd('password',e.target.value)} /></div>
                  <div className="form-group"><label>Phone</label><input value={form.phone||''} onChange={e=>upd('phone',e.target.value)} /></div>
                  <div className="form-group" style={{gridColumn:'1/-1'}}><label>Address</label><input value={form.address||''} onChange={e=>upd('address',e.target.value)} /></div>
                </div>

                <div style={{ fontSize:12, fontWeight:600, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.5px', margin:'12px 0 10px', borderTop:'1px solid var(--border)', paddingTop:12 }}>Contract</div>
                <div className="grid-2">
                  <div className="form-group"><label>Contract Type</label>
                    <select value={form.contract_type||''} onChange={e=>upd('contract_type',e.target.value)}>
                      <option>Full-time</option><option>Part-time</option><option>Fixed-term</option><option>Hourly</option><option>Freelancer</option>
                    </select>
                  </div>
                  <div className="form-group"><label>Contract Start</label><input type="date" value={form.contract_start||''} onChange={e=>upd('contract_start',e.target.value)} /></div>
                  <div className="form-group"><label>Contract End</label><input type="date" value={form.contract_end||''} onChange={e=>upd('contract_end',e.target.value)} /></div>
                  <div className="form-group"><label>Hours per Shift</label><input type="number" value={form.hours_per_shift||''} onChange={e=>upd('hours_per_shift',e.target.value)} placeholder="9" /></div>
                  <div className="form-group"><label>Shifts per Week</label><input type="number" value={form.shifts_per_week||''} onChange={e=>upd('shifts_per_week',e.target.value)} placeholder="5" /></div>
                </div>

                <div style={{ fontSize:12, fontWeight:600, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.5px', margin:'12px 0 10px', borderTop:'1px solid var(--border)', paddingTop:12 }}>Work Days</div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14 }}>
                  {DAYS.map(d => (
                    <button key={d} onClick={()=>toggleDay(d)} style={{ padding:'6px 14px', borderRadius:20, border:'1.5px solid', borderColor: workDays.includes(d) ? 'var(--navy)' : 'var(--border)', background: workDays.includes(d) ? 'var(--navy)' : 'none', color: workDays.includes(d) ? '#fff' : 'var(--text2)', fontSize:13, fontWeight:500, cursor:'pointer' }}>
                      {d}
                    </button>
                  ))}
                </div>

                <div style={{ fontSize:12, fontWeight:600, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.5px', margin:'12px 0 10px', borderTop:'1px solid var(--border)', paddingTop:12 }}>Salary</div>
                <div className="form-group">
                  <label>Payment Type</label>
                  <select value={form.salary_type||'hourly'} onChange={e=>upd('salary_type',e.target.value)}>
                    <option value="hourly">Hourly — paid per hour worked</option>
                    <option value="fixed">Fixed — monthly salary</option>
                    <option value="per_job">Per Job — paid per service</option>
                    <option value="mixed">Mixed — fixed base + job bonus</option>
                  </select>
                </div>
                {(form.salary_type==='hourly') && <div className="form-group"><label>Hourly Rate (¥)</label><input type="number" value={form.hourly_rate||''} onChange={e=>upd('hourly_rate',e.target.value)} /></div>}
                {(form.salary_type==='fixed') && <div className="form-group"><label>Monthly Salary (¥)</label><input type="number" value={form.fixed_salary||''} onChange={e=>upd('fixed_salary',e.target.value)} /></div>}
                {(form.salary_type==='per_job') && <div className="form-group"><label>Rate per Job (¥) or % of job value</label><input type="number" value={form.job_bonus_rate||''} onChange={e=>upd('job_bonus_rate',e.target.value)} /></div>}
                {(form.salary_type==='mixed') && <div className="grid-2">
                  <div className="form-group"><label>Fixed Base (¥/mo)</label><input type="number" value={form.fixed_salary||''} onChange={e=>upd('fixed_salary',e.target.value)} /></div>
                  <div className="form-group"><label>Job Bonus (%)</label><input type="number" value={form.job_bonus_rate||''} onChange={e=>upd('job_bonus_rate',e.target.value)} /></div>
                </div>}

                <div style={{ fontSize:12, fontWeight:600, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.5px', margin:'12px 0 10px', borderTop:'1px solid var(--border)', paddingTop:12 }}>Extras</div>
                <div className="grid-2">
                  <div className="form-group"><label>Weekly Advance (¥)</label><input type="number" value={form.advance_per_week||''} onChange={e=>upd('advance_per_week',e.target.value)} /></div>
                  <div className="form-group"><label>Completion Bonus (¥)</label><input type="number" value={form.attendance_bonus||''} onChange={e=>upd('attendance_bonus',e.target.value)} /></div>
                </div>
                <div className="form-group">
                  <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                    <input type="checkbox" checked={form.transport_reimbursed||false} onChange={e=>upd('transport_reimbursed',e.target.checked)} style={{width:16,height:16}} />
                    Transport reimbursed
                  </label>
                </div>
                <div className="form-group"><label>Notes</label><textarea value={form.notes||''} onChange={e=>upd('notes',e.target.value)} /></div>

                <div style={{ fontSize:12, fontWeight:600, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.5px', margin:'12px 0 10px', borderTop:'1px solid var(--border)', paddingTop:12 }}>Bank Details</div>
                <div className="grid-2">
                  <div className="form-group"><label>Bank Name</label><input value={form.bank_name||''} onChange={e=>upd('bank_name',e.target.value)} /></div>
                  <div className="form-group"><label>Branch</label><input value={form.bank_branch||''} onChange={e=>upd('bank_branch',e.target.value)} /></div>
                  <div className="form-group"><label>Account Type</label>
                    <select value={form.account_type||'普通'} onChange={e=>upd('account_type',e.target.value)}>
                      <option value="普通">普通</option><option value="当座">当座</option>
                    </select>
                  </div>
                  <div className="form-group"><label>Account No.</label><input value={form.account_number||''} onChange={e=>upd('account_number',e.target.value)} /></div>
                  <div className="form-group" style={{gridColumn:'1/-1'}}><label>Holder (katakana)</label><input value={form.account_holder_katakana||''} onChange={e=>upd('account_holder_katakana',e.target.value)} /></div>
                </div>

                <div style={{ display:'flex', gap:8, marginTop:8 }}>
                  <button className="btn btn-primary" onClick={handleSave}>✅ Save All</button>
                  <button className="btn" onClick={()=>{setEditing(false);setForm(emp);setWorkDays(savedDays)}}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                {/* View mode */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12 }}>
                  {[
                    ['Contract',emp.contract_type||'—'],
                    ['Period', emp.contract_start ? `${emp.contract_start} → ${emp.contract_end||'open'}` : '—'],
                    ['Hours/shift', emp.hours_per_shift ? emp.hours_per_shift+'h' : '—'],
                    ['Shifts/week', emp.shifts_per_week || '—'],
                  ].map(([l,v])=>(
                    <div key={l} style={{ background:'var(--surface2)', borderRadius:8, padding:'8px 10px' }}>
                      <div style={{ fontSize:10, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'0.5px' }}>{l}</div>
                      <div style={{ fontSize:13, fontWeight:500, marginTop:2 }}>{v}</div>
                    </div>
                  ))}
                </div>

                {savedDays.length > 0 && (
                  <div style={{ marginBottom:12 }}>
                    <div style={{ fontSize:11, color:'var(--text3)', marginBottom:6 }}>WORK DAYS</div>
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                      {DAYS.map(d=>(
                        <span key={d} style={{ padding:'4px 12px', borderRadius:20, fontSize:12, fontWeight:500, background: savedDays.includes(d) ? 'var(--navy)' : 'var(--surface2)', color: savedDays.includes(d) ? '#fff' : 'var(--text3)' }}>{d}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ marginBottom:12 }}>
                  <div style={{ fontSize:11, color:'var(--text3)', marginBottom:6 }}>PAYMENT TYPE</div>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    <span className="badge badge-blue">{emp.salary_type||'hourly'}</span>
                    {emp.salary_type==='hourly' && <span className="badge badge-green">¥{emp.hourly_rate}/h</span>}
                    {emp.salary_type==='fixed' && <span className="badge badge-green">¥{Number(emp.fixed_salary||0).toLocaleString()}/mo</span>}
                    {emp.salary_type==='per_job' && <span className="badge badge-amber">{emp.job_bonus_rate}% per job</span>}
                    {emp.salary_type==='mixed' && <><span className="badge badge-green">¥{Number(emp.fixed_salary||0).toLocaleString()} base</span><span className="badge badge-amber">+{emp.job_bonus_rate}%</span></>}
                  </div>
                </div>

                {emp.advance_per_week > 0 && <div style={{ fontSize:12, color:'var(--text3)', marginBottom:4 }}>Weekly advance: <strong>¥{Number(emp.advance_per_week).toLocaleString()}</strong></div>}
                {emp.attendance_bonus > 0 && <div style={{ fontSize:12, color:'var(--text3)', marginBottom:4 }}>Completion bonus: <strong>¥{Number(emp.attendance_bonus).toLocaleString()}</strong></div>}
                {emp.transport_reimbursed && <div style={{ fontSize:12, color:'var(--text3)', marginBottom:4 }}>✓ Transport reimbursed</div>}
                {emp.notes && <div style={{ marginTop:8, background:'var(--surface2)', borderRadius:8, padding:'10px 12px', fontSize:12, color:'var(--text2)' }}>{emp.notes}</div>}
              </>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div>
          {/* Upcoming payments */}
          <div className="card" style={{ marginBottom:14 }}>
            <div className="card-title">💴 Scheduled Payments</div>
            {payments.length===0 && <div style={{color:'var(--text3)',fontSize:13}}>No payments scheduled.</div>}
            {payments.map(p=>(
              <div key={p.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight:500, fontSize:13 }}>¥{Number(p.amount).toLocaleString()}</div>
                  <div style={{ fontSize:11, color:'var(--text3)' }}>{p.payment_date} · {p.description||p.period||'Salary'}</div>
                </div>
                <span className={`badge ${payStatusColor(p.status)}`}>{p.status}</span>
              </div>
            ))}
            <button className="btn btn-sm" style={{ marginTop:10 }} onClick={()=>navigate('/payments')}>+ Schedule Payment</button>
          </div>

          {/* Jobs */}
          <div className="card" style={{ marginBottom:14 }}>
            <div className="card-title">📋 Assigned Jobs</div>
            {jobs.length===0 && <div style={{color:'var(--text3)',fontSize:13}}>No jobs.</div>}
            {jobs.slice(0,8).map(j=>(
              <div key={j.id} style={{ padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
                  <span style={{ fontWeight:500, fontSize:13 }}>{j.title}</span>
                  <span className={`badge ${statusColor(j.status)}`}>{j.status}</span>
                </div>
                <div style={{ fontSize:12, color:'var(--text3)' }}>{j.scheduled_date} · {j.client_name}</div>
                <div style={{ fontSize:12, color:'var(--green)', fontWeight:500 }}>¥{Number(j.value||0).toLocaleString()}</div>
              </div>
            ))}
            <button className="btn btn-sm" style={{ marginTop:10 }} onClick={()=>navigate('/jobs')}>+ New Job</button>
          </div>

          {/* Evaluations */}
          <div className="card">
            <div className="card-title">⭐ Evaluations</div>
            {evals.length===0 && <div style={{color:'var(--text3)',fontSize:13}}>No evaluations.</div>}
            {evals.map(e=>(
              <div key={e.id} style={{ padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
                  <span style={{ fontSize:13, fontWeight:500 }}>{e.category}</span>
                  <span className={`badge ${e.type==='positive'?'badge-green':'badge-red'}`}>{e.points_change>0?'+':''}{e.points_change} pts</span>
                </div>
                <div style={{ color:'#EF9F27', fontSize:13 }}>{'★'.repeat(e.stars||0)}{'☆'.repeat(5-(e.stars||0))}</div>
                {e.description && <div style={{ fontSize:12, color:'var(--text3)' }}>{e.description}</div>}
                <div style={{ fontSize:11, color:'var(--text3)' }}>{e.eval_date}</div>
              </div>
            ))}
            <button className="btn btn-sm" style={{ marginTop:10 }} onClick={()=>navigate('/evaluations')}>+ Evaluate</button>
          </div>
        </div>
      </div>
    </div>
  )
}
