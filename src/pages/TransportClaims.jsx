import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function TransportClaims() {
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending')
  const [note, setNote] = useState({})

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('transport_claims').select('*').order('created_at', { ascending: false })
    setClaims(data || [])
    setLoading(false)
  }

  const handleAction = async (id, status, empId, amount, empName) => {
    const { error } = await supabase.from('transport_claims').update({ status, admin_note: note[id]||'' }).eq('id', id)
    if (error) return toast.error(error.message)
    if (status === 'approved') {
      await supabase.from('salary_payments').insert({
        employee_id: empId, employee_name: empName,
        period: new Date().toISOString().slice(0,7),
        amount, payment_date: new Date().toISOString().split('T')[0],
        description: `Transport reimbursement`, status: 'scheduled',
        payment_type: 'bonus', is_deduction: false
      })
      toast.success(`Approved! ¥${Number(amount).toLocaleString()} added to salary`)
    } else {
      toast('Rejected.')
    }
    load()
  }

  const filtered = claims.filter(c => filter === 'all' ? true : c.status === filter)
  const pending = claims.filter(c => c.status === 'pending').length

  return (
    <div>
      <div className="tab-pills">
        {[['pending', `Pending${pending>0?` (${pending})`:''}`], ['approved','Approved'], ['rejected','Rejected'], ['all','All']].map(([k,l])=>(
          <button key={k} className={`tab-pill${filter===k?' active':''}`} onClick={()=>setFilter(k)}>{l}</button>
        ))}
      </div>

      {loading && <div style={{color:'var(--text3)',fontSize:13}}>Loading...</div>}
      {filtered.length===0 && !loading && <div className="card"><div style={{color:'var(--text3)',fontSize:13}}>No claims.</div></div>}

      {filtered.map(c=>(
        <div key={c.id} className="card" style={{marginBottom:12}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
            <div>
              <div style={{fontWeight:600,fontSize:15}}>{c.employee_name}</div>
              <div style={{fontSize:13,fontWeight:700,color:'var(--green)',marginTop:2}}>¥{Number(c.amount).toLocaleString()}</div>
              <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{c.claim_date}{c.route&&` · ${c.route}`}</div>
              {c.job_title&&<div style={{fontSize:12,color:'var(--text3)'}}>Job: {c.job_title}</div>}
              {c.description&&<div style={{fontSize:12,color:'var(--text2)',marginTop:4}}>{c.description}</div>}
            </div>
            <span className={`badge ${c.status==='approved'?'badge-green':c.status==='rejected'?'badge-red':'badge-amber'}`}>{c.status}</span>
          </div>

          {/* Photos */}
          {(c.photo_url||c.receipt_url)&&(
            <div style={{display:'flex',gap:8,marginBottom:10}}>
              {c.photo_url&&<a href={c.photo_url} target="_blank" rel="noreferrer" className="btn btn-sm">📷 Photo</a>}
              {c.receipt_url&&<a href={c.receipt_url} target="_blank" rel="noreferrer" className="btn btn-sm">🧾 Receipt</a>}
            </div>
          )}

          {c.status==='pending'&&(
            <div>
              <div className="form-group">
                <label>Admin note (optional)</label>
                <input value={note[c.id]||''} onChange={e=>setNote(n=>({...n,[c.id]:e.target.value}))} placeholder="Reason for approval/rejection..." />
              </div>
              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-primary" style={{flex:1}} onClick={()=>handleAction(c.id,'approved',c.employee_id,c.amount,c.employee_name)}>✅ Approve</button>
                <button className="btn btn-danger" style={{flex:1}} onClick={()=>handleAction(c.id,'rejected',c.employee_id,c.amount,c.employee_name)}>❌ Reject</button>
              </div>
            </div>
          )}

          {c.admin_note&&c.status!=='pending'&&<div style={{fontSize:12,color:'var(--text3)',background:'var(--surface2)',borderRadius:8,padding:'8px 10px',marginTop:8}}>Note: {c.admin_note}</div>}
        </div>
      ))}
    </div>
  )
}
