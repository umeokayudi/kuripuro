import { useState, useEffect } from 'react'
import { useLang } from '../hooks/useLang'
import { Icons } from '../components/Icons'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function Employees() {
  const { t } = useLang()
  const [tab, setTab] = useState('list')
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [editTarget, setEditTarget] = useState(null)
  const [newEmp, setNewEmp] = useState({ full_name:'', email:'', password:'', phone:'', address:'', contract_type:'Full-time', hourly_rate:1100, bank_name:'', bank_branch:'', account_type:'普通', account_number:'', account_holder_katakana:'' })

  useEffect(() => { loadEmployees() }, [])

  const loadEmployees = async () => {
    setLoading(true)
    const { data } = await supabase.from('employees').select('*').order('created_at', { ascending: false })
    setEmployees(data || [])
    setLoading(false)
  }

  const scoreClass = s => s >= 90 ? 'score-excellent' : s >= 70 ? 'score-regular' : 'score-attention'
  const scoreBadge = s => s >= 90 ? 'badge-green' : s >= 70 ? 'badge-amber' : 'badge-red'
  const scoreLabel = s => s >= 90 ? 'Excellent' : s >= 70 ? 'Regular' : 'Attention'

  const upd = (k, v) => setNewEmp(n => ({ ...n, [k]: v }))
  const updEdit = (k, v) => setEditTarget(e => ({ ...e, [k]: v }))

  const handleAdd = async () => {
    if (!newEmp.full_name || !newEmp.email || !newEmp.password) return toast.error('Name, email and password required')
    const initials = newEmp.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    const { error } = await supabase.from('employees').insert({
      full_name: newEmp.full_name,
      email: newEmp.email.trim().toLowerCase(),
      password: newEmp.password,
      phone: newEmp.phone,
      address: newEmp.address,
      contract_type: newEmp.contract_type,
      hourly_rate: newEmp.hourly_rate,
      bank_name: newEmp.bank_name,
      bank_branch: newEmp.bank_branch,
      account_type: newEmp.account_type,
      account_number: newEmp.account_number,
      account_holder_katakana: newEmp.account_holder_katakana,
      score: 100,
      is_active: true,
    })
    if (error) return toast.error(error.message)
    toast.success('Employee registered!')
    setNewEmp({ full_name:'', email:'', password:'', phone:'', address:'', contract_type:'Full-time', hourly_rate:1100, bank_name:'', bank_branch:'', account_type:'普通', account_number:'', account_holder_katakana:'' })
    loadEmployees()
    setTab('list')
  }

  const handleUpdate = async () => {
    const { error } = await supabase.from('employees').update({
      full_name: editTarget.full_name,
      email: editTarget.email,
      password: editTarget.password,
      phone: editTarget.phone,
      address: editTarget.address,
      contract_type: editTarget.contract_type,
      hourly_rate: editTarget.hourly_rate,
      bank_name: editTarget.bank_name,
      bank_branch: editTarget.bank_branch,
      account_number: editTarget.account_number,
      account_holder_katakana: editTarget.account_holder_katakana,
    }).eq('id', editTarget.id)
    if (error) return toast.error(error.message)
    toast.success('Updated!')
    setEditTarget(null)
    loadEmployees()
  }

  const handleDeactivate = async (id, current) => {
    await supabase.from('employees').update({ is_active: !current }).eq('id', id)
    loadEmployees()
  }

  const COMPLAINT_TYPES = [
    { label: 'Incomplete service (-5 pts)', value: 5 },
    { label: 'Misconduct (-10 pts)', value: 10 },
    { label: 'Lateness (-3 pts)', value: 3 },
    { label: 'Property damage (-8 pts)', value: 8 },
    { label: 'Other (-2 pts)', value: 2 },
  ]
  const [rec, setRec] = useState({ empId:'', client:'', type:5, desc:'' })

  const handleComplaint = async () => {
    if (!rec.empId) return toast.error('Select employee')
    const emp = employees.find(e => e.id === rec.empId)
    const newScore = Math.max(0, (emp.score || 100) - rec.type)
    await supabase.from('employees').update({ score: newScore }).eq('id', rec.empId)
    await supabase.from('complaints').insert({
      employee_id: rec.empId, employee_name: emp.full_name,
      client_name: rec.client, complaint_type: COMPLAINT_TYPES.find(c=>c.value===rec.type)?.label,
      points_deducted: rec.type, description: rec.desc, complaint_date: new Date().toISOString().split('T')[0],
    })
    toast.error(`Complaint registered. -${rec.type} pts from ${emp.full_name}`)
    setRec({ empId:'', client:'', type:5, desc:'' })
    loadEmployees()
  }

  return (
    <div>
      <div className="tab-pills">
        <button className={`tab-pill${tab==='list'?' active':''}`} onClick={()=>setTab('list')}>List ({employees.length})</button>
        <button className={`tab-pill${tab==='register'?' active':''}`} onClick={()=>setTab('register')}>+ Add Employee</button>
        <button className={`tab-pill${tab==='complaints'?' active':''}`} onClick={()=>setTab('complaints')}>Complaints</button>
      </div>

      {tab==='list' && (
        <div>
          {loading && <div style={{color:'var(--text3)',fontSize:13}}>Loading...</div>}
          {employees.map(e => (
            <div key={e.id} className="card">
              <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:14}}>
                <div className="avatar" style={{background:'#E6F1FB',color:'#185FA5',width:44,height:44,fontSize:15}}>
                  {e.full_name?.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:600,fontSize:14}}>{e.full_name}</div>
                  <div style={{fontSize:12,color:'var(--text3)'}}>{e.email} · {e.contract_type} · ¥{e.hourly_rate}/h</div>
                </div>
                <span className={`badge ${e.is_active?'badge-green':'badge-red'}`}>{e.is_active?'Active':'Inactive'}</span>
              </div>
              <div className="grid-3" style={{gap:10,marginBottom:12}}>
                <div style={{textAlign:'center',background:'var(--surface2)',borderRadius:8,padding:'10px 0'}}>
                  <div style={{fontSize:22,fontWeight:700,color: (e.score||100)>=90?'var(--green)':(e.score||100)>=70?'#EF9F27':'var(--red)'}}>{e.score||100}</div>
                  <div style={{fontSize:11,color:'var(--text3)'}}>Score</div>
                </div>
                <div style={{textAlign:'center',background:'var(--surface2)',borderRadius:8,padding:'10px 0'}}>
                  <div style={{fontSize:16,fontWeight:600}}>{e.contract_type}</div>
                  <div style={{fontSize:11,color:'var(--text3)'}}>Contract</div>
                </div>
                <div style={{textAlign:'center',background:'var(--surface2)',borderRadius:8,padding:'10px 0'}}>
                  <div style={{fontSize:16,fontWeight:600}}>¥{e.hourly_rate}</div>
                  <div style={{fontSize:11,color:'var(--text3)'}}>Rate/h</div>
                </div>
              </div>
              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-sm" onClick={()=>setEditTarget(e)}>✏️ Edit</button>
                <button className="btn btn-sm" onClick={()=>handleDeactivate(e.id,e.is_active)}>{e.is_active?'Deactivate':'Activate'}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab==='register' && (
        <div className="card">
          <div className="card-title">New Employee</div>
          <div className="grid-2">
            <div className="form-group"><label>Full Name *</label><input value={newEmp.full_name} onChange={e=>upd('full_name',e.target.value)} placeholder="Yamamoto Hanako" /></div>
            <div className="form-group"><label>Email *</label><input type="email" value={newEmp.email} onChange={e=>upd('email',e.target.value)} placeholder="hanako@email.com" /></div>
            <div className="form-group"><label>Password *</label><input type="text" value={newEmp.password} onChange={e=>upd('password',e.target.value)} placeholder="Set login password" /></div>
            <div className="form-group"><label>Phone</label><input value={newEmp.phone} onChange={e=>upd('phone',e.target.value)} placeholder="090-1234-5678" /></div>
            <div className="form-group"><label>Address</label><input value={newEmp.address} onChange={e=>upd('address',e.target.value)} /></div>
            <div className="form-group"><label>Contract Type</label>
              <select value={newEmp.contract_type} onChange={e=>upd('contract_type',e.target.value)}>
                <option>Full-time</option><option>Part-time</option><option>Hourly</option><option>Freelancer</option>
              </select>
            </div>
            <div className="form-group"><label>Hourly Rate (¥)</label><input type="number" value={newEmp.hourly_rate} onChange={e=>upd('hourly_rate',e.target.value)} /></div>
          </div>
          <div className="form-section-title">Bank Details</div>
          <div className="grid-2">
            <div className="form-group"><label>Bank Name</label><input value={newEmp.bank_name} onChange={e=>upd('bank_name',e.target.value)} placeholder="Japan Post / Mizuho..." /></div>
            <div className="form-group"><label>Branch (支店)</label><input value={newEmp.bank_branch} onChange={e=>upd('bank_branch',e.target.value)} /></div>
            <div className="form-group"><label>Account Type</label>
              <select value={newEmp.account_type} onChange={e=>upd('account_type',e.target.value)}>
                <option value="普通">普通（普通預金）</option><option value="当座">当座（当座預金）</option>
              </select>
            </div>
            <div className="form-group"><label>Account Number</label><input value={newEmp.account_number} onChange={e=>upd('account_number',e.target.value)} /></div>
            <div className="form-group" style={{gridColumn:'1/-1'}}><label>Account Holder (katakana)</label><input value={newEmp.account_holder_katakana} onChange={e=>upd('account_holder_katakana',e.target.value)} placeholder="ヤマモト ハナコ" /></div>
          </div>
          <button className="btn btn-primary" onClick={handleAdd}>✅ Register Employee</button>
        </div>
      )}

      {tab==='complaints' && (
        <div className="card">
          <div className="card-title">Register Complaint</div>
          <div className="grid-2">
            <div className="form-group"><label>Employee</label>
              <select value={rec.empId} onChange={e=>setRec(r=>({...r,empId:e.target.value}))}>
                <option value="">Select...</option>
                {employees.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Client</label><input value={rec.client} onChange={e=>setRec(r=>({...r,client:e.target.value}))} /></div>
            <div className="form-group"><label>Type</label>
              <select value={rec.type} onChange={e=>setRec(r=>({...r,type:parseInt(e.target.value)}))}>
                {COMPLAINT_TYPES.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group"><label>Description</label><textarea value={rec.desc} onChange={e=>setRec(r=>({...r,desc:e.target.value}))} /></div>
          <button className="btn btn-danger" onClick={handleComplaint}>Register Complaint</button>
        </div>
      )}

      {editTarget && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={()=>setEditTarget(null)}>
          <div style={{background:'var(--surface)',borderRadius:14,padding:24,maxWidth:520,width:'100%',maxHeight:'90vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:16}}>
              <div style={{fontWeight:600,fontSize:15}}>Edit — {editTarget.full_name}</div>
              <button onClick={()=>setEditTarget(null)} style={{background:'none',border:'none',fontSize:18,cursor:'pointer'}}>✕</button>
            </div>
            <div className="grid-2">
              <div className="form-group"><label>Full Name</label><input value={editTarget.full_name||''} onChange={e=>updEdit('full_name',e.target.value)} /></div>
              <div className="form-group"><label>Email</label><input value={editTarget.email||''} onChange={e=>updEdit('email',e.target.value)} /></div>
              <div className="form-group"><label>Password</label><input value={editTarget.password||''} onChange={e=>updEdit('password',e.target.value)} /></div>
              <div className="form-group"><label>Phone</label><input value={editTarget.phone||''} onChange={e=>updEdit('phone',e.target.value)} /></div>
              <div className="form-group"><label>Contract</label>
                <select value={editTarget.contract_type||''} onChange={e=>updEdit('contract_type',e.target.value)}>
                  <option>Full-time</option><option>Part-time</option><option>Hourly</option><option>Freelancer</option>
                </select>
              </div>
              <div className="form-group"><label>Hourly Rate (¥)</label><input type="number" value={editTarget.hourly_rate||''} onChange={e=>updEdit('hourly_rate',e.target.value)} /></div>
              <div className="form-group"><label>Bank Name</label><input value={editTarget.bank_name||''} onChange={e=>updEdit('bank_name',e.target.value)} /></div>
              <div className="form-group"><label>Account Number</label><input value={editTarget.account_number||''} onChange={e=>updEdit('account_number',e.target.value)} /></div>
            </div>
            <div style={{display:'flex',gap:8,marginTop:8}}>
              <button className="btn btn-primary" onClick={handleUpdate}>Save Changes</button>
              <button className="btn" onClick={()=>setEditTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
