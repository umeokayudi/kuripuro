import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

const POSITIVE_CATS = ['Excellent work', 'On time', 'Great attitude', 'Client praised', 'Extra effort', 'Perfect cleaning']
const COMPLAINT_CATS = ['Incomplete service', 'Lateness', 'Bad attitude', 'Property damage', 'Client complaint', 'No-show']
const POINTS = { positive: { 1:2, 2:3, 3:5, 4:8, 5:10 }, complaint: { 1:-2, 2:-3, 3:-5, 4:-8, 5:-10 } }

export default function Evaluations() {
  const [tab, setTab] = useState('new')
  const [employees, setEmployees] = useState([])
  const [jobs, setJobs] = useState([])
  const [evals, setEvals] = useState([])
  const [filterEmp, setFilterEmp] = useState('')
  const [form, setForm] = useState({ employee_id:'', job_id:'', type:'positive', stars:5, category:'', description:'' })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { loadEmployees(); loadEvals() }, [])
  useEffect(() => { if (form.employee_id) loadJobs(form.employee_id) }, [form.employee_id])

  const loadEmployees = async () => {
    const { data } = await supabase.from('employees').select('id,full_name,score,is_active').eq('is_active',true).order('full_name')
    setEmployees(data||[])
  }

  const loadJobs = async (empId) => {
    const { data } = await supabase.from('jobs').select('id,title,scheduled_date').eq('employee_id',empId).eq('status','completed').order('scheduled_date',{ascending:false}).limit(20)
    setJobs(data||[])
  }

  const loadEvals = async () => {
    const { data } = await supabase.from('evaluations').select('*').order('created_at',{ascending:false}).limit(100)
    setEvals(data||[])
  }

  const upd = (k,v) => setForm(f=>({...f,[k]:v}))

  const handleSubmit = async () => {
    if (!form.employee_id || !form.category) return toast.error('Select employee and category')
    setSubmitting(true)
    const pts = POINTS[form.type][form.stars]
    const emp = employees.find(e=>e.id===form.employee_id)
    const job = jobs.find(j=>j.id===form.job_id)
    const newScore = Math.min(100, Math.max(0, (emp?.score||100) + pts))

    const { error } = await supabase.from('evaluations').insert({
      employee_id: form.employee_id,
      employee_name: emp?.full_name,
      job_id: form.job_id || null,
      job_title: job?.title || null,
      type: form.type,
      stars: form.stars,
      points_change: pts,
      category: form.category,
      description: form.description,
      eval_date: new Date().toISOString().split('T')[0],
    })
    if (error) { toast.error(error.message); setSubmitting(false); return }

    await supabase.from('employees').update({ score: newScore }).eq('id', form.employee_id)

    if (form.type === 'positive') toast.success(`+${pts} pts to ${emp?.full_name}!`)
    else toast.error(`${pts} pts from ${emp?.full_name}`)

    setForm({ employee_id:'', job_id:'', type:'positive', stars:5, category:'', description:'' })
    loadEmployees(); loadEvals()
    setSubmitting(false)
  }

  const filtered = filterEmp ? evals.filter(e=>e.employee_id===filterEmp) : evals
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(5-n)

  return (
    <div>
      <div className="tab-pills">
        <button className={`tab-pill${tab==='new'?' active':''}`} onClick={()=>setTab('new')}>+ New Evaluation</button>
        <button className={`tab-pill${tab==='history'?' active':''}`} onClick={()=>setTab('history')}>History</button>
        <button className={`tab-pill${tab==='ranking'?' active':''}`} onClick={()=>setTab('ranking')}>🏆 Ranking</button>
      </div>

      {tab==='new' && (
        <div className="card">
          <div className="card-title">Evaluate Employee</div>

          {/* Type toggle */}
          <div style={{display:'flex',gap:8,marginBottom:16}}>
            <button onClick={()=>upd('type','positive')} style={{flex:1,padding:'10px',borderRadius:8,border:'2px solid',borderColor:form.type==='positive'?'var(--green)':'var(--border)',background:form.type==='positive'?'var(--green-bg)':'none',color:form.type==='positive'?'var(--green)':'var(--text2)',fontWeight:600,cursor:'pointer',fontSize:13}}>
              👍 Positive
            </button>
            <button onClick={()=>upd('type','complaint')} style={{flex:1,padding:'10px',borderRadius:8,border:'2px solid',borderColor:form.type==='complaint'?'var(--red)':'var(--border)',background:form.type==='complaint'?'var(--red-bg)':'none',color:form.type==='complaint'?'var(--red)':'var(--text2)',fontWeight:600,cursor:'pointer',fontSize:13}}>
              👎 Complaint
            </button>
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label>Employee</label>
              <select value={form.employee_id} onChange={e=>upd('employee_id',e.target.value)}>
                <option value="">Select...</option>
                {employees.map(e=><option key={e.id} value={e.id}>{e.full_name} (score: {e.score||100})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Related Job (optional)</label>
              <select value={form.job_id} onChange={e=>upd('job_id',e.target.value)}>
                <option value="">None</option>
                {jobs.map(j=><option key={j.id} value={j.id}>{j.title} — {j.scheduled_date}</option>)}
              </select>
            </div>
          </div>

          {/* Stars */}
          <div className="form-group">
            <label>Rating</label>
            <div style={{display:'flex',gap:8,marginTop:4}}>
              {[1,2,3,4,5].map(n=>(
                <button key={n} onClick={()=>upd('stars',n)} style={{fontSize:28,background:'none',border:'none',cursor:'pointer',color:n<=form.stars?'#EF9F27':'#ddd',padding:'0 2px'}}>★</button>
              ))}
              <span style={{fontSize:12,color:'var(--text3)',alignSelf:'center',marginLeft:4}}>
                {form.type==='positive'?`+${POINTS.positive[form.stars]} pts`:`${POINTS.complaint[form.stars]} pts`}
              </span>
            </div>
          </div>

          <div className="form-group">
            <label>Category</label>
            <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:4}}>
              {(form.type==='positive'?POSITIVE_CATS:COMPLAINT_CATS).map(c=>(
                <button key={c} onClick={()=>upd('category',c)} style={{padding:'5px 12px',borderRadius:20,border:'1px solid',borderColor:form.category===c?form.type==='positive'?'var(--green)':'var(--red)':'var(--border)',background:form.category===c?form.type==='positive'?'var(--green-bg)':'var(--red-bg)':'none',color:form.category===c?form.type==='positive'?'var(--green)':'var(--red)':'var(--text2)',fontSize:12,cursor:'pointer'}}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Description (optional)</label>
            <textarea value={form.description} onChange={e=>upd('description',e.target.value)} placeholder="Additional details..." />
          </div>

          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Saving...' : `Submit ${form.type==='positive'?'👍':'👎'} Evaluation`}
          </button>
        </div>
      )}

      {tab==='history' && (
        <div>
          <div className="card" style={{marginBottom:12}}>
            <div className="form-group" style={{marginBottom:0}}>
              <label>Filter by employee</label>
              <select value={filterEmp} onChange={e=>setFilterEmp(e.target.value)}>
                <option value="">All employees</option>
                {employees.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </div>
          </div>
          {filtered.map(e=>(
            <div key={e.id} className="card" style={{marginBottom:10}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'start',marginBottom:6}}>
                <div>
                  <div style={{fontWeight:600,fontSize:14}}>{e.employee_name}</div>
                  <div style={{fontSize:12,color:'var(--text3)'}}>{e.eval_date} {e.job_title && `· ${e.job_title}`}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{color:'#EF9F27',fontSize:16}}>{stars(e.stars||0)}</div>
                  <span className={`badge ${e.type==='positive'?'badge-green':'badge-red'}`}>
                    {e.points_change > 0 ? '+' : ''}{e.points_change} pts
                  </span>
                </div>
              </div>
              <span className={`badge ${e.type==='positive'?'badge-blue':'badge-amber'}`}>{e.category}</span>
              {e.description && <div style={{fontSize:12,color:'var(--text2)',marginTop:6}}>{e.description}</div>}
            </div>
          ))}
          {filtered.length===0 && <div className="card"><div style={{color:'var(--text3)',fontSize:13}}>No evaluations yet.</div></div>}
        </div>
      )}

      {tab==='ranking' && (
        <div className="card">
          <div className="card-title">🏆 Employee Ranking</div>
          {[...employees].sort((a,b)=>(b.score||100)-(a.score||100)).map((e,i)=>(
            <div key={e.id} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
              <div style={{width:28,height:28,borderRadius:'50%',background:i===0?'#EF9F27':i===1?'#aaa':i===2?'#cd7f32':'var(--surface2)',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:13,color:i<3?'#fff':'var(--text3)',flexShrink:0}}>
                {i+1}
              </div>
              <div style={{flex:1}}>
                <div style={{fontWeight:500,fontSize:14}}>{e.full_name}</div>
                <div style={{height:6,background:'var(--surface2)',borderRadius:3,marginTop:4,overflow:'hidden'}}>
                  <div style={{height:'100%',borderRadius:3,width:(e.score||100)+'%',background:(e.score||100)>=90?'var(--green)':(e.score||100)>=70?'#EF9F27':'var(--red)',transition:'width 0.4s'}} />
                </div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:20,fontWeight:700,color:(e.score||100)>=90?'var(--green)':(e.score||100)>=70?'#EF9F27':'var(--red)'}}>{e.score||100}</div>
                <div style={{fontSize:11,color:'var(--text3)'}}>score</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
