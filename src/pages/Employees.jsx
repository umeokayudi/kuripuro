import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

export default function Employees() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('list')
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [workDays, setWorkDays] = useState([])
  const [form, setForm] = useState({
    full_name:'', email:'', password:'', phone:'', address:'',
    contract_type:'Full-time', contract_start:'', contract_end:'',
    salary_type:'fixed', hourly_rate:0, fixed_salary:0, job_bonus_rate:0,
    hours_per_shift:0, shifts_per_week:5,
    advance_per_week:0, attendance_bonus:0, transport_reimbursed:true,
    bank_name:'', bank_branch:'', account_type:'普通', account_number:'', account_holder_katakana:'',
    notes:''
  })
  const [recEmpId, setRecEmpId] = useState('')
  const [recClient, setRecClient] = useState('')
  const [recType, setRecType] = useState(5)
  const [recDesc, setRecDesc] = useState('')

  const COMPLAINT_TYPES = [
    { label:'Incomplete service (-5 pts)', value:5 },
    { label:'Misconduct (-10 pts)', value:10 },
    { label:'Lateness (-3 pts)', value:3 },
    { label:'Property damage (-8 pts)', value:8 },
    { label:'Other (-2 pts)', value:2 },
  ]

  useEffect(() => { loadEmployees() }, [])

  const loadEmployees = async () => {
    setLoading(true)
    const { data } = await supabase.from('employees').select('*').order('full_name')
    setEmployees(data || [])
    setLoading(false)
  }

  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const toggleDay = (d) => setWorkDays(w => w.includes(d) ? w.filter(x=>x!==d) : [...w, d])

  const handleAdd = async () => {
    if (!form.full_name || !form.email || !form.password) return toast.error('Name, email and password required')
    const { error } = await supabase.from('employees').insert({
      full_name: form.full_name,
      email: form.email.trim().toLowerCase(),
      password: form.password,
      phone: form.phone,
      address: form.address,
      contract_type: form.contract_type,
      contract_start: form.contract_start || null,
      contract_end: form.contract_end || null,
      salary_type: form.salary_type,
      hourly_rate: parseFloat(form.hourly_rate) || 0,
      fixed_salary: parseFloat(form.fixed_salary) || 0,
      job_bonus_rate: parseFloat(form.job_bonus_rate) || 0,
      hours_per_shift: parseFloat(form.hours_per_shift) || 0,
      shifts_per_week: parseInt(form.shifts_per_week) || 0,
      work_days: JSON.stringify(workDays),
      advance_per_week: parseFloat(form.advance_per_week) || 0,
      attendance_bonus: parseFloat(form.attendance_bonus) || 0,
      transport_reimbursed: form.transport_reimbursed,
      bank_name: form.bank_name,
      bank_branch: form.bank_branch,
      account_type: form.account_type,
      account_number: form.account_number,
      account_holder_katakana: form.account_holder_katakana,
      notes: form.notes,
      score: 100,
      is_active: true,
    })
    if (error) return toast.error(error.message)
    toast.success('Employee registered!')
    setForm({ full_name:'', email:'', password:'', phone:'', address:'', contract_type:'Full-time', contract_start:'', contract_end:'', salary_type:'fixed', hourly_rate:0, fixed_salary:0, job_bonus_rate:0, hours_per_shift:0, shifts_per_week:5, advance_per_week:0, attendance_bonus:0, transport_reimbursed:true, bank_name:'', bank_branch:'', account_type:'普通', account_number:'', account_holder_katakana:'', notes:'' })
    setWorkDays([])
    loadEmployees()
    setTab('list')
  }

  const handleDeactivate = async (id, current) => {
    await supabase.from('employees').update({ is_active: !current }).eq('id', id)
    loadEmployees()
  }

  const handleDelete = async (id, name) => {
    if (!window.confirm(`⚠️ Delete ${name}? This will also delete all their jobs, payments, evaluations and history. This action cannot be undone.`)) return
    try {
      await supabase.from('jobs').delete().eq('employee_id', id)
      await supabase.from('checkins').delete().eq('employee_id', id)
      await supabase.from('complaints').delete().eq('employee_id', id)
      await supabase.from('payroll').delete().eq('employee_id', id)
      await supabase.from('evaluations').delete().eq('employee_id', id)
      await supabase.from('salary_payments').delete().eq('employee_id', id)
      await supabase.from('salary_advances').delete().eq('employee_id', id)
      await supabase.from('transport_claims').delete().eq('employee_id', id)
      await supabase.from('badges').delete().eq('employee_id', id)
      await supabase.from('messages').delete().eq('employee_id', id)

      const { error } = await supabase.from('employees').delete().eq('id', id)
      if (error) return toast.error('Error deleting: ' + error.message)
      toast.success(`${name} deleted successfully`)
      loadEmployees()
    } catch (err) {
      toast.error('Error deleting: ' + err.message)
    }
  }

  const handleComplaint = async () => {
    if (!recEmpId) return toast.error('Select employee')
    const emp = employees.find(e=>e.id===recEmpId)
    const newScore = Math.max(0,(emp.score||100)-recType)
    await supabase.from('employees').update({ score:newScore }).eq('id',recEmpId)
    await supabase.from('complaints').insert({ employee_id:recEmpId, employee_name:emp.full_name, client_name:recClient, complaint_type:COMPLAINT_TYPES.find(c=>c.value===recType)?.label, points_deducted:recType, description:recDesc, complaint_date:new Date().toISOString().split('T')[0] })
    toast.error(`-${recType} pts from ${emp.full_name}`)
    setRecEmpId(''); setRecClient(''); setRecType(5); setRecDesc('')
    loadEmployees()
  }

  const scoreColor = s => s>=90?'var(--green)':s>=70?'#EF9F27':'var(--red)'

  return (
    <div>
      <div className="tab-pills">
        <button className={`tab-pill${tab==='list'?' active':''}`} onClick={()=>setTab('list')}>List ({employees.length})</button>
        <button className={`tab-pill${tab==='register'?' active':''}`} onClick={()=>setTab('register')}>+ Add Employee</button>
        <button className={`tab-pill${tab==='complaints'?' active':''}`} onClick={()=>setTab('complaints')}>Complaints</button>
      </div>

      {tab==='list' && (
        <div>
          {loading && <div style={{color:'var(--text3)',fontSize:13}}>Loading...</div>}
          {employees.map(e=>{
            const days = e.work_days ? JSON.parse(e.work_days) : []
            return (
            <div key={e.id} className="card" style={{marginBottom:12}}>
              <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:12}}>
                <div className="avatar" style={{background:'#E6F1FB',color:'#185FA5',width:44,height:44,fontSize:15,fontWeight:700}}>
                  {e.full_name?.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:600,fontSize:15}}>{e.full_name}</div>
                  <div style={{fontSize:12,color:'var(--text3)'}}>{e.email} · {e.contract_type}</div>
                </div>
                <span className={`badge ${e.is_active?'badge-green':'badge-red'}`}>{e.is_active?'Active':'Inactive'}</span>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:12}}>
                <div style={{background:'var(--surface2)',borderRadius:8,padding:'8px',textAlign:'center'}}>
                  <div style={{fontSize:20,fontWeight:700,color:scoreColor(e.score||100)}}>{e.score||100}</div>
                  <div style={{fontSize:10,color:'var(--text3)'}}>Score</div>
                </div>
                <div style={{background:'var(--surface2)',borderRadius:8,padding:'8px',textAlign:'center'}}>
                  <div style={{fontSize:13,fontWeight:600}}>
                    {e.salary_type==='fixed'?'Fixed':e.salary_type==='hourly'?'Hourly':e.salary_type==='per_job'?'Per Job':'Mixed'}
                  </div>
                  <div style={{fontSize:10,color:'var(--text3)'}}>Pay type</div>
                </div>
                <div style={{background:'var(--surface2)',borderRadius:8,padding:'8px',textAlign:'center'}}>
                  <div style={{fontSize:13,fontWeight:600}}>
                    {e.salary_type==='fixed'?'¥'+Number(e.fixed_salary||0).toLocaleString():e.salary_type==='hourly'?'¥'+e.hourly_rate+'/h':e.salary_type==='per_job'?e.job_bonus_rate+'%':'Mixed'}
                  </div>
                  <div style={{fontSize:10,color:'var(--text3)'}}>Rate</div>
                </div>
                <div style={{background:'var(--surface2)',borderRadius:8,padding:'8px',textAlign:'center'}}>
                  <div style={{fontSize:13,fontWeight:600}}>{e.shifts_per_week||0}x</div>
                  <div style={{fontSize:10,color:'var(--text3)'}}>Shifts/week</div>
                </div>
              </div>

              {days.length>0 && (
                <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:10}}>
                  {DAYS.map(d=>(
                    <span key={d} style={{padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:500,background:days.includes(d)?'var(--navy)':'var(--surface2)',color:days.includes(d)?'#fff':'var(--text3)'}}>{d}</span>
                  ))}
                </div>
              )}

              {e.contract_start && <div style={{fontSize:11,color:'var(--text3)',marginBottom:8}}>Contract: {e.contract_start} → {e.contract_end||'open'}</div>}

              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-sm btn-primary" onClick={()=>navigate('/employees/'+e.id)}>👤 Profile</button>
                <button className="btn btn-sm" onClick={()=>handleDeactivate(e.id,e.is_active)}>{e.is_active?'Deactivate':'Activate'}</button>
                <button className="btn btn-sm btn-danger" onClick={()=>handleDelete(e.id,e.full_name)} style={{background:'#DC2626',color:'#fff'}}>🗑️ Delete</button>
              </div>
            </div>
          )})}
        </div>
      )}

      {tab==='register' && (
        <div className="card">
          <div className="card-title">New Employee</div>

          <div style={{fontSize:12,fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:10}}>Personal Info</div>
          <div className="grid-2">
            <div className="form-group"><label>Full Name *</label><input value={form.full_name} onChange={e=>upd('full_name',e.target.value)} placeholder="Yamamoto Hanako" /></div>
            <div className="form-group"><label>Email *</label><input type="email" value={form.email} onChange={e=>upd('email',e.target.value)} placeholder="hanako@email.com" /></div>
            <div className="form-group"><label>Password *</label><input type="text" value={form.password} onChange={e=>upd('password',e.target.value)} placeholder="Login password" /></div>
            <div className="form-group"><label>Phone</label><input value={form.phone} onChange={e=>upd('phone',e.target.value)} placeholder="090-1234-5678" /></div>
            <div className="form-group" style={{gridColumn:'1/-1'}}><label>Address</label><input value={form.address} onChange={e=>upd('address',e.target.value)} /></div>
          </div>

          <div style={{fontSize:12,fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.5px',margin:'16px 0 10px',borderTop:'1px solid var(--border)',paddingTop:14}}>Contract</div>
          <div className="grid-2">
            <div className="form-group"><label>Contract Type</label>
              <select value={form.contract_type} onChange={e=>upd('contract_type',e.target.value)}>
                <option>Full-time</option><option>Part-time</option><option>Fixed-term</option><option>Hourly</option><option>Freelancer</option>
              </select>
            </div>
            <div className="form-group"><label>Shifts per Week</label><input type="number" value={form.shifts_per_week} onChange={e=>upd('shifts_per_week',e.target.value)} /></div>
            <div className="form-group"><label>Contract Start</label><input type="date" value={form.contract_start} onChange={e=>upd('contract_start',e.target.value)} /></div>
            <div className="form-group"><label>Contract End</label><input type="date" value={form.contract_end} onChange={e=>upd('contract_end',e.target.value)} /></div>
            <div className="form-group"><label>Hours per Shift</label><input type="number" value={form.hours_per_shift} onChange={e=>upd('hours_per_shift',e.target.value)} placeholder="9" /></div>
          </div>

          <div style={{fontSize:12,fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.5px',margin:'16px 0 10px',borderTop:'1px solid var(--border)',paddingTop:14}}>Work Days</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:16}}>
            {DAYS.map(d=>(
              <button key={d} onClick={()=>toggleDay(d)} type="button" style={{padding:'7px 16px',borderRadius:20,border:'1.5px solid',borderColor:workDays.includes(d)?'var(--navy)':'var(--border)',background:workDays.includes(d)?'var(--navy)':'none',color:workDays.includes(d)?'#fff':'var(--text2)',fontSize:13,fontWeight:500,cursor:'pointer'}}>
                {d}
              </button>
            ))}
          </div>

          <div style={{fontSize:12,fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.5px',margin:'16px 0 10px',borderTop:'1px solid var(--border)',paddingTop:14}}>Payment Type</div>
          <div className="form-group">
            <label>Salary Type</label>
            <select value={form.salary_type} onChange={e=>upd('salary_type',e.target.value)}>
              <option value="fixed">Fixed — monthly salary (¥/month)</option>
              <option value="hourly">Hourly — paid per hour worked (¥/h)</option>
              <option value="per_job">Per Job — paid per service completed</option>
              <option value="mixed">Mixed — fixed base + job bonus (%)</option>
            </select>
          </div>
          {form.salary_type==='fixed' && <div className="form-group"><label>Monthly Salary (¥)</label><input type="number" value={form.fixed_salary} onChange={e=>upd('fixed_salary',e.target.value)} /></div>}
          {form.salary_type==='hourly' && <div className="form-group"><label>Hourly Rate (¥/h)</label><input type="number" value={form.hourly_rate} onChange={e=>upd('hourly_rate',e.target.value)} /></div>}
          {form.salary_type==='per_job' && <div className="form-group"><label>Bonus Rate (% of job value)</label><input type="number" value={form.job_bonus_rate} onChange={e=>upd('job_bonus_rate',e.target.value)} /></div>}
          {form.salary_type==='mixed' && <div className="grid-2">
            <div className="form-group"><label>Fixed Base (¥/mo)</label><input type="number" value={form.fixed_salary} onChange={e=>upd('fixed_salary',e.target.value)} /></div>
            <div className="form-group"><label>Job Bonus (%)</label><input type="number" value={form.job_bonus_rate} onChange={e=>upd('job_bonus_rate',e.target.value)} /></div>
          </div>}

          <div style={{fontSize:12,fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.5px',margin:'16px 0 10px',borderTop:'1px solid var(--border)',paddingTop:14}}>Extras</div>
          <div className="grid-2">
            <div className="form-group"><label>Weekly Advance (¥)</label><input type="number" value={form.advance_per_week} onChange={e=>upd('advance_per_week',e.target.value)} /></div>
            <div className="form-group"><label>Completion Bonus (¥)</label><input type="number" value={form.attendance_bonus} onChange={e=>upd('attendance_bonus',e.target.value)} /></div>
          </div>
          <div className="form-group">
            <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
              <input type="checkbox" checked={form.transport_reimbursed} onChange={e=>upd('transport_reimbursed',e.target.checked)} style={{width:16,height:16}} />
              Transport reimbursed
            </label>
          </div>
          <div className="form-group"><label>Notes / Contract details</label><textarea value={form.notes} onChange={e=>upd('notes',e.target.value)} placeholder="Additional contract info..." /></div>

          <div style={{fontSize:12,fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:'0.5px',margin:'16px 0 10px',borderTop:'1px solid var(--border)',paddingTop:14}}>Bank Details</div>
          <div className="grid-2">
            <div className="form-group"><label>Bank Name</label><input value={form.bank_name} onChange={e=>upd('bank_name',e.target.value)} placeholder="Japan Post / Mizuho..." /></div>
            <div className="form-group"><label>Branch (支店)</label><input value={form.bank_branch} onChange={e=>upd('bank_branch',e.target.value)} /></div>
            <div className="form-group"><label>Account Type</label>
              <select value={form.account_type} onChange={e=>upd('account_type',e.target.value)}>
                <option value="普通">普通（普通預金）</option><option value="当座">当座（当座預金）</option>
              </select>
            </div>
            <div className="form-group"><label>Account Number</label><input value={form.account_number} onChange={e=>upd('account_number',e.target.value)} /></div>
            <div className="form-group" style={{gridColumn:'1/-1'}}><label>Account Holder (katakana)</label><input value={form.account_holder_katakana} onChange={e=>upd('account_holder_katakana',e.target.value)} placeholder="ヤマモト ハナコ" /></div>
          </div>

          <button className="btn btn-primary" style={{marginTop:8}} onClick={handleAdd}>✅ Register Employee</button>
        </div>
      )}

      {tab==='complaints' && (
        <div className="card">
          <div className="card-title">Register Complaint</div>
          <div className="grid-2">
            <div className="form-group"><label>Employee</label>
              <select value={recEmpId} onChange={e=>setRecEmpId(e.target.value)}>
                <option value="">Select...</option>
                {employees.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Client</label><input value={recClient} onChange={e=>setRecClient(e.target.value)} /></div>
            <div className="form-group"><label>Type</label>
              <select value={recType} onChange={e=>setRecType(parseInt(e.target.value))}>
                {COMPLAINT_TYPES.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group"><label>Description</label><textarea value={recDesc} onChange={e=>setRecDesc(e.target.value)} /></div>
          <button className="btn btn-danger" onClick={handleComplaint}>Register Complaint</button>
        </div>
      )}
    </div>
  )
}
