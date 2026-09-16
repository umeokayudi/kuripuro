import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import toast from 'react-hot-toast'
import { tokyoToday } from '../lib/dates'

export default function Deductions() {
  const { t } = useLang()
  const d = t.deductDesk
  const [employees, setEmployees] = useState([])
  const [history, setHistory] = useState([])
  const [form, setForm] = useState({ employee_id:'', amount:'', description:'', payment_date: tokyoToday(), deduction_type:'damage', affectScore: true })

  const TYPES = [
    { key:'damage', label:d.damage },
    { key:'absence', label:d.absence },
    { key:'lateness', label:d.lateness },
    { key:'equipment', label:d.equipment },
    { key:'advance', label:d.advance },
    { key:'other', label:d.other },
  ]

  useEffect(() => { load() }, [])

  const load = async () => {
    const [e, h] = await Promise.all([
      supabase.from('employees').select('id,full_name,is_active').order('full_name'),
      supabase.from('salary_payments').select('*').eq('is_deduction',true).order('created_at',{ascending:false}).limit(30),
    ])
    setEmployees(e.data||[])
    setHistory(h.data||[])
  }

  const handleAdd = async () => {
    if (!form.employee_id||!form.amount||!form.description) return toast.error(d.fillAll)
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
    const affectScore = form.deduction_type !== 'advance' && form.affectScore
    if (affectScore) {
      const { data: empScore } = await supabase.from('employees').select('score').eq('id', form.employee_id).maybeSingle()
      if (empScore) {
        const newScore = Math.max(0, (empScore.score || 100) - 5)
        await supabase.from('employees').update({ score: newScore }).eq('id', form.employee_id)
      }
    }
    toast.success(d.added)
    setForm({ employee_id:'', amount:'', description:'', payment_date: tokyoToday(), deduction_type:'damage', affectScore: true })
    load()
  }

  const handleDelete = async (id) => {
    await supabase.from('salary_payments').delete().eq('id',id)
    toast(d.removed)
    load()
  }

  return (
    <div>
      <div className="card" style={{marginBottom:16}}>
        <div className="card-title">➖ {d.newTitle}</div>
        <div className="grid-2">
          <div className="form-group">
            <label>{d.employee} *</label>
            <select value={form.employee_id} onChange={e=>setForm(f=>({...f,employee_id:e.target.value}))}>
              <option value="">{d.select}</option>
              {employees.map(e=><option key={e.id} value={e.id}>{e.full_name}{e.is_active ? '' : ' (off)'}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>{d.type} *</label>
            <select value={form.deduction_type} onChange={e=>setForm(f=>({...f,deduction_type:e.target.value, affectScore: e.target.value !== 'advance'}))}>
              {TYPES.map(t=><option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>{d.amount} *</label>
            <input type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} />
          </div>
          <div className="form-group">
            <label>{d.date}</label>
            <input type="date" value={form.payment_date} onChange={e=>setForm(f=>({...f,payment_date:e.target.value}))} />
          </div>
          <div className="form-group" style={{gridColumn:'1/-1'}}>
            <label>{d.description} *</label>
            <input value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} />
          </div>
        </div>
        {form.deduction_type !== 'advance' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.affectScore} onChange={e => setForm(f => ({ ...f, affectScore: e.target.checked }))} />
            {d.reduceScore}
          </label>
        )}
        <button className="btn btn-danger" onClick={handleAdd}>➖ {d.apply}</button>
      </div>

      <div className="card">
        <div className="card-title">{d.history}</div>
        {history.length===0&&<div style={{color:'var(--text3)',fontSize:13}}>{d.empty}</div>}
        {history.map(row=>(
          <div key={row.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
            <div>
              <div style={{fontWeight:500,fontSize:13}}>{row.employee_name}</div>
              <div style={{fontSize:12,color:'var(--red)',fontWeight:600}}>-¥{Number(row.amount).toLocaleString()}</div>
              <div style={{fontSize:11,color:'var(--text3)'}}>{row.payment_date} · {row.description}</div>
            </div>
            <button className="btn btn-sm btn-danger" onClick={()=>handleDelete(row.id)}>{d.remove}</button>
          </div>
        ))}
      </div>
    </div>
  )
}
