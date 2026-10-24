import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useLang } from '../hooks/useLang'
import toast from 'react-hot-toast'
import { fmtPeriod } from '../lib/salaryPeriod'
import '../components/SalaryPopups.css'

// What the employee did with the payslip of a salary row's period.
function statementState(st) {
  if (!st) return 'none'
  if (st.employee_confirmed_at) return 'confirmed'
  if (st.employee_disputed_at || st.status === 'disputed') return 'disputed'
  return 'waiting'
}

export default function Payments() {
  const { t, tr, locale } = useLang()
  const [employees, setEmployees] = useState([])
  const [payments, setPayments] = useState([])
  const [statements, setStatements] = useState([])
  const [ask, setAsk] = useState(null) // { kind: 'pay' | 'delete', p }
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ employee_id:'', employee_name:'', amount:'', payment_date:'', description:'', payment_type:'salary', is_deduction:false, status:'scheduled' })

  // Same list as the salary_payments check constraint.
  const TYPES = ['salary','advance','bonus','deduction','extra']

  useEffect(() => { load() }, [])

  const load = async () => {
    const [e, p, st] = await Promise.all([
      supabase.from('employees').select('id,full_name,fixed_salary,monthly_work_days').eq('is_active',true).order('full_name'),
      supabase.from('salary_payments').select('*').order('payment_date',{ascending:true}),
      supabase.from('salary_statements').select('id,employee_id,period,status,net_total,employee_confirmed_at,employee_disputed_at'),
    ])
    setEmployees(e.data||[])
    setPayments(p.data||[])
    setStatements(st.data||[])
  }

  const upd = (k,v) => setForm(f=>({...f,[k]:v}))

  const handleSave = async () => {
    if (!form.employee_id||!form.amount||!form.payment_date) return toast.error('Fill required fields')
    const emp = employees.find(e=>e.id===form.employee_id)
    // A salary row belongs to the month worked, not the month it is paid in: keep its period on edit.
    const before = editingId ? payments.find(p=>p.id===editingId) : null
    const period = before?.period && form.payment_type==='salary' ? before.period : form.payment_date.slice(0,7)
    const payload = { ...form, employee_name:emp?.full_name||form.employee_name, amount:parseFloat(form.amount), period }
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

  const statementFor = (p) => statements.find(st=>st.employee_id===p.employee_id&&st.period===(p.period||p.payment_date?.slice(0,7)))

  // Both actions go through the pop-up below; salary rows cannot be deleted at all.
  const doConfirmed = async () => {
    if (!ask) return
    setBusy(true)
    const { kind, p } = ask
    const { error } = kind==='pay'
      ? await supabase.from('salary_payments').update({status:'paid'}).eq('id',p.id)
      : await supabase.from('salary_payments').delete().eq('id',p.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(kind==='pay' ? tr('Marked as paid','支払済みにしました','Marcado como pago') : tr('Deleted','削除しました','Apagado'))
    setAsk(null); load()
  }

  const stateLabel = {
    confirmed: tr('Employee confirmed the payslip','従業員が明細を確認済み','Funcionário confirmou o holerite'),
    disputed: tr('Employee disputed the payslip','従業員が明細に異議あり','Funcionário contestou o holerite'),
    waiting: tr('Employee has not confirmed yet','従業員はまだ確認していません','Funcionário ainda não confirmou'),
    none: tr('No payslip sent for this month','この月の明細は未送付','Holerite deste mês não foi enviado'),
  }
  const stateShort = {
    confirmed: tr('✓ Confirmed','✓ 確認済','✓ Confirmado'),
    disputed: tr('⚠ Disputed','⚠ 異議','⚠ Contestado'),
    waiting: tr('⏳ Not confirmed','⏳ 未確認','⏳ Não confirmou'),
    none: tr('No payslip','明細なし','Sem holerite'),
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
        <h2 className="page-head" style={{margin:0,fontSize:22}}>{t.sidebar.payments}</h2>
        <div style={{display:'flex',gap:8}}>
          <button className="btn" onClick={()=>{setEditingId(null);setForm({employee_id:'',employee_name:'',amount:'',payment_date:'',description:'',payment_type:'salary',is_deduction:false,status:'scheduled'});setShowForm(!showForm)}}>+ Add Payment</button>
        </div>
      </div>

      {/* Employee filter */}
      <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
        <button onClick={()=>setSelected(null)} style={{padding:'6px 14px',borderRadius:20,border:'1px solid',borderColor:!selected?'var(--gold)':'var(--border)',background:!selected?'#eef3ff':'none',color:!selected?'var(--gold)':'var(--text3)',fontSize:12,cursor:'pointer'}}>All</button>
        {employees.map(e=>(
          <button key={e.id} onClick={()=>setSelected(e.id)} style={{padding:'6px 14px',borderRadius:20,border:'1px solid',borderColor:selected===e.id?'var(--gold)':'var(--border)',background:selected===e.id?'#eef3ff':'none',color:selected===e.id?'var(--gold)':'var(--text3)',fontSize:12,cursor:'pointer'}}>{e.full_name.split(' ')[0]}</button>
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
        <div className="card" style={{marginBottom:16,border:'1px solid #d7e0ff'}}>
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
                  {p.payment_type==='salary'&&(()=>{const k=statementState(statementFor(p));return <span className={`pay-st is-${k}`} title={stateLabel[k]}>{stateShort[k]}</span>})()}
                  {p.status!=='paid'&&!p.is_deduction&&<button className="btn btn-sm" style={{fontSize:10,background:'rgba(74,222,128,0.1)',color:'var(--green)',borderColor:'rgba(74,222,128,0.2)'}} onClick={()=>setAsk({kind:'pay',p})}>✓ {tr('Pay','支払','Pagar')}</button>}
                  <button className="btn btn-sm" style={{fontSize:10}} onClick={()=>handleEdit(p)}>✏️</button>
                  {p.payment_type!=='salary'&&<button className="btn btn-sm btn-danger" style={{fontSize:10}} aria-label={tr('Delete','削除','Apagar')} onClick={()=>setAsk({kind:'delete',p})}>✕</button>}
                </div>
              </div>
            ))}
            {empPayments.length===0&&<div style={{color:'var(--text3)',fontSize:13}}>No payments.</div>}
          </div>
        )
      })}

      {ask&&(()=>{
        const { kind, p } = ask
        const st = p.payment_type==='salary' ? statementFor(p) : null
        const k = statementState(st)
        const isPay = kind==='pay'
        return (
          <div className="sp-overlay" onClick={()=>!busy&&setAsk(null)}>
            <section className="sp-modal is-admin" role="dialog" aria-modal="true" onClick={ev=>ev.stopPropagation()}>
              <h3>{isPay ? tr('Confirm this payment was made?','この支払いを完了にしますか？','Confirmar que este pagamento foi feito?') : tr('Delete this entry?','この項目を削除しますか？','Apagar este lançamento?')}</h3>
              <dl className="sp-rows">
                <div><dt>{tr('Employee','従業員','Funcionário')}</dt><dd>{p.employee_name}</dd></div>
                <div><dt>{tr('Amount','金額','Valor')}</dt><dd className="sp-big">{p.is_deduction?'-':''}{fmt(p.amount)}</dd></div>
                <div><dt>{tr('Type','種別','Tipo')}</dt><dd>{p.payment_type}{p.description?` · ${p.description}`:''}</dd></div>
                {p.period&&<div><dt>{tr('Month worked','対象月','Mês trabalhado')}</dt><dd>{fmtPeriod(p.period)}</dd></div>}
                <div><dt>{tr('Payment date','支払日','Data do pagamento')}</dt><dd>{p.payment_date}</dd></div>
              </dl>
              {p.payment_type==='salary'&&(
                <div className={`sp-state is-${k}`}>
                  <b>{stateLabel[k]}</b>
                  {k==='confirmed'&&<small>{new Date(st.employee_confirmed_at).toLocaleString(locale,{timeZone:'Asia/Tokyo'})}{Number(st.net_total||0)!==Number(p.amount||0)?` · ${tr('payslip','明細','holerite')} ${fmt(st.net_total)}`:''}</small>}
                  {k==='disputed'&&<small>{tr('Answer the dispute in Salary issues before paying.','支払う前に「給与の問題」で回答してください。','Responda a contestação em Problemas de salário antes de pagar.')}</small>}
                  {k==='waiting'&&<small>{tr('You can still pay, but the employee has not checked the amount.','支払いは可能ですが、従業員は金額を確認していません。','Dá para pagar, mas o funcionário ainda não conferiu o valor.')}</small>}
                </div>
              )}
              <div className="sp-actions">
                <button className="btn" disabled={busy} onClick={()=>setAsk(null)}>{tr('Cancel','キャンセル','Cancelar')}</button>
                <button className={`btn ${isPay?(k==='confirmed'||k==='none'&&p.payment_type!=='salary'?'btn-primary':'sp-warn-btn'):'btn-danger'}`} disabled={busy} onClick={doConfirmed}>
                  {isPay ? (k==='confirmed'||p.payment_type!=='salary' ? tr('Yes, it was paid','はい、支払済み','Sim, foi pago') : tr('Pay anyway','それでも支払う','Pagar mesmo assim')) : tr('Delete','削除','Apagar')}
                </button>
              </div>
            </section>
          </div>
        )
      })()}
    </div>
  )
}
