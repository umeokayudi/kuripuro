import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const SERVICE_TYPES = ['Basic Cleaning','Deep Cleaning','Range Hood','AC Cleaning','Grease Trap','Window Cleaning','Floor Wax','Spot Cleaning']

export default function ServiceContracts() {
  const [clients, setClients] = useState([])
  const [contracts, setContracts] = useState([])
  const [selectedClient, setSelectedClient] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ location_name:'', location_address:'', service_type:'Basic Cleaning', price_per_visit:0, hours_per_visit:2, days_of_week:[], notes:'' })

  useEffect(() => { loadClients() }, [])
  useEffect(() => { if (selectedClient) loadContracts(selectedClient) }, [selectedClient])

  const loadClients = async () => {
    const { data } = await supabase.from('clients').select('*').eq('is_active',true).order('company_name')
    setClients(data||[])
    if (data?.length>0) setSelectedClient(data[0].id)
  }

  const loadContracts = async (clientId) => {
    const { data } = await supabase.from('service_contracts').select('*').eq('client_id',clientId).eq('is_active',true).order('location_name')
    setContracts(data||[])
  }

  const upd = (k,v) => setForm(f=>({...f,[k]:v}))

  const toggleDay = (d) => setForm(f=>({ ...f, days_of_week: f.days_of_week.includes(d) ? f.days_of_week.filter(x=>x!==d) : [...f.days_of_week, d] }))

  const calcVisits = (days) => {
    const weeksPerMonth = 4.33
    return Math.round(days.length * weeksPerMonth)
  }

  const visitsPerMonth = calcVisits(form.days_of_week)
  const monthlyRevenue = visitsPerMonth * parseFloat(form.price_per_visit||0)
  const totalHours = visitsPerMonth * parseFloat(form.hours_per_visit||0)

  const handleSave = async () => {
    if (!form.location_name||!selectedClient) return toast.error('Fill required fields')
    const visits = calcVisits(form.days_of_week)
    const revenue = visits * parseFloat(form.price_per_visit||0)
    const payload = { client_id:selectedClient, ...form, price_per_visit:parseFloat(form.price_per_visit)||0, hours_per_visit:parseFloat(form.hours_per_visit)||0, visits_per_month:visits, monthly_revenue:revenue }

    if (editing) {
      const { error } = await supabase.from('service_contracts').update(payload).eq('id',editing)
      if (error) return toast.error(error.message)
      toast.success('Updated!')
    } else {
      const { error } = await supabase.from('service_contracts').insert(payload)
      if (error) return toast.error(error.message)
      toast.success('Contract added!')
    }

    // Update client monthly_revenue
    const { data: allContracts } = await supabase.from('service_contracts').select('monthly_revenue').eq('client_id',selectedClient).eq('is_active',true)
    const totalRevenue = (allContracts||[]).reduce((s,c)=>s+Number(c.monthly_revenue||0),0) + (editing ? 0 : revenue)
    await supabase.from('clients').update({ monthly_revenue: totalRevenue }).eq('id', selectedClient)

    setShowForm(false); setEditing(null)
    setForm({ location_name:'', location_address:'', service_type:'Basic Cleaning', price_per_visit:0, hours_per_visit:2, days_of_week:[], notes:'' })
    loadContracts(selectedClient)
  }

  const handleEdit = (c) => {
    setEditing(c.id)
    setForm({ location_name:c.location_name||'', location_address:c.location_address||'', service_type:c.service_type||'Basic Cleaning', price_per_visit:c.price_per_visit||0, hours_per_visit:c.hours_per_visit||2, days_of_week:c.days_of_week||[], notes:c.notes||'' })
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    if (!confirm('Remove this location?')) return
    await supabase.from('service_contracts').update({ is_active:false }).eq('id',id)
    toast('Removed.')
    loadContracts(selectedClient)
    // Recalculate client revenue
    const { data } = await supabase.from('service_contracts').select('monthly_revenue').eq('client_id',selectedClient).eq('is_active',true).neq('id',id)
    const total = (data||[]).reduce((s,c)=>s+Number(c.monthly_revenue||0),0)
    await supabase.from('clients').update({ monthly_revenue:total }).eq('id',selectedClient)
  }

  const totalMonthlyRevenue = contracts.reduce((s,c)=>s+Number(c.monthly_revenue||0),0)
  const totalMonthlyHours = contracts.reduce((s,c)=>s+Number(c.visits_per_month||0)*Number(c.hours_per_visit||0),0)
  const totalVisits = contracts.reduce((s,c)=>s+Number(c.visits_per_month||0),0)
  const client = clients.find(c=>c.id===selectedClient)

  return (
    <div>
      {/* Client selector */}
      <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
        {clients.map(c=>(
          <button key={c.id} onClick={()=>{setSelectedClient(c.id);setShowForm(false)}}
            style={{padding:'8px 16px',borderRadius:20,border:'1.5px solid',borderColor:selectedClient===c.id?'var(--navy)':'var(--border)',background:selectedClient===c.id?'var(--navy)':'none',color:selectedClient===c.id?'#fff':'var(--text2)',fontSize:13,fontWeight:selectedClient===c.id?600:400,cursor:'pointer'}}>
            {c.company_name}
          </button>
        ))}
      </div>

      {selectedClient&&(
        <>
          {/* Summary */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:16}}>
            {[['Locations',contracts.length],['Visits/mo',totalVisits],['Hours/mo',totalMonthlyHours.toFixed(0)+'h'],['Revenue/mo','¥'+totalMonthlyRevenue.toLocaleString()]].map(([l,v])=>(
              <div key={l} className="card" style={{padding:'12px 14px',textAlign:'center'}}>
                <div style={{fontSize:20,fontWeight:700,color:'var(--green)'}}>{v}</div>
                <div style={{fontSize:11,color:'var(--text3)',marginTop:3}}>{l}</div>
              </div>
            ))}
          </div>

          {/* Add button */}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <div style={{fontSize:14,fontWeight:600}}>{client?.company_name} — Service Locations</div>
            <button className="btn btn-primary" onClick={()=>{setShowForm(!showForm);setEditing(null);setForm({ location_name:'', location_address:'', service_type:'Basic Cleaning', price_per_visit:0, hours_per_visit:2, days_of_week:[], notes:'' })}}>
              {showForm?'Cancel':'+ Add Location'}
            </button>
          </div>

          {/* Form */}
          {showForm&&(
            <div className="card" style={{marginBottom:16,border:'1px solid var(--navy)'}}>
              <div className="card-title">{editing?'Edit Location':'New Location'}</div>
              <div className="grid-2">
                <div className="form-group"><label>Location Name *</label><input value={form.location_name} onChange={e=>upd('location_name',e.target.value)} placeholder="Atomic Bar" /></div>
                <div className="form-group"><label>Service Type</label>
                  <select value={form.service_type} onChange={e=>upd('service_type',e.target.value)}>
                    {SERVICE_TYPES.map(s=><option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="form-group"><label>Price per Visit (¥)</label><input type="number" value={form.price_per_visit} onChange={e=>upd('price_per_visit',e.target.value)} /></div>
                <div className="form-group"><label>Hours per Visit</label><input type="number" step="0.5" value={form.hours_per_visit} onChange={e=>upd('hours_per_visit',e.target.value)} /></div>
                <div className="form-group" style={{gridColumn:'1/-1'}}><label>Address / Maps URL</label><input value={form.location_address} onChange={e=>upd('location_address',e.target.value)} placeholder="https://maps.app.goo.gl/..." /></div>
                <div className="form-group" style={{gridColumn:'1/-1'}}>
                  <label>Days of Week</label>
                  <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:4}}>
                    {DAYS.map(d=>(
                      <button key={d} type="button" onClick={()=>toggleDay(d)}
                        style={{padding:'6px 14px',borderRadius:20,border:'1.5px solid',borderColor:form.days_of_week.includes(d)?'var(--navy)':'var(--border)',background:form.days_of_week.includes(d)?'var(--navy)':'none',color:form.days_of_week.includes(d)?'#fff':'var(--text2)',fontSize:13,cursor:'pointer'}}>
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="form-group"><label>Notes</label><input value={form.notes} onChange={e=>upd('notes',e.target.value)} placeholder="Key box: 1234" /></div>
              </div>

              {/* Preview calc */}
              {form.days_of_week.length>0&&(
                <div style={{background:'var(--surface2)',borderRadius:10,padding:'12px 14px',marginBottom:14,display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
                  {[['Visits/month',visitsPerMonth],['Hours/month',totalHours.toFixed(1)+'h'],['Revenue/month','¥'+monthlyRevenue.toLocaleString()]].map(([l,v])=>(
                    <div key={l} style={{textAlign:'center'}}>
                      <div style={{fontSize:16,fontWeight:700,color:'var(--green)'}}>{v}</div>
                      <div style={{fontSize:10,color:'var(--text3)'}}>{l}</div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-primary" onClick={handleSave}>{editing?'✅ Update':'✅ Add'}</button>
                <button className="btn" onClick={()=>{setShowForm(false);setEditing(null)}}>Cancel</button>
              </div>
            </div>
          )}

          {/* Contracts list */}
          {contracts.length===0&&<div className="card"><div style={{color:'var(--text3)',fontSize:13}}>No locations yet. Add your first service location.</div></div>}
          {contracts.map(c=>(
            <div key={c.id} className="card" style={{marginBottom:10}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                <div>
                  <div style={{fontWeight:600,fontSize:14}}>{c.location_name}</div>
                  <div style={{fontSize:12,color:'var(--text3)',marginTop:1}}>{c.service_type} · {c.hours_per_visit}h/visit</div>
                  {c.location_address?.startsWith('http')&&<a href={c.location_address} target="_blank" rel="noreferrer" style={{fontSize:11,color:'#60a5fa',textDecoration:'none'}}>🗺 Maps</a>}
                  {c.notes&&<div style={{fontSize:11,color:'var(--text3)',marginTop:2}}>🔑 {c.notes}</div>}
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:15,fontWeight:700,color:'var(--green)'}}>¥{Number(c.monthly_revenue||0).toLocaleString()}/mo</div>
                  <div style={{fontSize:11,color:'var(--text3)'}}>¥{Number(c.price_per_visit||0).toLocaleString()}/visit</div>
                </div>
              </div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>
                {(c.days_of_week||[]).map(d=><span key={d} style={{background:'var(--navy)',color:'#fff',borderRadius:20,padding:'2px 10px',fontSize:11,fontWeight:500}}>{d}</span>)}
                <span style={{background:'var(--surface2)',borderRadius:20,padding:'2px 10px',fontSize:11,color:'var(--text3)'}}>{c.visits_per_month} visits/mo</span>
                <span style={{background:'var(--surface2)',borderRadius:20,padding:'2px 10px',fontSize:11,color:'var(--text3)'}}>{(c.visits_per_month*c.hours_per_visit).toFixed(0)}h/mo</span>
              </div>
              <div style={{display:'flex',gap:6}}>
                <button className="btn btn-sm btn-primary" onClick={()=>handleEdit(c)}>✏️ Edit</button>
                <button className="btn btn-sm btn-danger" onClick={()=>handleDelete(c.id)}>✕ Remove</button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
