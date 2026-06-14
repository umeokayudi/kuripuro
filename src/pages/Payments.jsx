import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function Payments() {
  const [employees, setEmployees] = useState([])
  const [payments, setPayments] = useState([])
  const [selected, setSelected] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ employee_id:'', employee_name:'', amount:'', payment_date:'', description:'', payment_type:'salary', is_deduction:false, status:'scheduled' })

  const TYPES = ['salary','advance','bonus','transport','deduction','other']

  useEffect(() => { load() }, [])

  const load = async () => {
    const [e, p] = await Promise.all([
      supabase.from('employees').select('id,full_name,fixed_salary,monthly_work_days').eq('is_active',true).order('full_name'),
      supabase.from('salary_payments').select('*').order('payment_date',{ascending:true}),
    ])
    setEmployees(e.data||[])
    setPayments(p.data||[])
  }

  const upd = (k,v) => setForm(f=>({...f,[k]:v}))

  const handleSave = async () => {
    if (!form.employee_id||!form.amount||!form.payment_date) return toast.error('Fill required fields')
    const emp = employees.find(e=>e.id===form.employee_id)
    const payload = { ...form, employee_name:emp?.full_name||form.employee_name, amount:parseFloat(form.amount), period:form.payment_date.slice(0,7) }
    if (editingId) {
      const { error } = await supabase.from('salary_payments').update(payload).eq('id',editingId)
      if (error) return toast.error(error.message)
      toast.success('Updated!')
    } else {
      const { error } = await supabase.from('salary_payments').insert(payload)
      if (error) return toast.error(error.message)
      toast.success('Payment added!')
    }
    setShowForm(false); setEditingId(null)
    setForm({ employee_id:'', employee_name:'', amount:'', payment_date:'', description:'', payment_type:'salary', is_deduction:false, status:'scheduled' })
    load()
  }

  const handleEdit = (p) => {
    setForm({ employee_id:p.employee_id||'', employee_name:p.employee_name||'', amount:p.amount||'', payment_date:p.payment_date||'', description:p.description||'', payment_type:p.payment_type||'salary', is_deduction:p.is_deduction||false, status:p.status||'scheduled' })
    setEditingId(p.id); setShowForm(true)
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete?')) return
    await supabase.from('salary_payments').delete().eq('id',id)
    toast('Deleted.'); load()
  }

  const handleMarkPaid = async (id) => {
    await supabase.from('salary_payments').update({status:'paid'}).eq('id',id)
    toast.success('Marked as paid!'); load()
  }

  const handleAutoGenerate = async (emp) => {
    const month = new Date().toISOString().slice(0,7)
    const dailyRate = Math.round((emp.fixed_salary||0)/(emp.monthly_work_days||22))
    const existing = payments.filter(p=>p.employee_id===emp.id&&p.payment_date?.startsWith(month))
    if (existing.length>0) { if (!confirm(`${existing.length} payments already exist for ${month}. Continue?`)) return }
    toast('Generating payments...', {duration:2000})
  }

  const fmt = n => '¥'+Number(n||0).toLocaleString()
  const today = new Date().toISOString().split('T')[0]
  const filteredPayments = selected ? payments.filter(p=>p.employee_id===selected) : payments
  const pending = filteredPayments.filter(p=>p.status!=='paid'&&!p.is_deduction)
  const totalPending = pending.reduce((s,p)=>s+Number(p.amount||0),0)

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <h2 style={{fontSize:18,fontWeight:700,margin:0}}>Payments</h2>
        <div style={{display:'flex',gap:8}}>
          <button className="btn" onClick={()=>{setEditingId(null);setForm({employee_id:'',employee_name:'',amount:'',payment_date:'',description:'',payment_type:'salary',is_deduction:false,status:'scheduled'});setShowForm(!showForm)}}>+ Add Payment</button>
        </div>
      </div>

      {/* Employee filter */}
      <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
        <button onClick={()=>setSelected(null)} style={{padding:'6px 14px',borderRadius:20,border:'1px solid',borderColor:!selected?'var(--gold)':'var(--border)',background:!selected?'rgba(193,156,86,0.1)':'none',color:!selected?'var(--gold)':'var(--text3)',fontSize:12,cursor:'pointer'}}>All</button>
        {employees.map(e=>(
          <button key={e.id} onClick={()=>setSelected(e.id)} style={{padding:'6px 14px',borderRadius:20,border:'1px solid',borderColor:selected===e.id?'var(--gold)':'var(--border)',background:selected===e.id?'rgba(193,156,86,0.1)':'none',color:selected===e.id?'var(--gold)':'var(--text3)',fontSize:12,cursor:'pointer'}}>{e.full_name.split(' ')[0]}</button>
        ))}
      </div>

      {/* Summary */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:16}}>
        {[['Pending',fmt(totalPending),'var(--amber)'],['Paid this month',fmt(filteredPayments.filter(p=>p.status==='paid'&&p.payment_date?.startsWith(new Date().toISOString().slice(0,7))).reduce((s,p)=>s+Number(p.amount||0),0)),'var(--green)'],['Total entries',filteredPayments.length,'var(--blue)']].map(([l,v,c])=>(
          <div key={l} className="card" style={{textAlign:'center',padding:14}}>
            <div style={{fontSize:20,fontWeight:700,color:c,marginBottom:3}}>{v}</div>
            <div style={{fontSize:11,color:'var(--text3)'}}>{l}</div>
          </div>
        ))}
      </div>

      {showForm&&(
        <div className="card" style={{marginBottom:16,border:'1px solid rgba(193,156,86,0.2)'}}>
          <div style={{fontWeight:600,fontSize:15,marginBottom:14,color:'var(--gold)'}}>{editingId?'Edit Payment':'New Payment'}</div>
          <div className="grid-2">
            <div className="form-group"><label>Employee *</label>
              <select value={form.employee_id} onChange={e=>upd('employee_id',e.target.value)}>
                <option value="">Select...</option>
                {employees.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Type</label>
              <select value={form.payment_type} onChange={e=>upd('payment_type',e.target.value)}>
                {TYPES.map(t=><option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Amount (¥) *</label><input type="number" value={form.amount} onChange={e=>upd('amount',e.target.value)} /></div>
            <div className="form-group"><label>Payment Date *</label><input type="date" value={form.payment_date} onChange={e=>upd('payment_date',e.target.value)} /></div>
            <div className="form-group" style={{gridColumn:'1/-1'}}><label>Description</label><input value={form.description} onChange={e=>upd('description',e.target.value)} placeholder="e.g. June salary final payment" /></div>
            <div className="form-group"><label>Status</label>
              <select value={form.status} onChange={e=>upd('status',e.target.value)}>
                {['scheduled','paid','cancelled'].map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group"><label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',marginTop:20}}><input type="checkbox" checked={form.is_deduction} onChange={e=>upd('is_deduction',e.target.checked)} style={{width:16,height:16}} />Is Deduction</label></div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-primary" onClick={handleSave}>{editingId?'✅ Update':'✅ Add'}</button>
            <button className="btn" onClick={()=>{setShowForm(false);setEditingId(null)}}>Cancel</button>
          </div>
        </div>
      )}

      {/* Payments grouped by employee */}
      {(selected ? employees.filter(e=>e.id===selected) : employees).map(emp=>{
        const empPayments = filteredPayments.filter(p=>p.employee_id===emp.id).sort((a,b)=>a.payment_date?.localeCompare(b.payment_date||'')||0)
        if (empPayments.length===0&&selected!==emp.id) return null
        const empPending = empPayments.filter(p=>p.status!=='paid'&&!p.is_deduction).reduce((s,p)=>s+Number(p.amount||0),0)
        return (
          <div key={emp.id} className="card" style={{marginBottom:14}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <div>
                <div style={{fontWeight:600,fontSize:15}}>{emp.full_name}</div>
                <div style={{fontSize:12,color:'var(--text3)'}}>{fmt(emp.fixed_salary||0)}/mo · {emp.monthly_work_days||22} days</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:14,fontWeight:700,color:'var(--amber)'}}>{fmt(empPending)} pending</div>
              </div>
            </div>
            {empPayments.map(p=>(
              <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',borderBottom:'1px solid var(--border)'}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:500,color:p.is_deduction?'var(--red)':'var(--text)'}}>{p.is_deduction?'-':'+'}¥{Number(p.amount||0).toLocaleString()}</div>
                  <div style={{fontSize:11,color:'var(--text3)',marginTop:1}}>{p.payment_date} · {p.description||p.payment_type}</div>
                </div>
                <div style={{display:'flex',gap:6,alignItems:'center'}}>
                  <span style={{fontSize:9,padding:'2px 8px',borderRadius:20,fontWeight:600,background:p.status==='paid'?'rgba(74,222,128,0.1)':p.is_deduction?'rgba(248,113,113,0.1)':'rgba(251,191,36,0.1)',color:p.status==='paid'?'var(--green)':p.is_deduction?'var(--red)':'var(--amber)',border:'1px solid rgba(255,255,255,0.06)'}}>{p.payment_type||p.status}</span>
                  {p.status!=='paid'&&!p.is_deduction&&<button className="btn btn-sm" style={{fontSize:10,background:'rgba(74,222,128,0.1)',color:'var(--green)',borderColor:'rgba(74,222,128,0.2)'}} onClick={()=>handleMarkPaid(p.id)}>✓ Pay</button>}
                  <button className="btn btn-sm" style={{fontSize:10}} onClick={()=>handleEdit(p)}>✏️</button>
                  <button className="btn btn-sm btn-danger" style={{fontSize:10}} onClick={()=>handleDelete(p.id)}>✕</button>
                </div>
              </div>
            ))}
            {empPayments.length===0&&<div style={{color:'var(--text3)',fontSize:13}}>No payments.</div>}
          </div>
        )
      })}
    </div>
  )
}
