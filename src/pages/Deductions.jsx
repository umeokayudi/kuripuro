import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function Deductions() {
  const [employees, setEmployees] = useState([])
  const [history, setHistory] = useState([])
  const [form, setForm] = useState({ employee_id:'', amount:'', description:'', payment_date: new Date().toISOString().split('T')[0], deduction_type:'damage' })

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
      supabase.from('salary_payments').select('*').eq('is_deduction',true).order('created_at',{ascending:false}).limit(30),
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
    // Also deduct score
    await supabase.rpc || await supabase.from('employees').select('score').eq('id',form.employee_id).single().then(async ({data}) => {
      const newScore = Math.max(0,(data?.score||100)-5)
      await supabase.from('employees').update({score:newScore}).eq('id',form.employee_id)
    })
    toast.success('Deduction added!')
    setForm({ employee_id:'', amount:'', description:'', payment_date:new Date().toISOString().split('T')[0], deduction_type:'damage' })
    load()
  }

  const handleDelete = async (id) => {
    await supabase.from('salary_payments').delete().eq('id',id)
    toast('Deduction removed.')
    load()
  }

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

      <div className="card">
        <div className="card-title">History</div>
        {history.length===0&&<div style={{color:'var(--text3)',fontSize:13}}>No deductions yet.</div>}
        {history.map(d=>(
          <div key={d.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
            <div>
              <div style={{fontWeight:500,fontSize:13}}>{d.employee_name}</div>
              <div style={{fontSize:12,color:'var(--red)',fontWeight:600}}>-¥{Number(d.amount).toLocaleString()}</div>
              <div style={{fontSize:11,color:'var(--text3)'}}>{d.payment_date} · {d.description}</div>
            </div>
            <button className="btn btn-sm btn-danger" onClick={()=>handleDelete(d.id)}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  )
}
