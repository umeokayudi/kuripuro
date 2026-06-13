import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function Clients() {
  const [tab, setTab] = useState('list')
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ company_name:'', contact_name:'', phone:'', email:'', address:'', service_type:'Daily cleaning', monthly_revenue:0, monthly_cost:0, notes:'' })

  const SERVICE_TYPES = ['Daily cleaning','Weekly cleaning','Night cleaning','Deep cleaning','Spot cleaning','Monthly cleaning']

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('clients').select('*').order('company_name')
    setClients(data||[])
    setLoading(false)
  }

  const upd = (k,v) => setForm(f=>({...f,[k]:v}))

  const handleSave = async () => {
    if (!form.company_name) return toast.error('Company name required')
    if (editing) {
      const { error } = await supabase.from('clients').update({ ...form, monthly_revenue:parseFloat(form.monthly_revenue)||0, monthly_cost:parseFloat(form.monthly_cost)||0 }).eq('id', editing)
      if (error) return toast.error(error.message)
      toast.success('Client updated!')
    } else {
      const { error } = await supabase.from('clients').insert({ ...form, monthly_revenue:parseFloat(form.monthly_revenue)||0, monthly_cost:parseFloat(form.monthly_cost)||0, is_active:true })
      if (error) return toast.error(error.message)
      toast.success('Client registered!')
    }
    setForm({ company_name:'', contact_name:'', phone:'', email:'', address:'', service_type:'Daily cleaning', monthly_revenue:0, monthly_cost:0, notes:'' })
    setEditing(null); setTab('list'); load()
  }

  const handleEdit = (c) => {
    setForm({ company_name:c.company_name||'', contact_name:c.contact_name||'', phone:c.phone||'', email:c.email||'', address:c.address||'', service_type:c.service_type||'Daily cleaning', monthly_revenue:c.monthly_revenue||0, monthly_cost:c.monthly_cost||0, notes:c.notes||'' })
    setEditing(c.id); setTab('register')
  }

  const handleDelete = async (id, name) => {
    if (!confirm(`Delete ${name}?`)) return
    await supabase.from('clients').delete().eq('id', id)
    toast('Client deleted.')
    load()
  }

  const handleToggle = async (id, current) => {
    await supabase.from('clients').update({ is_active:!current }).eq('id', id)
    load()
  }

  const totalRevenue = clients.reduce((s,c)=>s+Number(c.monthly_revenue||0),0)
  const totalCost = clients.reduce((s,c)=>s+Number(c.monthly_cost||0),0)
  const totalProfit = totalRevenue - totalCost

  return (
    <div>
      <div className="tab-pills">
        <button className={`tab-pill${tab==='list'?' active':''}`} onClick={()=>{setTab('list');setEditing(null);setForm({ company_name:'', contact_name:'', phone:'', email:'', address:'', service_type:'Daily cleaning', monthly_revenue:0, monthly_cost:0, notes:'' })}}>List ({clients.length})</button>
        <button className={`tab-pill${tab==='register'?' active':''}`} onClick={()=>setTab('register')}>{editing?'✏️ Edit':'+ Register'}</button>
        <button className={`tab-pill${tab==='services'?' active':''}`} onClick={()=>setTab('services')}>Services</button>
      </div>

      {/* LIST */}
      {tab==='list'&&(
        <div>
          {loading&&<div style={{color:'var(--text3)',fontSize:13}}>Loading...</div>}
          {clients.map(c=>{
            const profit = Number(c.monthly_revenue||0) - Number(c.monthly_cost||0)
            const margin = c.monthly_revenue ? Math.round(profit/c.monthly_revenue*100) : 0
            return (
              <div key={c.id} className="card" style={{marginBottom:14}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:16}}>{c.company_name}</div>
                    <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{c.contact_name} · {c.phone}</div>
                    <div style={{fontSize:12,color:'var(--text3)'}}>{c.service_type}</div>
                  </div>
                  <span className={`badge ${c.is_active?'badge-green':'badge-red'}`}>{c.is_active?'Active':'Inactive'}</span>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:12}}>
                  <div style={{background:'var(--surface2)',borderRadius:8,padding:'8px 10px',textAlign:'center'}}>
                    <div style={{fontSize:14,fontWeight:700}}>¥{Number(c.monthly_revenue||0).toLocaleString()}</div>
                    <div style={{fontSize:10,color:'var(--text3)'}}>Revenue</div>
                  </div>
                  <div style={{background:'var(--surface2)',borderRadius:8,padding:'8px 10px',textAlign:'center'}}>
                    <div style={{fontSize:14,fontWeight:700,color:'var(--green)'}}>¥{profit.toLocaleString()}</div>
                    <div style={{fontSize:10,color:'var(--text3)'}}>Profit</div>
                  </div>
                  <div style={{background:'var(--surface2)',borderRadius:8,padding:'8px 10px',textAlign:'center'}}>
                    <div style={{fontSize:14,fontWeight:700,color:margin>=70?'var(--green)':margin>=50?'#EF9F27':'var(--red)'}}>{margin}%</div>
                    <div style={{fontSize:10,color:'var(--text3)'}}>Margin</div>
                  </div>
                </div>
                {c.notes&&<div style={{fontSize:12,color:'var(--text2)',background:'var(--surface2)',borderRadius:8,padding:'8px 10px',marginBottom:10}}>{c.notes}</div>}
                <div style={{display:'flex',gap:8}}>
                  <button className="btn btn-sm btn-primary" onClick={()=>handleEdit(c)}>✏️ Edit</button>
                  <button className="btn btn-sm" onClick={()=>handleToggle(c.id,c.is_active)}>{c.is_active?'Deactivate':'Activate'}</button>
                  <button className="btn btn-sm btn-danger" onClick={()=>handleDelete(c.id,c.company_name)}>🗑 Delete</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* REGISTER / EDIT */}
      {tab==='register'&&(
        <div className="card">
          <div className="card-title">{editing?'Edit Client':'New Client'}</div>
          <div className="grid-2">
            <div className="form-group" style={{gridColumn:'1/-1'}}><label>Company Name *</label><input value={form.company_name} onChange={e=>upd('company_name',e.target.value)} placeholder="Hotel Grand" /></div>
            <div className="form-group"><label>Contact Name</label><input value={form.contact_name} onChange={e=>upd('contact_name',e.target.value)} placeholder="Tanaka Hiroshi" /></div>
            <div className="form-group"><label>Phone</label><input value={form.phone} onChange={e=>upd('phone',e.target.value)} placeholder="03-1111-2222" /></div>
            <div className="form-group"><label>Email</label><input type="email" value={form.email} onChange={e=>upd('email',e.target.value)} /></div>
            <div className="form-group"><label>Service Type</label>
              <select value={form.service_type} onChange={e=>upd('service_type',e.target.value)}>
                {SERVICE_TYPES.map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Monthly Revenue (¥)</label><input type="number" value={form.monthly_revenue} onChange={e=>upd('monthly_revenue',e.target.value)} /></div>
            <div className="form-group"><label>Monthly Cost (¥)</label><input type="number" value={form.monthly_cost} onChange={e=>upd('monthly_cost',e.target.value)} /></div>
            <div className="form-group" style={{gridColumn:'1/-1'}}><label>Address</label><input value={form.address} onChange={e=>upd('address',e.target.value)} /></div>
            <div className="form-group" style={{gridColumn:'1/-1'}}><label>Notes</label><textarea value={form.notes} onChange={e=>upd('notes',e.target.value)} /></div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-primary" onClick={handleSave}>{editing?'✅ Update':'✅ Register'}</button>
            <button className="btn" onClick={()=>{setEditing(null);setTab('list')}}>Cancel</button>
          </div>
        </div>
      )}

      {/* SERVICES */}
      {tab==='services'&&(
        <div className="card">
          <div className="card-title">Services Overview</div>
          <table>
            <thead>
              <tr><th>Company</th><th>Service</th><th>Revenue</th><th>Cost</th><th>Profit</th><th>Margin</th></tr>
            </thead>
            <tbody>
              {clients.filter(c=>c.is_active).map(c=>{
                const profit = Number(c.monthly_revenue||0)-Number(c.monthly_cost||0)
                const margin = c.monthly_revenue?Math.round(profit/c.monthly_revenue*100):0
                return (
                  <tr key={c.id}>
                    <td style={{fontWeight:500}}>{c.company_name}</td>
                    <td>{c.service_type}</td>
                    <td>¥{Number(c.monthly_revenue||0).toLocaleString()}</td>
                    <td style={{color:'var(--red)'}}>¥{Number(c.monthly_cost||0).toLocaleString()}</td>
                    <td style={{color:'var(--green)',fontWeight:600}}>¥{profit.toLocaleString()}</td>
                    <td><span className={`badge ${margin>=70?'badge-green':margin>=50?'badge-amber':'badge-red'}`}>{margin}%</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginTop:16}}>
            {[['Total Revenue',totalRevenue,'var(--text)'],['Total Cost',totalCost,'var(--red)'],['Total Profit',totalProfit,'var(--green)']].map(([l,v,color])=>(
              <div key={l} style={{background:'var(--surface2)',borderRadius:10,padding:'12px 14px'}}>
                <div style={{fontSize:11,color:'var(--text3)',marginBottom:4}}>{l}</div>
                <div style={{fontSize:18,fontWeight:700,color}}>{v<0?'-':''}¥{Math.abs(v).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
