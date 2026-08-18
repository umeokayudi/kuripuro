import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { PORTAL_SETUP_SQL, SUPABASE_SQL_URL } from '../lib/portalSetupSql'
import toast from 'react-hot-toast'

export default function Clients() {
  const [tab, setTab] = useState('list')
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [portalClientId, setPortalClientId] = useState('')
  const [portalUsers, setPortalUsers] = useState([])
  const [portalForm, setPortalForm] = useState({ contact_name: '', email: '', password: '', location_name: '' })
  const [portalSchemaOk, setPortalSchemaOk] = useState(true)
  const [portalSchemaChecking, setPortalSchemaChecking] = useState(false)
  const [contracts, setContracts] = useState([])
  const [form, setForm] = useState({ company_name:'', contact_name:'', phone:'', email:'', address:'', service_type:'Daily cleaning', monthly_revenue:0, monthly_cost:0, notes:'' })

  const SERVICE_TYPES = ['Daily cleaning','Weekly cleaning','Night cleaning','Deep cleaning','Spot cleaning','Monthly cleaning']

  useEffect(() => { load() }, [])
  useEffect(() => { if (portalClientId) loadPortal(portalClientId) }, [portalClientId])
  useEffect(() => { if (tab === 'portal') checkPortalSchema() }, [tab])

  const checkPortalSchema = async () => {
    setPortalSchemaChecking(true)
    const { error } = await supabase.from('client_users').select('id').limit(1)
    const missing = error?.message?.includes('client_users') || error?.code === 'PGRST205'
    setPortalSchemaOk(!missing)
    setPortalSchemaChecking(false)
    return !missing
  }

  const copyPortalSql = async () => {
    try {
      await navigator.clipboard.writeText(PORTAL_SETUP_SQL)
      toast.success('✅ SQL copiado! Agora abra o Supabase e cole com Ctrl+V → Run')
    } catch {
      toast.error('Não foi possível copiar — selecione o SQL abaixo manualmente')
    }
  }

  const openSupabaseSql = () => {
    window.open(SUPABASE_SQL_URL, '_blank')
    toast('Cole o SQL (Ctrl+V) e clique RUN')
  }

  const loadPortal = async (clientId) => {
    const [{ data: users, error }, { data: cts }] = await Promise.all([
      supabase.from('client_users').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
      supabase.from('service_contracts').select('location_name').eq('client_id', clientId).eq('is_active', true),
    ])
    if (error?.message?.includes('client_users')) {
      setPortalSchemaOk(false)
      setPortalUsers([])
      setContracts(cts || [])
      return
    }
    setPortalUsers(users || [])
    setContracts(cts || [])
  }

  const createPortalUser = async () => {
    if (!portalClientId || !portalForm.email || !portalForm.password || !portalForm.contact_name) {
      return toast.error('Name, email and password required')
    }
    if (!portalSchemaOk) {
      return toast.error('Primeiro rode o SQL no Supabase (botão COPIAR SQL acima)')
    }
    const client = clients.find(c => c.id === portalClientId)
    const { error } = await supabase.from('client_users').insert({
      client_id: portalClientId,
      client_name: client?.company_name || '',
      location_name: portalForm.location_name || null,
      contact_name: portalForm.contact_name,
      email: portalForm.email.trim().toLowerCase(),
      password: portalForm.password,
      is_active: true,
    })
    if (error) {
      if (error.message?.includes('client_users')) {
        setPortalSchemaOk(false)
        return toast.error('Tabela client_users não existe. Clique em "Copiar SQL" e rode no Supabase.')
      }
      return toast.error(error.message)
    }
    toast.success('Portal account created!')
    setPortalForm({ contact_name: '', email: '', password: '', location_name: '' })
    loadPortal(portalClientId)
  }

  const togglePortalUser = async (id, active) => {
    await supabase.from('client_users').update({ is_active: !active }).eq('id', id)
    loadPortal(portalClientId)
  }

  const deletePortalUser = async (id) => {
    if (!confirm('Delete this portal account?')) return
    await supabase.from('client_users').delete().eq('id', id)
    loadPortal(portalClientId)
  }

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
        <button className={`tab-pill${tab==='portal'?' active':''}`} onClick={()=>setTab('portal')}>🔐 Portal</button>
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
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  <button className="btn btn-sm btn-primary" onClick={()=>handleEdit(c)}>✏️ Edit</button>
                  <button className="btn btn-sm" onClick={()=>{setPortalClientId(c.id);setTab('portal')}}>🔐 Portal</button>
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

      {/* CLIENT PORTAL ACCOUNTS */}
      {tab==='portal'&&(
        <div>
          {!portalSchemaOk && (
            <div className="card" style={{ marginBottom: 14, border: '2px solid #f87171', background: 'rgba(248,113,113,0.08)' }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: '#f87171', marginBottom: 10 }}>
                ⚠️ Passo obrigatório (só 1 vez)
              </div>
              <ol style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.8, margin: '0 0 16px 18px', padding: 0 }}>
                <li>Clique <b>COPIAR SQL</b></li>
                <li>Clique <b>ABRIR SUPABASE</b></li>
                <li>Cole (Ctrl+V) e clique <b>RUN</b></li>
                <li>Volte aqui e crie o login</li>
              </ol>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                <button className="btn btn-primary" onClick={copyPortalSql} type="button" style={{ fontSize: 15, padding: '12px 20px', fontWeight: 800 }}>
                  📋 COPIAR SQL
                </button>
                <button className="btn" onClick={openSupabaseSql} type="button" style={{ fontSize: 15, padding: '12px 20px', fontWeight: 700 }}>
                  🔗 ABRIR SUPABASE
                </button>
                <button className="btn" onClick={checkPortalSchema} disabled={portalSchemaChecking} type="button">
                  {portalSchemaChecking ? '...' : '🔄 Já rodei o SQL'}
                </button>
              </div>
              <textarea readOnly value={PORTAL_SETUP_SQL} onClick={e => e.target.select()} style={{ width: '100%', height: 120, marginTop: 14, fontSize: 10, fontFamily: 'monospace', background: '#0a1525', color: '#94a3b8', border: '1px solid var(--border)', borderRadius: 8, padding: 10, boxSizing: 'border-box' }} />
            </div>
          )}
          <div className="card" style={{marginBottom:14}}>
            <div className="card-title">🔐 Client Portal Accounts</div>
            <div style={{fontSize:12,color:'var(--text3)',marginBottom:12}}>
              Create login for restaurant managers. They can see cleaning times, photos, chat, complaints and requests. Default UI is Japanese.
            </div>
            <div className="form-group">
              <label>Client</label>
              <select value={portalClientId} onChange={e=>setPortalClientId(e.target.value)}>
                <option value="">— Select client —</option>
                {clients.filter(c=>c.is_active).map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
            {portalClientId && (
              <>
                <div className="grid-2" style={{marginTop:12}}>
                  <div className="form-group"><label>Contact Name *</label><input value={portalForm.contact_name} onChange={e=>setPortalForm(f=>({...f,contact_name:e.target.value}))} placeholder="Tanaka Hiroshi" /></div>
                  <div className="form-group"><label>Email *</label><input type="email" value={portalForm.email} onChange={e=>setPortalForm(f=>({...f,email:e.target.value}))} /></div>
                  <div className="form-group"><label>Password *</label><input type="text" value={portalForm.password} onChange={e=>setPortalForm(f=>({...f,password:e.target.value}))} placeholder="min 6 chars" /></div>
                  <div className="form-group"><label>Location (optional)</label>
                    <select value={portalForm.location_name} onChange={e=>setPortalForm(f=>({...f,location_name:e.target.value}))}>
                      <option value="">All locations</option>
                      {contracts.map((ct,i)=><option key={i} value={ct.location_name}>{ct.location_name}</option>)}
                    </select>
                  </div>
                </div>
                <button className="btn btn-primary" onClick={createPortalUser} style={{marginTop:8}}>✅ Create Portal Login</button>
              </>
            )}
          </div>

          {portalClientId && (
            <div className="card">
              <div className="card-title">Portal Users ({portalUsers.length})</div>
              {portalUsers.length===0 && <div style={{color:'var(--text3)',fontSize:13}}>No portal accounts yet.</div>}
              <table>
                <thead><tr><th>Name</th><th>Email</th><th>Location</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {portalUsers.map(u=>(
                    <tr key={u.id}>
                      <td style={{fontWeight:500}}>{u.contact_name}</td>
                      <td style={{fontSize:12}}>{u.email}</td>
                      <td style={{fontSize:12}}>{u.location_name||'All'}</td>
                      <td><span className={`badge ${u.is_active?'badge-green':'badge-red'}`}>{u.is_active?'Active':'Inactive'}</span></td>
                      <td style={{display:'flex',gap:4}}>
                        <button className="btn btn-sm" onClick={()=>togglePortalUser(u.id,u.is_active)}>{u.is_active?'Disable':'Enable'}</button>
                        <button className="btn btn-sm btn-danger" onClick={()=>deletePortalUser(u.id)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
