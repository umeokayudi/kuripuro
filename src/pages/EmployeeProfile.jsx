import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function EmployeeProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [emp, setEmp] = useState(null)
  const [jobs, setJobs] = useState([])
  const [evals, setEvals] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})

  useEffect(() => { loadAll() }, [id])

  const loadAll = async () => {
    setLoading(true)
    const [e, j, ev] = await Promise.all([
      supabase.from('employees').select('*').eq('id', id).single(),
      supabase.from('jobs').select('*').eq('employee_id', id).order('scheduled_date', { ascending: false }).limit(20),
      supabase.from('evaluations').select('*').eq('employee_id', id).order('created_at', { ascending: false }).limit(10),
    ])
    setEmp(e.data)
    setForm(e.data || {})
    setJobs(j.data || [])
    setEvals(ev.data || [])
    setLoading(false)
  }

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }))

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
    }).eq('id', id)
    if (error) return toast.error(error.message)
    toast.success('Saved!')
    setEditing(false)
    loadAll()
  }

  const scoreColor = s => s >= 90 ? '#0F6E56' : s >= 70 ? '#EF9F27' : '#A32D2D'
  const statusColor = s => ({ assigned:'badge-blue', in_progress:'badge-amber', completed:'badge-green', cancelled:'badge-red' }[s])

  if (loading) return <div style={{ color:'var(--text3)', padding:20 }}>Loading...</div>
  if (!emp) return <div style={{ color:'var(--text3)', padding:20 }}>Employee not found</div>

  const IS = (extra={}) => ({ ...extra })

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
        <button className="btn" onClick={() => navigate('/employees')}>← Back</button>
        <h2 style={{ fontSize:18, fontWeight:700 }}>{emp.full_name}</h2>
        <span className={`badge ${emp.is_active ? 'badge-green' : 'badge-red'}`}>{emp.is_active ? 'Active' : 'Inactive'}</span>
      </div>

      <div className="grid-2" style={{ gap:14 }}>
        {/* Left column */}
        <div>
          {/* Score card */}
          <div className="card" style={{ marginBottom:14, textAlign:'center' }}>
            <div style={{ fontSize:56, fontWeight:700, color: scoreColor(emp.score||100) }}>{emp.score||100}</div>
            <div style={{ fontSize:13, color:'var(--text3)' }}>Performance Score</div>
            <div style={{ height:8, background:'var(--surface2)', borderRadius:4, margin:'10px 0', overflow:'hidden' }}>
              <div style={{ height:'100%', width:(emp.score||100)+'%', background:scoreColor(emp.score||100), borderRadius:4 }} />
            </div>
          </div>

          {/* Salary type */}
          <div className="card" style={{ marginBottom:14 }}>
            <div className="card-title">💴 Salary Structure</div>
            {editing ? (
              <>
                <div className="form-group">
                  <label>Salary Type</label>
                  <select value={form.salary_type||'hourly'} onChange={e=>upd('salary_type',e.target.value)}>
                    <option value="hourly">Hourly (per hour worked)</option>
                    <option value="fixed">Fixed (monthly)</option>
                    <option value="per_job">Per Job (per service completed)</option>
                    <option value="mixed">Mixed (fixed + bonus)</option>
                  </select>
                </div>
                {(form.salary_type==='hourly') && <div className="form-group"><label>Hourly Rate (¥)</label><input type="number" value={form.hourly_rate||''} onChange={e=>upd('hourly_rate',e.target.value)} /></div>}
                {(form.salary_type==='fixed') && <div className="form-group"><label>Monthly Salary (¥)</label><input type="number" value={form.fixed_salary||''} onChange={e=>upd('fixed_salary',e.target.value)} /></div>}
                {(form.salary_type==='per_job') && <div className="form-group"><label>Bonus Rate (% of job value)</label><input type="number" value={form.job_bonus_rate||''} onChange={e=>upd('job_bonus_rate',e.target.value)} /></div>}
                {(form.salary_type==='mixed') && <>
                  <div className="form-group"><label>Fixed Base (¥/mo)</label><input type="number" value={form.fixed_salary||''} onChange={e=>upd('fixed_salary',e.target.value)} /></div>
                  <div className="form-group"><label>Bonus Rate (% of job value)</label><input type="number" value={form.job_bonus_rate||''} onChange={e=>upd('job_bonus_rate',e.target.value)} /></div>
                </>}
              </>
            ) : (
              <div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  <span className="badge badge-blue">{emp.salary_type||'hourly'}</span>
                  {emp.salary_type==='hourly' && <span className="badge badge-green">¥{emp.hourly_rate}/h</span>}
                  {emp.salary_type==='fixed' && <span className="badge badge-green">¥{Number(emp.fixed_salary||0).toLocaleString()}/mo</span>}
                  {emp.salary_type==='per_job' && <span className="badge badge-amber">{emp.job_bonus_rate||0}% per job</span>}
                  {emp.salary_type==='mixed' && <><span className="badge badge-green">¥{Number(emp.fixed_salary||0).toLocaleString()} base</span><span className="badge badge-amber">+{emp.job_bonus_rate||0}%</span></>}
                </div>
                {emp.contract_start && <div style={{ marginTop:8, fontSize:12, color:'var(--text3)' }}>Contract: {emp.contract_start} → {emp.contract_end||'open'}</div>}
                {emp.advance_per_week > 0 && <div style={{ fontSize:12, color:'var(--text3)' }}>Weekly advance: ¥{Number(emp.advance_per_week).toLocaleString()}</div>}
                {emp.attendance_bonus > 0 && <div style={{ fontSize:12, color:'var(--text3)' }}>Completion bonus: ¥{Number(emp.attendance_bonus).toLocaleString()}</div>}
              </div>
            )}
          </div>

          {/* Personal info */}
          <div className="card" style={{ marginBottom:14 }}>
            <div className="card-title">👤 Personal Info</div>
            {editing ? (
              <div className="grid-2">
                <div className="form-group"><label>Full Name</label><input value={form.full_name||''} onChange={e=>upd('full_name',e.target.value)} /></div>
                <div className="form-group"><label>Email</label><input value={form.email||''} onChange={e=>upd('email',e.target.value)} /></div>
                <div className="form-group"><label>Password</label><input value={form.password||''} onChange={e=>upd('password',e.target.value)} /></div>
                <div className="form-group"><label>Phone</label><input value={form.phone||''} onChange={e=>upd('phone',e.target.value)} /></div>
                <div className="form-group" style={{gridColumn:'1/-1'}}><label>Address</label><input value={form.address||''} onChange={e=>upd('address',e.target.value)} /></div>
                <div className="form-group"><label>Contract Type</label>
                  <select value={form.contract_type||''} onChange={e=>upd('contract_type',e.target.value)}>
                    <option>Full-time</option><option>Part-time</option><option>Fixed-term</option><option>Hourly</option><option>Freelancer</option>
                  </select>
                </div>
                <div className="form-group"><label>Contract Start</label><input type="date" value={form.contract_start||''} onChange={e=>upd('contract_start',e.target.value)} /></div>
                <div className="form-group"><label>Contract End</label><input type="date" value={form.contract_end||''} onChange={e=>upd('contract_end',e.target.value)} /></div>
                <div className="form-group"><label>Weekly Advance (¥)</label><input type="number" value={form.advance_per_week||''} onChange={e=>upd('advance_per_week',e.target.value)} /></div>
                <div className="form-group"><label>Attendance Bonus (¥)</label><input type="number" value={form.attendance_bonus||''} onChange={e=>upd('attendance_bonus',e.target.value)} /></div>
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {[['Email',emp.email],['Phone',emp.phone||'—'],['Address',emp.address||'—'],['Contract',emp.contract_type]].map(([l,v])=>(
                  <div key={l} style={{ display:'flex', justifyContent:'space-between', fontSize:13, padding:'6px 0', borderBottom:'1px solid var(--border)' }}>
                    <span style={{ color:'var(--text3)' }}>{l}</span><span style={{ fontWeight:500 }}>{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Bank */}
          <div className="card" style={{ marginBottom:14 }}>
            <div className="card-title">🏦 Bank Details</div>
            {editing ? (
              <div className="grid-2">
                <div className="form-group"><label>Bank</label><input value={form.bank_name||''} onChange={e=>upd('bank_name',e.target.value)} /></div>
                <div className="form-group"><label>Branch</label><input value={form.bank_branch||''} onChange={e=>upd('bank_branch',e.target.value)} /></div>
                <div className="form-group"><label>Account Type</label>
                  <select value={form.account_type||'普通'} onChange={e=>upd('account_type',e.target.value)}>
                    <option value="普通">普通</option><option value="当座">当座</option>
                  </select>
                </div>
                <div className="form-group"><label>Account No.</label><input value={form.account_number||''} onChange={e=>upd('account_number',e.target.value)} /></div>
                <div className="form-group" style={{gridColumn:'1/-1'}}><label>Holder (katakana)</label><input value={form.account_holder_katakana||''} onChange={e=>upd('account_holder_katakana',e.target.value)} /></div>
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {[['Bank',emp.bank_name||'—'],['Branch',emp.bank_branch||'—'],['Account',emp.account_number||'—'],['Holder',emp.account_holder_katakana||'—']].map(([l,v])=>(
                  <div key={l} style={{ display:'flex', justifyContent:'space-between', fontSize:13, padding:'6px 0', borderBottom:'1px solid var(--border)' }}>
                    <span style={{ color:'var(--text3)' }}>{l}</span><span style={{ fontWeight:500 }}>{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {editing && (
            <div className="card" style={{ marginBottom:14 }}>
              <div className="form-group"><label>Notes</label><textarea value={form.notes||''} onChange={e=>upd('notes',e.target.value)} /></div>
              <div className="form-group">
                <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                  <input type="checkbox" checked={form.transport_reimbursed||false} onChange={e=>upd('transport_reimbursed',e.target.checked)} />
                  Transport reimbursed
                </label>
              </div>
            </div>
          )}

          <div style={{ display:'flex', gap:8 }}>
            {editing ? (
              <><button className="btn btn-primary" onClick={handleSave}>Save Changes</button><button className="btn" onClick={()=>{setEditing(false);setForm(emp)}}>Cancel</button></>
            ) : (
              <button className="btn btn-primary" onClick={()=>setEditing(true)}>✏️ Edit Profile</button>
            )}
          </div>
        </div>

        {/* Right column */}
        <div>
          {/* Assigned jobs */}
          <div className="card" style={{ marginBottom:14 }}>
            <div className="card-title">📋 Assigned Jobs</div>
            {jobs.length===0 && <div style={{color:'var(--text3)',fontSize:13}}>No jobs assigned.</div>}
            {jobs.map(j=>(
              <div key={j.id} style={{ padding:'10px 0', borderBottom:'1px solid var(--border)' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                  <span style={{ fontWeight:500, fontSize:13 }}>{j.title}</span>
                  <span className={`badge ${statusColor(j.status)}`}>{j.status}</span>
                </div>
                <div style={{ fontSize:12, color:'var(--text3)' }}>{j.scheduled_date} {j.scheduled_time} · {j.client_name}</div>
                <div style={{ fontSize:12, color:'var(--green)', fontWeight:500 }}>¥{Number(j.value||0).toLocaleString()}</div>
              </div>
            ))}
          </div>

          {/* Recent evaluations */}
          <div className="card">
            <div className="card-title">⭐ Recent Evaluations</div>
            {evals.length===0 && <div style={{color:'var(--text3)',fontSize:13}}>No evaluations yet.</div>}
            {evals.map(e=>(
              <div key={e.id} style={{ padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                  <span style={{ fontSize:13, fontWeight:500 }}>{e.category}</span>
                  <span className={`badge ${e.type==='positive'?'badge-green':'badge-red'}`}>{e.points_change>0?'+':''}{e.points_change} pts</span>
                </div>
                <div style={{ color:'#EF9F27', fontSize:14 }}>{'★'.repeat(e.stars||0)}{'☆'.repeat(5-(e.stars||0))}</div>
                {e.description && <div style={{ fontSize:12, color:'var(--text3)', marginTop:2 }}>{e.description}</div>}
                <div style={{ fontSize:11, color:'var(--text3)' }}>{e.eval_date}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
