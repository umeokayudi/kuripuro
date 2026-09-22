import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useLang, fill } from '../hooks/useLang'
import { useConfirm } from '../hooks/useConfirm'
import toast from 'react-hot-toast'
import { tokyoToday, tokyoYearMonth } from '../lib/dates'
import { plannedWeeklyAdvances, isDeductionRow } from '../lib/salaryCalc'

export default function Payments() {
  const { t } = useLang()
  const confirm = useConfirm()
  const desk = t.salaryDesk
  const p = t.payDesk
  const [employees, setEmployees] = useState([])
  const [payments, setPayments] = useState([])
  const [selected, setSelected] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const emptyForm = { employee_id:'', employee_name:'', amount:'', payment_date: tokyoToday(), description:'', payment_type:'salary', is_deduction:false, status:'scheduled' }
  const [form, setForm] = useState(emptyForm)

  const TYPES = ['salary','advance','bonus','extra','deduction']

  useEffect(() => { load() }, [])

  const load = async () => {
    const [e, pay] = await Promise.all([
      supabase.from('employees').select('id,full_name,fixed_salary,monthly_work_days,advance_per_week,is_active').order('full_name'),
      supabase.from('salary_payments').select('*').order('payment_date',{ascending:true}),
    ])
    setEmployees(e.data||[])
    setPayments(pay.data||[])
  }

  const upd = (k,v) => setForm(f => {
    const next = { ...f, [k]: v }
    if (k === 'payment_type') next.is_deduction = v === 'deduction'
    return next
  })

  const handleSave = async () => {
    if (!form.employee_id||!form.amount||!form.payment_date) return toast.error(desk.enterAmount)
    const emp = employees.find(e=>e.id===form.employee_id)
    const payload = {
      ...form,
      employee_name:emp?.full_name||form.employee_name,
      amount:parseFloat(form.amount),
      period:form.payment_date.slice(0,7),
      is_deduction: form.payment_type === 'deduction' || !!form.is_deduction,
    }
    if (editingId) {
      const { error } = await supabase.from('salary_payments').update(payload).eq('id',editingId)
      if (error) return toast.error(error.message)
      toast.success(p.updated)
    } else {
      const { error } = await supabase.from('salary_payments').insert(payload)
      if (error) return toast.error(error.message)
      toast.success(p.added)
    }
    setShowForm(false); setEditingId(null)
    setForm(emptyForm)
    load()
  }

  const handleEdit = (row) => {
    setForm({ employee_id:row.employee_id||'', employee_name:row.employee_name||'', amount:row.amount||'', payment_date:row.payment_date||'', description:row.description||'', payment_type:row.payment_type||'salary', is_deduction:row.is_deduction||false, status:row.status||'scheduled' })
    setEditingId(row.id); setShowForm(true)
  }

  const handleDelete = async (id) => {
    if (!(await confirm({ title: t.dialog.delete, message: p.deleteConfirm, tone: 'danger', confirmLabel: t.dialog.delete }))) return
    await supabase.from('salary_payments').delete().eq('id',id)
    toast(p.deleted); load()
  }

  const handleMarkPaid = async (id) => {
    const { error } = await supabase.from('salary_payments').update({status:'paid'}).eq('id',id)
    if (error) return toast.error(error.message)
    toast.success(p.markedPaid); load()
  }

  const handleAutoGenerate = async (emp) => {
    const month = tokyoYearMonth()
    const drafts = plannedWeeklyAdvances(emp, month, payments.filter(row => row.employee_id === emp.id && row.payment_type === 'advance' && row.period === month))
    if (!drafts.length) return toast(desk.weeklyNone)
    if (!(await confirm({ title: desk.weeklyAdvances ? fill(desk.weeklyAdvances, { n: drafts.length }) : t.dialog.confirmTitle, message: fill(desk.weeklyAdvances, { n: drafts.length }), tone: 'primary', confirmLabel: t.dialog.continue }))) return
    const rows = drafts.map(d => ({ ...d, employee_id: emp.id, employee_name: emp.full_name, period: month }))
    const { error } = await supabase.from('salary_payments').insert(rows)
    if (error) return toast.error(error.message)
    toast.success(fill(desk.weeklyDone, { n: rows.length }))
    load()
  }

  const fmt = n => '¥'+Number(n||0).toLocaleString()
  const month = tokyoYearMonth()
  const filteredPayments = selected ? payments.filter(row=>row.employee_id===selected) : payments
  const pending = filteredPayments.filter(row=>row.status!=='paid'&&!isDeductionRow(row))
  const totalPending = pending.reduce((s,row)=>s+Number(row.amount||0),0)

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <h2 className="page-head" style={{margin:0,fontSize:22}}>{t.sidebar.payments}</h2>
        <div style={{display:'flex',gap:8}}>
          <button className="btn" onClick={()=>{setEditingId(null);setForm({...emptyForm});setShowForm(!showForm)}}>{p.add}</button>
        </div>
      </div>

      <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
        <button onClick={()=>setSelected(null)} style={{padding:'6px 14px',borderRadius:20,border:'1px solid',borderColor:!selected?'var(--gold)':'var(--border)',background:!selected?'rgba(193,156,86,0.1)':'none',color:!selected?'var(--gold)':'var(--text3)',fontSize:12,cursor:'pointer'}}>{p.all}</button>
        {employees.map(emp=>(
          <button key={emp.id} onClick={()=>setSelected(emp.id)} style={{padding:'6px 14px',borderRadius:20,border:'1px solid',borderColor:selected===emp.id?'var(--gold)':'var(--border)',background:selected===emp.id?'rgba(193,156,86,0.1)':'none',color:selected===emp.id?'var(--gold)':'var(--text3)',fontSize:12,cursor:'pointer'}}>{emp.full_name.split(' ')[0]}</button>
        ))}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:16}}>
        {[[p.pending,fmt(totalPending),'var(--amber)'],[p.paidMonth,fmt(filteredPayments.filter(row=>row.status==='paid'&&row.payment_date?.startsWith(month)).reduce((s,row)=>s+Number(row.amount||0),0)),'var(--green)'],[p.totalEntries,filteredPayments.length,'var(--blue)']].map(([l,v,c])=>(
          <div key={l} className="card" style={{textAlign:'center',padding:14}}>
            <div style={{fontSize:20,fontWeight:700,color:c,marginBottom:3}}>{v}</div>
            <div style={{fontSize:11,color:'var(--text3)'}}>{l}</div>
          </div>
        ))}
      </div>

      {showForm&&(
        <div className="card" style={{marginBottom:16,border:'1px solid rgba(193,156,86,0.2)'}}>
          <div style={{fontWeight:600,fontSize:15,marginBottom:14,color:'var(--gold)'}}>{editingId?p.edit:p.new}</div>
          <div className="grid-2">
            <div className="form-group"><label>{p.employee} *</label>
              <select value={form.employee_id} onChange={e=>upd('employee_id',e.target.value)}>
                <option value="">{p.select}</option>
                {employees.map(emp=><option key={emp.id} value={emp.id}>{emp.full_name}</option>)}
              </select>
            </div>
            <div className="form-group"><label>{p.type}</label>
              <select value={form.payment_type} onChange={e=>upd('payment_type',e.target.value)}>
                {TYPES.map(type=><option key={type}>{type}</option>)}
              </select>
            </div>
            <div className="form-group"><label>{p.amount} *</label><input type="number" value={form.amount} onChange={e=>upd('amount',e.target.value)} /></div>
            <div className="form-group"><label>{p.date} *</label><input type="date" value={form.payment_date} onChange={e=>upd('payment_date',e.target.value)} /></div>
            <div className="form-group" style={{gridColumn:'1/-1'}}><label>{p.description}</label><input value={form.description} onChange={e=>upd('description',e.target.value)} placeholder={p.placeholder} /></div>
            <div className="form-group"><label>{p.status}</label>
              <select value={form.status} onChange={e=>upd('status',e.target.value)}>
                {['scheduled','paid','cancelled'].map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group"><label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',marginTop:20}}><input type="checkbox" checked={form.is_deduction} onChange={e=>upd('is_deduction',e.target.checked)} style={{width:16,height:16}} />{p.deductionFlag}</label></div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-primary" onClick={handleSave}>{editingId?p.update:p.save}</button>
            <button className="btn" onClick={()=>{setShowForm(false);setEditingId(null)}}>{p.cancel}</button>
          </div>
        </div>
      )}

      {(selected ? employees.filter(emp=>emp.id===selected) : employees).map(emp=>{
        const empPayments = filteredPayments.filter(row=>row.employee_id===emp.id).sort((a,b)=>a.payment_date?.localeCompare(b.payment_date||'')||0)
        if (empPayments.length===0&&selected!==emp.id) return null
        const empPending = empPayments.filter(row=>row.status!=='paid'&&!isDeductionRow(row)).reduce((s,row)=>s+Number(row.amount||0),0)
        const weeklyN = Number(emp.advance_per_week) > 0
          ? plannedWeeklyAdvances(emp, month, empPayments.filter(row=>row.payment_type==='advance')).length
          : 0
        return (
          <div key={emp.id} className="card" style={{marginBottom:14}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12,gap:8,flexWrap:'wrap'}}>
              <div>
                <div style={{fontWeight:600,fontSize:15}}>{emp.full_name}</div>
                <div style={{fontSize:12,color:'var(--text3)'}}>{fmt(emp.fixed_salary||0)}/mo · {fill(desk.days, { n: emp.monthly_work_days||22 })}</div>
              </div>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                {weeklyN > 0 && (
                  <button className="btn btn-sm" onClick={()=>handleAutoGenerate(emp)}>
                    {fill(desk.weeklyAdvances, { n: weeklyN })}
                  </button>
                )}
                <div style={{fontSize:14,fontWeight:700,color:'var(--amber)'}}>{fmt(empPending)} {p.pending}</div>
              </div>
            </div>
            {empPayments.map(row=>(
              <div key={row.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',borderBottom:'1px solid var(--border)'}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:500,color:isDeductionRow(row)?'var(--red)':'var(--text)'}}>{isDeductionRow(row)?'-':'+'}¥{Number(row.amount||0).toLocaleString()}</div>
                  <div style={{fontSize:11,color:'var(--text3)',marginTop:1}}>{row.payment_date} · {row.description||row.payment_type}</div>
                </div>
                <div style={{display:'flex',gap:6,alignItems:'center'}}>
                  <span style={{fontSize:9,padding:'2px 8px',borderRadius:20,fontWeight:600,background:row.status==='paid'?'rgba(74,222,128,0.1)':isDeductionRow(row)?'rgba(248,113,113,0.1)':'rgba(251,191,36,0.1)',color:row.status==='paid'?'var(--green)':isDeductionRow(row)?'var(--red)':'var(--amber)',border:'1px solid rgba(255,255,255,0.06)'}}>{row.payment_type||row.status}</span>
                  {row.status!=='paid'&&!isDeductionRow(row)&&<button className="btn btn-sm" style={{fontSize:10,background:'rgba(74,222,128,0.1)',color:'var(--green)',borderColor:'rgba(74,222,128,0.2)'}} onClick={()=>handleMarkPaid(row.id)}>✓ {p.pay}</button>}
                  <button className="btn btn-sm" style={{fontSize:10}} onClick={()=>handleEdit(row)}>✏️</button>
                  <button className="btn btn-sm btn-danger" style={{fontSize:10}} onClick={()=>handleDelete(row.id)}>✕</button>
                </div>
              </div>
            ))}
            {empPayments.length===0&&<div style={{color:'var(--text3)',fontSize:13}}>{p.noPayments}</div>}
          </div>
        )
      })}
    </div>
  )
}
