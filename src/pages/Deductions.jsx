import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { askConfirm, confirmAndRun } from '../components/ConfirmDialog'
import { isDeductionToReview, reviewText, approvePatch, rejectPatch } from '../lib/deductionReview'
import { tokyoToday } from '../lib/dates'

export default function Deductions() {
  const [employees, setEmployees] = useState([])
  const [history, setHistory] = useState([])
  const [form, setForm] = useState({ employee_id:'', amount:'', description:'', payment_date: tokyoToday(), deduction_type:'damage' })

  const TYPES = [
    { key:'damage', label:'Property Damage' },
    { key:'absence', label:'Unjustified Absence' },
    { key:'lateness', label:'Repeated Lateness' },
    { key:'equipment', label:'Equipment Loss' },
    { key:'advance', label:'Advance Deduction' },
    { key:'other', label:'Other' },
  ]

  useEffect(() => { load() }, [])

  const load = async () => {
    const [e, h] = await Promise.all([
      supabase.from('employees').select('id,full_name').eq('is_active',true).order('full_name'),
      supabase.from('salary_payments').select('*').eq('is_deduction',true).order('created_at',{ascending:false}).limit(60),
    ])
    setEmployees(e.data||[])
    setHistory(h.data||[])
  }

  const handleAdd = async () => {
    if (!form.employee_id||!form.amount||!form.description) return toast.error('Fill all fields')
    const emp = employees.find(e=>e.id===form.employee_id)
    const { error } = await supabase.from('salary_payments').insert({
      employee_id: form.employee_id,
      employee_name: emp?.full_name,
      period: form.payment_date.slice(0,7),
      amount: parseFloat(form.amount),
      payment_date: form.payment_date,
      description: `[${TYPES.find(t=>t.key===form.deduction_type)?.label}] ${form.description}`,
      status: 'scheduled',
      payment_type: 'deduction',
      is_deduction: true,
    })
    if (error) return toast.error(error.message)
    const { data: empScore } = await supabase.from('employees').select('score').eq('id', form.employee_id).maybeSingle()
    if (empScore) {
      const newScore = Math.max(0, (empScore.score || 100) - 5)
      await supabase.from('employees').update({ score: newScore }).eq('id', form.employee_id)
    }
    toast.success('Deduction added!')
    setForm({ employee_id:'', amount:'', description:'', payment_date:tokyoToday(), deduction_type:'damage' })
    load()
  }

  const handleDelete = (d) => confirmAndRun({
    title: 'Remove this deduction?', message: `${d.employee_name} · -¥${Number(d.amount).toLocaleString()}`,
    confirmLabel: 'Remove', danger: true, success: 'Deduction removed',
    run: () => supabase.from('salary_payments').delete().eq('id', d.id),
  }).then(ok => ok && load())

  // Automatic suggestions: a person decides before anything reaches the payslip.
  const review = async (d, approve) => {
    let amount = null
    if (approve) {
      const typed = await askConfirm({ title: 'Approve deduction', message: `${d.employee_name}\n${reviewText(d)}`, reason: true, reasonRequired: true, defaultReason: String(Number(d.amount)), confirmLabel: 'Approve (¥)' })
      if (!typed) return
      amount = Math.max(0, Math.round(Number(String(typed).replace(/[^\d.]/g, '')) || 0))
      if (!amount) return toast.error('Enter the amount in yen')
    } else if (!(await askConfirm({ title: 'Reject this suggestion?', message: reviewText(d), confirmLabel: 'Reject', danger: true }))) return
    const { error } = await supabase.from('salary_payments').update(approve ? approvePatch(d, amount) : rejectPatch(d)).eq('id', d.id)
    if (error) return toast.error(error.message)
    toast.success(approve ? 'Deduction approved' : 'Suggestion rejected')
    load()
  }
  const toReview = history.filter(isDeductionToReview)

  return (
    <div>
      <div className="card" style={{marginBottom:16}}>
        <div className="card-title">➖ New Deduction</div>
        <div className="grid-2">
          <div className="form-group">
            <label>Employee *</label>
            <select value={form.employee_id} onChange={e=>setForm(f=>({...f,employee_id:e.target.value}))}>
              <option value="">Select employee...</option>
              {employees.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Type *</label>
            <select value={form.deduction_type} onChange={e=>setForm(f=>({...f,deduction_type:e.target.value}))}>
              {TYPES.map(t=><option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Amount (¥) *</label>
            <input type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="e.g. 5000" />
          </div>
          <div className="form-group">
            <label>Date</label>
            <input type="date" value={form.payment_date} onChange={e=>setForm(f=>({...f,payment_date:e.target.value}))} />
          </div>
          <div className="form-group" style={{gridColumn:'1/-1'}}>
            <label>Description *</label>
            <input value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Reason for deduction..." />
          </div>
        </div>
        <button className="btn btn-danger" onClick={handleAdd}>➖ Apply Deduction</button>
      </div>

      {toReview.length>0&&(
        <div className="card" style={{marginBottom:16,border:'1px solid #f59e0b'}}>
          <div className="card-title">🤖 Automatic suggestions to review ({toReview.length})</div>
          <div style={{fontSize:12,color:'var(--text3)',marginBottom:8}}>From checklists not finished. They do not count in pay until approved.</div>
          {toReview.map(d=>(
            <div key={d.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'10px 0',borderBottom:'1px solid var(--border)',flexWrap:'wrap'}}>
              <div style={{minWidth:0}}>
                <div style={{fontWeight:500,fontSize:13}}>{d.employee_name} · suggested -¥{Number(d.amount).toLocaleString()}</div>
                <div style={{fontSize:11,color:'var(--text3)'}}>{d.payment_date} · {reviewText(d)}</div>
              </div>
              <div style={{display:'flex',gap:6}}>
                <button className="btn btn-sm" onClick={()=>review(d,false)}>✕ Reject</button>
                <button className="btn btn-sm btn-primary" onClick={()=>review(d,true)}>✓ Approve</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-title">History</div>
        {history.length===0&&<div style={{color:'var(--text3)',fontSize:13}}>No deductions yet.</div>}
        {history.filter(d=>!isDeductionToReview(d)).map(d=>(
          <div key={d.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
            <div>
              <div style={{fontWeight:500,fontSize:13}}>{d.employee_name}</div>
              <div style={{fontSize:12,color:'var(--red)',fontWeight:600}}>-¥{Number(d.amount).toLocaleString()}</div>
              <div style={{fontSize:11,color:'var(--text3)'}}>{d.payment_date} · {d.description}</div>
            </div>
            {d.status==='cancelled'?<span className="badge">{d.description?.startsWith('✕')?'Rejected':'Cancelled'}</span>:<button className="btn btn-sm btn-danger" onClick={()=>handleDelete(d)}>Remove</button>}
          </div>
        ))}
      </div>
    </div>
  )
}
