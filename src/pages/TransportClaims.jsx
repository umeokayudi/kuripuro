import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { tokyoToday, tokyoYearMonth } from '../lib/dates'
import { useLang, fill } from '../hooks/useLang'
import toast from 'react-hot-toast'

function claimMatchesPay(claim, pays) {
  const period = (claim.claim_date || '').slice(0, 7) || tokyoYearMonth()
  return (pays || []).some(p =>
    p.employee_id === claim.employee_id
    && Number(p.amount) === Number(claim.amount)
    && (p.period === period || p.payment_date?.slice(0, 7) === period),
  )
}

export default function TransportClaims() {
  const { t, lang } = useLang()
  const d = t.transportDesk
  const [claims, setClaims] = useState([])
  const [pays, setPays] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending')
  const [note, setNote] = useState({})

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const [{ data }, { data: payRows }] = await Promise.all([
      supabase.from('transport_claims').select('*').order('created_at', { ascending: false }),
      supabase.from('salary_payments').select('*').eq('payment_type', 'transport'),
    ])
    setClaims(data || [])
    setPays(payRows || [])
    setLoading(false)
  }

  const insertTransportPay = async (empId, amount, empName, claimDate) => {
    const { error } = await supabase.from('salary_payments').insert({
      employee_id: empId, employee_name: empName,
      period: (claimDate || tokyoToday()).slice(0, 7) || tokyoYearMonth(),
      amount, payment_date: tokyoToday(),
      description: lang === 'ja' ? '交通費精算' : 'Transport reimbursement',
      status: 'scheduled',
      payment_type: 'transport', is_deduction: false,
    })
    return error
  }

  const handleAction = async (id, status, empId, amount, empName, claimDate) => {
    const { error } = await supabase.from('transport_claims').update({ status, admin_note: note[id]||'' }).eq('id', id)
    if (error) return toast.error(error.message)
    if (status === 'approved') {
      const payErr = await insertTransportPay(empId, amount, empName, claimDate)
      if (payErr) return toast.error(payErr.message)
      toast.success(fill(d.approvedToast, { amount: Number(amount).toLocaleString() }))
    } else {
      toast(d.rejectedToast)
    }
    load()
  }

  const addApprovedToSalary = async (claim) => {
    const payErr = await insertTransportPay(claim.employee_id, claim.amount, claim.employee_name, claim.claim_date)
    if (payErr) return toast.error(payErr.message)
    toast.success(fill(d.approvedToast, { amount: Number(claim.amount).toLocaleString() }))
    load()
  }

  const filtered = claims.filter(c => filter === 'all' ? true : c.status === filter)
  const pending = claims.filter(c => c.status === 'pending').length

  return (
    <div>
      <div className="tab-pills">
        {[['pending', `${d.pending}${pending>0?` (${pending})`:''}`], ['approved', d.approved], ['rejected', d.rejected], ['all', d.all]].map(([k,l])=>(
          <button key={k} className={`tab-pill${filter===k?' active':''}`} onClick={()=>setFilter(k)}>{l}</button>
        ))}
      </div>

      {loading && <div style={{color:'var(--text3)',fontSize:13}}>{t.app.loading}</div>}
      {filtered.length===0 && !loading && <div className="card"><div style={{color:'var(--text3)',fontSize:13}}>{d.empty}</div></div>}

      {filtered.map(c=>(
        <div key={c.id} className="card" style={{marginBottom:12}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
            <div>
              <div style={{fontWeight:600,fontSize:15}}>{c.employee_name}</div>
              <div style={{fontSize:13,fontWeight:700,color:'var(--green)',marginTop:2}}>¥{Number(c.amount).toLocaleString()}</div>
              <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{c.claim_date}{c.route&&` · ${c.route}`}</div>
              {c.job_title&&<div style={{fontSize:12,color:'var(--text3)'}}>{d.job}: {c.job_title}</div>}
              {c.description&&<div style={{fontSize:12,color:'var(--text2)',marginTop:4}}>{c.description}</div>}
            </div>
            <span className={`badge ${c.status==='approved'?'badge-green':c.status==='rejected'?'badge-red':'badge-amber'}`}>{c.status}</span>
          </div>

          {(c.photo_url||c.receipt_url)&&(
            <div style={{display:'flex',gap:8,marginBottom:10}}>
              {c.photo_url&&<a href={c.photo_url} target="_blank" rel="noreferrer" className="btn btn-sm">📷 {d.photo}</a>}
              {c.receipt_url&&<a href={c.receipt_url} target="_blank" rel="noreferrer" className="btn btn-sm">🧾 {d.receipt}</a>}
            </div>
          )}

          {c.status==='pending'&&(
            <div>
              <div className="form-group">
                <label>{d.adminNote}</label>
                <input value={note[c.id]||''} onChange={e=>setNote(n=>({...n,[c.id]:e.target.value}))} />
              </div>
              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-primary" style={{flex:1}} onClick={()=>handleAction(c.id,'approved',c.employee_id,c.amount,c.employee_name,c.claim_date)}>✅ {d.approve}</button>
                <button className="btn btn-danger" style={{flex:1}} onClick={()=>handleAction(c.id,'rejected',c.employee_id,c.amount,c.employee_name,c.claim_date)}>❌ {d.reject}</button>
              </div>
            </div>
          )}

          {c.status==='approved' && (
            claimMatchesPay(c, pays)
              ? <div style={{fontSize:12,color:'var(--green)'}}>{d.alreadyInSalary}</div>
              : <button className="btn btn-primary" onClick={()=>addApprovedToSalary(c)}>{d.addToSalary}</button>
          )}

          {c.admin_note&&c.status!=='pending'&&<div style={{fontSize:12,color:'var(--text3)',background:'var(--surface2)',borderRadius:8,padding:'8px 10px',marginTop:8}}>{d.note}: {c.admin_note}</div>}
        </div>
      ))}
    </div>
  )
}
