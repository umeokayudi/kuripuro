import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import ContractTab from '../components/ContractTab'

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function ReassignJob({ job, onDone }) {
  const [open, setOpen] = useState(false)
  const [employees, setEmployees] = useState([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(false)

  const load = async () => {
    const { data } = await supabase.from('employees').select('id,full_name').eq('is_active',true).order('full_name')
    setEmployees(data||[])
  }

  const handleOpen = () => { setOpen(true); load() }

  const handleReassign = async () => {
    if (!selected) return
    setLoading(true)
    const emp = employees.find(e=>e.id===selected)
    await supabase.from('jobs').update({ employee_id:selected, employee_name:emp?.full_name }).eq('id',job.id)
    setOpen(false); setLoading(false); onDone()
  }

  if (!open) return <button className="btn btn-sm" style={{fontSize:10,padding:'2px 8px'}} onClick={handleOpen}>↔ Move</button>

  return (
    <div style={{display:'flex',gap:4,alignItems:'center'}}>
      <select value={selected} onChange={e=>setSelected(e.target.value)} style={{fontSize:11,padding:'2px 6px',borderRadius:6,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)'}}>
        <option value="">Select...</option>
        {employees.map(e=><option key={e.id} value={e.id}>{e.full_name.split(' ')[0]}</option>)}
      </select>
      <button className="btn btn-sm" style={{fontSize:10,padding:'2px 8px',background:'var(--green)',color:'#0a1929'}} onClick={handleReassign} disabled={loading}>✓</button>
      <button className="btn btn-sm" style={{fontSize:10,padding:'2px 8px'}} onClick={()=>setOpen(false)}>✕</button>
    </div>
  )
}

function RecentDays({ jobs, onDayClick }) {
  const [openDay, setOpenDay] = useState(null)
  const byDay = {}
  jobs.forEach(j => {
    if (!byDay[j.scheduled_date]) byDay[j.scheduled_date] = []
    byDay[j.scheduled_date].push(j)
  })
  const days = Object.keys(byDay).sort((a,b) => b.localeCompare(a)).slice(0,10)

  return (
    <div>
      {days.length===0&&<div style={{color:'var(--text3)',fontSize:13}}>No recent jobs.</div>}
      {days.map(date => {
        const dayJobs = byDay[date]
        const done = dayJobs.filter(j=>j.status==='completed').length
        const isOpen = openDay===date
        return (
          <div key={date} style={{marginBottom:6}}>
            <div onClick={()=>setOpenDay(isOpen?null:date)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 10px',borderRadius:8,background:'var(--surface2)',cursor:'pointer'}}>
              <div style={{fontSize:13,fontWeight:500}}>{new Date(date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})}</div>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:11,color:'var(--text3)'}}>{done}/{dayJobs.length}</span>
                <span style={{fontSize:11,color:done===dayJobs.length?'var(--green)':'var(--text3)'}}>{isOpen?'▲':'▼'}</span>
              </div>
            </div>
            {isOpen&&(
              <div style={{marginTop:4,paddingLeft:10}}>
                {dayJobs.sort((a,b)=>(a.sequence_order||99)-(b.sequence_order||99)).map((j,i)=>(
                  <div key={j.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',borderBottom:'1px solid var(--border)'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontSize:11,color:'var(--text3)',width:16}}>{i+1}</span>
                      <span style={{fontSize:12,color:j.status==='completed'?'var(--text3)':'var(--text)',textDecoration:j.status==='completed'?'line-through':'none'}}>{j.title.replace(/ — .*/,'')}</span>
                    </div>
                    <span style={{fontSize:10,padding:'1px 6px',borderRadius:20,background:j.status==='completed'?'rgba(74,222,128,0.1)':'rgba(96,165,250,0.1)',color:j.status==='completed'?'var(--green)':'#60a5fa'}}>{j.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function EmployeeProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState('overview')
  const [emp, setEmp] = useState(null)
  const [jobs, setJobs] = useState([])
  const [evals, setEvals] = useState([])
  const [payments, setPayments] = useState([])
  const [advances, setAdvances] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [workDays, setWorkDays] = useState([])
  const [evalForm, setEvalForm] = useState({ type:'positive', category:'Quality', points_change:5, stars:5, description:'', eval_date:new Date().toISOString().split('T')[0] })
  const [addingEval, setAddingEval] = useState(false)
  const [analyzingId, setAnalyzingId] = useState(null)

  const analyzePhoto = async (job) => {
    if (!job.photo_end_url) return
    setAnalyzingId(job.id)
    try {
      const resp = await fetch('/api/analyze-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoUrl: job.photo_end_url, locationName: job.title }),
      })
      const result = await resp.json()
      await supabase.from('jobs').update({
        photo_ai_score: result?.nota ?? null,
        photo_ai_approved: result?.aprovado ?? null,
        photo_ai_issues: result?.problemas?.length ? result.problemas.join(', ') : null,
      }).eq('id', job.id)
      toast.success(`Analisado: nota ${result?.nota ?? '?'}/10`)
      loadAll()
    } catch (e) {
      toast.error('Erro ao analisar: ' + e.message)
    }
    setAnalyzingId(null)
  }

  const EVAL_CATEGORIES = ['Quality','Punctuality','Behavior','Communication','Initiative','Cleanliness']

  useEffect(() => { loadAll() }, [id])

  const loadAll = async () => {
    setLoading(true)
    const [e, j, ev, p, adv] = await Promise.all([
      supabase.from('employees').select('*').eq('id', id).single(),
      supabase.from('jobs').select('*').eq('employee_id', id).order('scheduled_date', { ascending:false }).limit(30),
      supabase.from('evaluations').select('*').eq('employee_id', id).order('created_at', { ascending:false }),
      supabase.from('salary_payments').select('*').eq('employee_id', id).order('payment_date', { ascending:true }),
      supabase.from('salary_advances').select('*').eq('employee_id', id).order('created_at', { ascending:false }),
    ])
    setEmp(e.data); setForm(e.data||{})
    setWorkDays(e.data?.work_days ? JSON.parse(e.data.work_days) : [])
    setJobs(j.data||[]); setEvals(ev.data||[])
    setPayments(p.data||[]); setAdvances(adv.data||[])
    setLoading(false)
  }

  const upd = (k,v) => setForm(f=>({...f,[k]:v}))
  const toggleDay = d => setWorkDays(w=>w.includes(d)?w.filter(x=>x!==d):[...w,d])

  const handleSave = async () => {
    const { error } = await supabase.from('employees').update({
      full_name:form.full_name, email:form.email, password:form.password,
      phone:form.phone, address:form.address, contract_type:form.contract_type,
      salary_type:form.salary_type, hourly_rate:parseFloat(form.hourly_rate)||0,
      fixed_salary:parseFloat(form.fixed_salary)||0, job_bonus_rate:parseFloat(form.job_bonus_rate)||0,
      contract_start:form.contract_start||null, contract_end:form.contract_end||null,
      advance_per_week:parseFloat(form.advance_per_week)||0,
      attendance_bonus:parseFloat(form.attendance_bonus)||0,
      transport_reimbursed:form.transport_reimbursed,
      bank_name:form.bank_name, bank_branch:form.bank_branch,
      account_type:form.account_type, account_number:form.account_number,
      account_holder_katakana:form.account_holder_katakana,
      notes:form.notes, work_days:JSON.stringify(workDays),
      hours_per_shift:parseFloat(form.hours_per_shift)||0,
      shifts_per_week:parseInt(form.shifts_per_week)||0,
      monthly_work_days:parseInt(form.monthly_work_days)||22,
    }).eq('id', id)
    if (error) return toast.error(error.message)
    toast.success('Saved!')
    setEditing(false); loadAll()
  }

  const handleAddEval = async () => {
    if (!evalForm.description) return toast.error('Add a description')
    const pts = evalForm.type==='positive' ? Math.abs(evalForm.points_change) : -Math.abs(evalForm.points_change)
    const newScore = Math.max(0, Math.min(100, (emp.score||100) + pts))
    await supabase.from('evaluations').insert({ employee_id:id, employee_name:emp.full_name, ...evalForm, points_change:pts })
    await supabase.from('employees').update({ score:newScore }).eq('id', id)
    toast.success(`Evaluation added! Score: ${newScore}`)
    setAddingEval(false)
    setEvalForm({ type:'positive', category:'Quality', points_change:5, stars:5, description:'', eval_date:new Date().toISOString().split('T')[0] })
    loadAll()
  }

  const handleDeleteEval = async (evalId, pts) => {
    await supabase.from('evaluations').delete().eq('id', evalId)
    const newScore = Math.max(0, Math.min(100, (emp.score||100) - pts))
    await supabase.from('employees').update({ score:newScore }).eq('id', id)
    toast('Evaluation removed.')
    loadAll()
  }

  const scoreColor = s => s>=90?'var(--green)':s>=70?'#EF9F27':'var(--red)'
  const statusColor = s => ({assigned:'badge-blue',in_progress:'badge-amber',completed:'badge-green',cancelled:'badge-red'}[s]||'badge-navy')
  const today = new Date().toISOString().split('T')[0]

  if (loading) return <div style={{color:'var(--text3)',padding:20}}>Loading...</div>
  if (!emp) return <div style={{color:'var(--text3)',padding:20}}>Employee not found</div>

  return (
    <div>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20}}>
        <button className="btn" onClick={()=>navigate('/employees')}>← Back</button>
        <div className="avatar" style={{width:44,height:44,fontSize:15,fontWeight:700,background:'#E6F1FB',color:'#185FA5',flexShrink:0}}>
          {emp.full_name?.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
        </div>
        <div>
          <h2 style={{fontSize:18,fontWeight:700,margin:0}}>{emp.full_name}</h2>
          <div style={{fontSize:12,color:'var(--text3)'}}>{emp.email} · {emp.contract_type}</div>
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
          <div style={{fontSize:28,fontWeight:800,color:scoreColor(emp.score||100)}}>{emp.score||100}</div>
          <span className={`badge ${emp.is_active?'badge-green':'badge-red'}`}>{emp.is_active?'Active':'Inactive'}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="tab-pills" style={{marginBottom:16}}>
        {[['overview','Overview'],['contract','📄 Contract'],['evaluations',`Evaluations (${evals.length})`],['jobs',`Jobs (${jobs.length})`],['salary','Salary'],['edit','Edit']].map(([k,l])=>(
          <button key={k} className={`tab-pill${tab===k?' active':''}`} onClick={()=>setTab(k)}>{l}</button>
        ))}
      </div>

      {/* OVERVIEW */}
      {tab==='overview'&&(
        <div className="grid-2" style={{gap:14}}>
          <div>
            {/* Score card */}
            <div className="card" style={{marginBottom:14,textAlign:'center',padding:'20px 18px'}}>
              <div style={{fontSize:56,fontWeight:700,color:scoreColor(emp.score||100),lineHeight:1}}>{emp.score||100}</div>
              <div style={{fontSize:12,color:'var(--text3)',marginTop:4}}>Performance Score</div>
              <div style={{height:8,background:'var(--surface2)',borderRadius:4,margin:'12px 0 4px',overflow:'hidden'}}>
                <div style={{height:'100%',width:(emp.score||100)+'%',background:scoreColor(emp.score||100),borderRadius:4,transition:'width 0.4s'}} />
              </div>
              <div style={{display:'flex',justifyContent:'center',gap:8,marginTop:8}}>
                <span className="badge badge-green">{evals.filter(e=>e.type==='positive').length} positive</span>
                <span className="badge badge-red">{evals.filter(e=>e.type==='complaint').length} complaints</span>
              </div>
            </div>

            {/* Contract summary */}
            <div className="card" style={{marginBottom:14}}>
              <div className="card-title">Contract</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                {[['Type',emp.contract_type],['Salary',emp.salary_type==='fixed'?`¥${Number(emp.fixed_salary||0).toLocaleString()}/mo`:emp.salary_type==='hourly'?`¥${emp.hourly_rate}/h`:'Mixed'],['Start',emp.contract_start||'—'],['End',emp.contract_end||'Open'],['Daily Rate',`¥${Math.round((emp.fixed_salary||0)/(emp.monthly_work_days||22)).toLocaleString()}`],['Work Days',emp.monthly_work_days||22]].map(([l,v])=>(
                  <div key={l} style={{background:'var(--surface2)',borderRadius:8,padding:'8px 10px'}}>
                    <div style={{fontSize:10,color:'var(--text3)',textTransform:'uppercase',letterSpacing:0.5}}>{l}</div>
                    <div style={{fontSize:13,fontWeight:500,marginTop:2}}>{v}</div>
                  </div>
                ))}
              </div>
              {JSON.parse(emp.work_days||'[]').length>0&&<div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:10}}>
                {DAYS.map(d=>{
                  const wd = JSON.parse(emp.work_days||'[]')
                  return <span key={d} style={{padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:500,background:wd.includes(d)?'var(--navy)':'var(--surface2)',color:wd.includes(d)?'#fff':'var(--text3)'}}>{d}</span>
                })}
              </div>}
            </div>

            {/* Bank details */}
            <div className="card">
              <div className="card-title">Bank Details</div>
              {emp.bank_name?<div style={{display:'grid',gap:6}}>
                {[['Bank',emp.bank_name],['Branch',emp.bank_branch||'—'],['Type',emp.account_type||'普通'],['Account No.',emp.account_number||'—'],['Holder',emp.account_holder_katakana||'—']].map(([l,v])=>(
                  <div key={l} style={{display:'flex',justifyContent:'space-between',fontSize:13,padding:'4px 0',borderBottom:'1px solid var(--border)'}}>
                    <span style={{color:'var(--text3)'}}>{l}</span><span style={{fontWeight:500}}>{v}</span>
                  </div>
                ))}
              </div>:<div style={{color:'var(--text3)',fontSize:13}}>No bank details added.</div>}
            </div>
          </div>

          <div>
            {/* Upcoming payments */}
            <div className="card" style={{marginBottom:14}}>
              <div className="card-title">Upcoming Payments</div>
              {payments.filter(p=>p.payment_date>=today).length===0&&<div style={{color:'var(--text3)',fontSize:13}}>No payments scheduled.</div>}
              {payments.filter(p=>p.payment_date>=today).map(p=>(
                <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
                  <div><div style={{fontWeight:500,fontSize:13,color:p.is_deduction?'var(--red)':'var(--text)'}}>{p.is_deduction?'-':'+'}¥{Number(p.amount).toLocaleString()}</div><div style={{fontSize:11,color:'var(--text3)'}}>{p.payment_date} · {p.description}</div></div>
                  <span className={`badge ${p.status==='paid'?'badge-green':p.is_deduction?'badge-red':'badge-blue'}`}>{p.payment_type||p.status}</span>
                </div>
              ))}
            </div>

            {/* Recent jobs */}
            <div className="card">
              <div className="card-title" style={{marginBottom:12}}>Recent Jobs</div>
              <RecentDays jobs={jobs.slice(0,30)} onDayClick={()=>setTab('jobs')} />
              <button className="btn btn-sm" style={{marginTop:10}} onClick={()=>setTab('jobs')}>View all →</button>
            </div>          </div>
        </div>
      )}

      {tab==='contract'&&(
        <ContractTab employeeId={id} employeeName={emp.full_name} emp={emp} onApplied={loadAll} />
      )}

      {/* EVALUATIONS */}
      {tab==='evaluations'&&(
        <div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <div style={{fontSize:14,fontWeight:600}}>Score: <span style={{color:scoreColor(emp.score||100),fontSize:20,fontWeight:800}}>{emp.score||100}</span>/100</div>
            <button className="btn btn-primary" onClick={()=>setAddingEval(!addingEval)}>+ Add Evaluation</button>
          </div>

          {addingEval&&(
            <div className="card" style={{marginBottom:16,border:'1px solid var(--navy)'}}>
              <div className="card-title">New Evaluation</div>
              <div className="grid-2">
                <div className="form-group">
                  <label>Type</label>
                  <select value={evalForm.type} onChange={e=>setEvalForm(f=>({...f,type:e.target.value}))}>
                    <option value="positive">✅ Positive (+points)</option>
                    <option value="complaint">❌ Complaint (-points)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Category</label>
                  <select value={evalForm.category} onChange={e=>setEvalForm(f=>({...f,category:e.target.value}))}>
                    {EVAL_CATEGORIES.map(c=><option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Points ({evalForm.type==='positive'?'+':'-'}{evalForm.points_change})</label>
                  <input type="number" value={evalForm.points_change} min={1} max={20} onChange={e=>setEvalForm(f=>({...f,points_change:parseInt(e.target.value)||5}))} />
                </div>
                <div className="form-group">
                  <label>Stars</label>
                  <div style={{display:'flex',gap:4,marginTop:4}}>
                    {[1,2,3,4,5].map(n=>(
                      <button key={n} onClick={()=>setEvalForm(f=>({...f,stars:n}))} style={{fontSize:22,background:'none',border:'none',cursor:'pointer',opacity:n<=evalForm.stars?1:0.3,padding:0}}>★</button>
                    ))}
                  </div>
                </div>
                <div className="form-group">
                  <label>Date</label>
                  <input type="date" value={evalForm.eval_date} onChange={e=>setEvalForm(f=>({...f,eval_date:e.target.value}))} />
                </div>
                <div className="form-group" style={{gridColumn:'1/-1'}}>
                  <label>Description *</label>
                  <textarea value={evalForm.description} onChange={e=>setEvalForm(f=>({...f,description:e.target.value}))} placeholder="Describe the evaluation..." />
                </div>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-primary" onClick={handleAddEval}>Save Evaluation</button>
                <button className="btn" onClick={()=>setAddingEval(false)}>Cancel</button>
              </div>
            </div>
          )}

          {evals.length===0&&<div className="card"><div style={{color:'var(--text3)',fontSize:13}}>No evaluations yet.</div></div>}
          {evals.map(ev=>(
            <div key={ev.id} className="card" style={{marginBottom:10,borderLeft:`3px solid ${ev.type==='positive'?'var(--green)':'var(--red)'}`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
                <div>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:2}}>
                    <span style={{fontWeight:600,fontSize:14}}>{ev.category}</span>
                    <span className={`badge ${ev.type==='positive'?'badge-green':'badge-red'}`}>{ev.points_change>0?'+':''}{ev.points_change} pts</span>
                  </div>
                  <div style={{color:'#EF9F27',fontSize:14}}>{'★'.repeat(ev.stars||0)}{'☆'.repeat(5-(ev.stars||0))}</div>
                </div>
                <div style={{display:'flex',gap:6,alignItems:'center'}}>
                  <span style={{fontSize:11,color:'var(--text3)'}}>{ev.eval_date}</span>
                  <button className="btn btn-sm btn-danger" onClick={()=>handleDeleteEval(ev.id,ev.points_change)}>✕</button>
                </div>
              </div>
              {ev.description&&<div style={{fontSize:13,color:'var(--text2)',background:'var(--surface2)',borderRadius:8,padding:'8px 10px'}}>{ev.description}</div>}
            </div>
          ))}
        </div>
      )}

      {/* JOBS */}
      {tab==='jobs'&&(
        <div>
          <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
            {[['All',jobs.length],['Done',jobs.filter(j=>j.status==='completed').length],['Upcoming',jobs.filter(j=>j.status==='assigned').length]].map(([l,n])=>(
              <div key={l} style={{background:'var(--surface2)',borderRadius:10,padding:'8px 14px',fontSize:13}}><span style={{color:'var(--text3)'}}>{l}: </span><strong>{n}</strong></div>
            ))}
          </div>
          {jobs.map(j=>(
            <div key={j.id} style={{padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
                <span style={{fontWeight:500,fontSize:13}}>{j.title.replace(/ — .*/,'')}</span>
                <div style={{display:'flex',gap:6,alignItems:'center'}}>
                  <span className={`badge ${statusColor(j.status)}`}>{j.status}</span>
                  {j.status==='assigned'&&<ReassignJob job={j} onDone={loadAll} />}
                </div>
              </div>
              <div style={{fontSize:11,color:'var(--text3)',display:'flex',gap:12,flexWrap:'wrap'}}>
                <span>{j.scheduled_date}</span>
                {j.started_at&&<span>▶ {new Date(j.started_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</span>}
                {j.completed_at&&<span>🏁 {new Date(j.completed_at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}</span>}
                {j.started_at&&j.completed_at&&<span>⏱ {Math.round((new Date(j.completed_at)-new Date(j.started_at))/60000)}m</span>}
                {j.checklist_total!=null&&<span style={{color:j.checklist_done<j.checklist_total?'var(--red)':'var(--green)'}}>✓ {j.checklist_done}/{j.checklist_total}</span>}
                {j.photo_ai_score!=null&&(
                  <span style={{color:j.photo_ai_approved?'var(--green)':'var(--red)'}}>
                    📷 IA: {j.photo_ai_score}/10 {j.photo_ai_approved?'✅':'❌'}
                  </span>
                )}
              </div>
              {j.photo_ai_issues&&(
                <div style={{fontSize:11,color:'var(--red)',marginTop:3}}>⚠️ {j.photo_ai_issues}</div>
              )}
              {j.photo_end_url&&(
                <div style={{display:'flex',gap:10,alignItems:'center',marginTop:2}}>
                  <a href={j.photo_end_url} target="_blank" rel="noreferrer" style={{fontSize:11,color:'var(--blue)'}}>Ver foto</a>
                  <button
                    onClick={()=>analyzePhoto(j)}
                    disabled={analyzingId===j.id}
                    style={{fontSize:11,color:'var(--text3)',background:'none',border:'1px solid var(--border)',borderRadius:6,padding:'2px 8px',cursor:analyzingId===j.id?'not-allowed':'pointer'}}
                  >
                    {analyzingId===j.id?'Analisando...':j.photo_ai_score!=null?'🔄 Reanalisar com IA':'📷 Analisar com IA'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* SALARY */}
      {tab==='salary'&&(
        <div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:14}}>
            {[['Fixed Salary',`¥${Number(emp.fixed_salary||0).toLocaleString()}`],['Daily Rate',`¥${Math.round((emp.fixed_salary||0)/(emp.monthly_work_days||22)).toLocaleString()}`],['Work Days/mo',emp.monthly_work_days||22],['Weekly Advance',`¥${Number(emp.advance_per_week||0).toLocaleString()}`],['Completion Bonus',`¥${Number(emp.attendance_bonus||0).toLocaleString()}`],['Transport',emp.transport_reimbursed?'✓ Yes':'✗ No']].map(([l,v])=>(
              <div key={l} style={{background:'var(--surface2)',borderRadius:10,padding:'10px 12px'}}>
                <div style={{fontSize:10,color:'var(--text3)',textTransform:'uppercase',letterSpacing:0.5}}>{l}</div>
                <div style={{fontSize:14,fontWeight:600,marginTop:3}}>{v}</div>
              </div>
            ))}
          </div>

          <div className="card" style={{marginBottom:14}}>
            <div className="card-title">Payment Schedule</div>
            {payments.length===0&&<div style={{color:'var(--text3)',fontSize:13}}>No payments.</div>}
            {payments.map(p=>(
              <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:p.is_deduction?'var(--red)':'var(--text)'}}>{p.is_deduction?'-':'+'}¥{Number(p.amount).toLocaleString()}</div>
                  <div style={{fontSize:11,color:'var(--text3)'}}>{p.payment_date} · {p.description}</div>
                </div>
                <span className={`badge ${p.status==='paid'?'badge-green':p.is_deduction?'badge-red':'badge-blue'}`}>{p.payment_type||p.status}</span>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-title">Advances</div>
            {advances.length===0&&<div style={{color:'var(--text3)',fontSize:13}}>No advances.</div>}
            {advances.map(a=>(
              <div key={a.id} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid var(--border)',fontSize:13}}>
                <span>{a.description}</span><span style={{fontWeight:600}}>¥{Number(a.amount).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* EDIT */}
      {tab==='edit'&&(
        <div className="card">
          <div className="card-title">Edit Profile</div>
          <div style={{fontSize:12,fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:0.5,marginBottom:10}}>Personal</div>
          <div className="grid-2">
            <div className="form-group"><label>Full Name</label><input value={form.full_name||''} onChange={e=>upd('full_name',e.target.value)} /></div>
            <div className="form-group"><label>Email</label><input value={form.email||''} onChange={e=>upd('email',e.target.value)} /></div>
            <div className="form-group"><label>Password</label><input value={form.password||''} onChange={e=>upd('password',e.target.value)} /></div>
            <div className="form-group"><label>Phone</label><input value={form.phone||''} onChange={e=>upd('phone',e.target.value)} /></div>
            <div className="form-group" style={{gridColumn:'1/-1'}}><label>Address</label><input value={form.address||''} onChange={e=>upd('address',e.target.value)} /></div>
          </div>
          <div style={{fontSize:12,fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:0.5,margin:'14px 0 10px',borderTop:'1px solid var(--border)',paddingTop:12}}>Contract</div>
          <div className="grid-2">
            <div className="form-group"><label>Contract Type</label><select value={form.contract_type||''} onChange={e=>upd('contract_type',e.target.value)}><option>Full-time</option><option>Part-time</option><option>Fixed-term</option><option>Hourly</option><option>Freelancer</option></select></div>
            <div className="form-group"><label>Salary Type</label><select value={form.salary_type||'fixed'} onChange={e=>upd('salary_type',e.target.value)}><option value="fixed">Fixed</option><option value="hourly">Hourly</option><option value="per_job">Per Job</option><option value="mixed">Mixed</option></select></div>
            <div className="form-group"><label>Monthly Salary (¥)</label><input type="number" value={form.fixed_salary||''} onChange={e=>upd('fixed_salary',e.target.value)} /></div>
            <div className="form-group"><label>Monthly Work Days</label><input type="number" value={form.monthly_work_days||22} onChange={e=>upd('monthly_work_days',e.target.value)} /></div>
            <div className="form-group"><label>Contract Start</label><input type="date" value={form.contract_start||''} onChange={e=>upd('contract_start',e.target.value)} /></div>
            <div className="form-group"><label>Contract End</label><input type="date" value={form.contract_end||''} onChange={e=>upd('contract_end',e.target.value)} /></div>
            <div className="form-group"><label>Hours/Shift</label><input type="number" value={form.hours_per_shift||''} onChange={e=>upd('hours_per_shift',e.target.value)} /></div>
            <div className="form-group"><label>Shifts/Week</label><input type="number" value={form.shifts_per_week||''} onChange={e=>upd('shifts_per_week',e.target.value)} /></div>
          </div>
          <div style={{fontSize:12,fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:0.5,margin:'14px 0 10px',borderTop:'1px solid var(--border)',paddingTop:12}}>Work Days</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
            {DAYS.map(d=>(
              <button key={d} onClick={()=>toggleDay(d)} type="button" style={{padding:'6px 14px',borderRadius:20,border:'1.5px solid',borderColor:workDays.includes(d)?'var(--navy)':'var(--border)',background:workDays.includes(d)?'var(--navy)':'none',color:workDays.includes(d)?'#fff':'var(--text2)',fontSize:13,fontWeight:500,cursor:'pointer'}}>
                {d}
              </button>
            ))}
          </div>
          <div style={{fontSize:12,fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:0.5,margin:'14px 0 10px',borderTop:'1px solid var(--border)',paddingTop:12}}>Extras</div>
          <div className="grid-2">
            <div className="form-group"><label>Weekly Advance (¥)</label><input type="number" value={form.advance_per_week||''} onChange={e=>upd('advance_per_week',e.target.value)} /></div>
            <div className="form-group"><label>Completion Bonus (¥)</label><input type="number" value={form.attendance_bonus||''} onChange={e=>upd('attendance_bonus',e.target.value)} /></div>
          </div>
          <div className="form-group"><label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}><input type="checkbox" checked={form.transport_reimbursed||false} onChange={e=>upd('transport_reimbursed',e.target.checked)} style={{width:16,height:16}} />Transport reimbursed</label></div>
          <div className="form-group"><label>Notes</label><textarea value={form.notes||''} onChange={e=>upd('notes',e.target.value)} /></div>
          <div style={{fontSize:12,fontWeight:600,color:'var(--text3)',textTransform:'uppercase',letterSpacing:0.5,margin:'14px 0 10px',borderTop:'1px solid var(--border)',paddingTop:12}}>Bank Details</div>
          <div className="grid-2">
            <div className="form-group"><label>Bank Name</label><input value={form.bank_name||''} onChange={e=>upd('bank_name',e.target.value)} /></div>
            <div className="form-group"><label>Branch</label><input value={form.bank_branch||''} onChange={e=>upd('bank_branch',e.target.value)} /></div>
            <div className="form-group"><label>Account Type</label><select value={form.account_type||'普通'} onChange={e=>upd('account_type',e.target.value)}><option value="普通">普通</option><option value="当座">当座</option></select></div>
            <div className="form-group"><label>Account No.</label><input value={form.account_number||''} onChange={e=>upd('account_number',e.target.value)} /></div>
            <div className="form-group" style={{gridColumn:'1/-1'}}><label>Holder (katakana)</label><input value={form.account_holder_katakana||''} onChange={e=>upd('account_holder_katakana',e.target.value)} /></div>
          </div>
          <div style={{display:'flex',gap:8,marginTop:8}}>
            <button className="btn btn-primary" onClick={handleSave}>✅ Save All</button>
            <button className="btn" onClick={()=>setTab('overview')}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
