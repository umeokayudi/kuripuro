import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadClientMoney, withClientMoney } from '../lib/moneyData'
import { marginPct } from '../lib/money'
import { PORTAL_SETUP_SQL, SUPABASE_SQL_URL } from '../lib/portalSetupSql'
import { provisionAllStoreAccounts, getPortalStores } from '../lib/portalStores'
import { apiFetch } from '../lib/apiFetch'
import toast from 'react-hot-toast'
import ClientCareAdmin from '../components/ClientCareAdmin'
import { fetchContractSellers } from '../lib/contractSellers'
import { ClientLink } from '../components/ClientSheetHost'
import { askConfirm } from '../components/ConfirmDialog'
import SetupChain from '../components/SetupChain'

export default function Clients() {
  const [searchParams] = useSearchParams()
  const searchId = searchParams.get('search')
  const [tab, setTab] = useState('list')
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [portalClientId, setPortalClientId] = useState('')
  const navigate = useNavigate()
  const [portalUsers, setPortalUsers] = useState([])
  const [portalForm, setPortalForm] = useState({ contact_name: '', email: '', password: '', location_name: '' })
  const [editingPortalUser, setEditingPortalUser] = useState(null)
  const [editPortalForm, setEditPortalForm] = useState({ contact_name: '', email: '', password: '', location_name: '' })
  const [bulkProvisionBusy, setBulkProvisionBusy] = useState(false)
  const [portalSchemaOk, setPortalSchemaOk] = useState(true)
  const [portalSchemaChecking, setPortalSchemaChecking] = useState(false)
  const [contracts, setContracts] = useState([])
  const [sellers, setSellers] = useState([])
  const [form, setForm] = useState({ company_name:'', contact_name:'', phone:'', email:'', address:'', service_type:'Daily cleaning', monthly_revenue:0, monthly_cost:0, notes:'' })

  const SERVICE_TYPES = ['Daily cleaning','Weekly cleaning','Night cleaning','Deep cleaning','Spot cleaning','Monthly cleaning']

  useEffect(() => { load(); fetchContractSellers().then(r => setSellers(r.salespeople || [])).catch(() => {}) }, [])
  useEffect(() => { if (searchId) setTab('list') }, [searchId])
  useEffect(() => { if (portalClientId) loadPortal(portalClientId) }, [portalClientId])
  useEffect(() => { if (tab === 'portal') checkPortalSchema() }, [tab])

  const [storageOk, setStorageOk] = useState(true)
  const [autoSetupBusy, setAutoSetupBusy] = useState(false)

  const checkStorage = async () => {
    const testPath = `jobs/_healthcheck/${Date.now()}.jpg`
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })
    const { error } = await supabase.storage.from('service-photos').upload(testPath, blob, { upsert: true })
    if (error) {
      setStorageOk(false)
      return false
    }
    await supabase.storage.from('service-photos').remove([testPath]).catch(() => {})
    setStorageOk(true)
    return true
  }

  const checkPortalSchema = async () => {
    setPortalSchemaChecking(true)
    const { error } = await supabase.from('client_users').select('id').limit(1)
    const missing = error?.message?.includes('client_users') || error?.code === 'PGRST205'
    setPortalSchemaOk(!missing)
    if (!missing) await checkStorage()
    setPortalSchemaChecking(false)
    return !missing
  }

  const runAutoSetup = async () => {
    setAutoSetupBusy(true)
    try {
      const resp = await apiFetch('/api/setup-portal-schema', { method: 'POST' })
      const data = await resp.json()
      if (!resp.ok) {
        if (resp.status === 503) {
          toast.error('Configure SUPABASE_DB_URL na Vercel ou use COPIAR SQL')
          openSupabaseSql()
        } else {
          toast.error(data.error || 'Setup falhou')
        }
        return
      }
      toast.success(data.message || 'Setup concluído!')
      await checkPortalSchema()
    } catch (e) {
      toast.error(e.message)
    }
    setAutoSetupBusy(false)
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
    if (!(await askConfirm({ message: 'Delete this portal account?', danger: true }))) return
    await supabase.from('client_users').delete().eq('id', id)
    loadPortal(portalClientId)
  }

  const openEditPortalUser = (u) => {
    setEditingPortalUser(u)
    setEditPortalForm({
      contact_name: u.contact_name || '',
      email: u.email || '',
      password: '',
      location_name: u.location_name || '',
    })
  }

  const saveEditPortalUser = async () => {
    if (!editingPortalUser) return
    if (!editPortalForm.email?.trim()) return toast.error('Email required')
    const patch = {
      contact_name: editPortalForm.contact_name.trim(),
      email: editPortalForm.email.trim().toLowerCase(),
      location_name: editPortalForm.location_name || null,
    }
    if (editPortalForm.password?.trim()) {
      if (editPortalForm.password.trim().length < 6) return toast.error('Password min 6 chars')
      patch.password = editPortalForm.password.trim()
    }
    const client = clients.find(c => c.id === portalClientId)
    if (client) patch.client_name = client.company_name
    const { error } = await supabase.from('client_users').update(patch).eq('id', editingPortalUser.id)
    if (error) return toast.error(error.message)
    toast.success('Portal account updated')
    setEditingPortalUser(null)
    loadPortal(portalClientId)
  }

  const [newPasswords, setNewPasswords] = useState(null) // shown once after creating store accounts
  const provisionAllStores = async () => {
    if (!portalSchemaOk) return toast.error('Primeiro rode o SQL no Supabase')
    if (!(await askConfirm({ message: `Criar/atualizar ${getPortalStores().length} contas (On The Planet + Atomic)?\nContas novas recebem senha própria; as existentes mantêm a senha atual.`, danger: false }))) return
    setBulkProvisionBusy(true)
    try {
      const results = await provisionAllStoreAccounts(supabase, clients)
      const msg = `✅ ${results.created} criadas, ${results.updated} atualizadas, ${results.contracts} contratos novos`
      if (results.errors.length) toast.error(`${results.errors.length} erros — veja console`)
      else toast.success(msg)
      if (results.errors.length) console.warn('Portal provision errors:', results.errors)
      if (results.passwords.length) setNewPasswords(results.passwords)
      if (portalClientId) loadPortal(portalClientId)
    } catch (e) {
      toast.error(e.message)
    }
    setBulkProvisionBusy(false)
  }

  const [costMonth, setCostMonth] = useState('')
  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('clients').select('*').order('company_name')
    // v1.0.109 · revenue = active contracts, cost = real team cost of last month (same as Dashboard / Contracts)
    const money = await loadClientMoney().catch(() => null)
    setCostMonth(money?.costMonth || '')
    setClients(withClientMoney(data||[], money))
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
    if (!(await askConfirm({ title: `Delete ${name}?`, message: 'If this client has contracts, invoices or jobs, use Deactivate instead.', confirmLabel: 'Delete', danger: true }))) return
    const { error } = await supabase.from('clients').delete().eq('id', id)
    if (error) return toast.error(/foreign key|violates/i.test(error.message) ? 'This client has linked records (contracts, invoices, logins). Use Deactivate instead.' : error.message)
    toast.success('Client deleted')
    load()
  }

  // v1.0.56 · Seller responsible for the account: gets this client's quote requests and
  // earns the extra they add on top of the company price.
  const assignSeller = async (c, salespersonId) => {
    const { error } = await supabase.from('clients').update({ salesperson_id: salespersonId || null }).eq('id', c.id)
    if (error) return toast.error(/salesperson_id/.test(error.message) ? 'Run sql/2026-10-17_orcamento_vendedor.sql first' : error.message)
    setClients(list => list.map(x => x.id === c.id ? { ...x, salesperson_id: salespersonId || null } : x))
    toast.success(salespersonId ? `Seller: ${sellers.find(p => p.id === salespersonId)?.full_name || ''}` : 'Seller removed')
  }

  const handleToggle = async (id, current) => {
    await supabase.from('clients').update({ is_active:!current }).eq('id', id)
    load()
  }

  const totalRevenue = clients.filter(c=>c.is_active).reduce((s,c)=>s+Number(c.monthly_revenue||0),0)
  // Profit only over clients whose real cost is known (never revenue − ¥0).
  const costed = clients.filter(c=>c.is_active && c.monthly_cost != null)
  const totalCost = costed.reduce((s,c)=>s+Number(c.monthly_cost||0),0)
  const totalProfit = costed.reduce((s,c)=>s+Number(c.monthly_revenue||0),0) - totalCost

  return (
    <div>
      <SetupChain current="client" />
      <div className="tab-pills">
        <button className={`tab-pill${tab==='list'?' active':''}`} onClick={()=>{setTab('list');setEditing(null);setForm({ company_name:'', contact_name:'', phone:'', email:'', address:'', service_type:'Daily cleaning', monthly_revenue:0, monthly_cost:0, notes:'' })}}>List ({clients.length})</button>
        <button className={`tab-pill${tab==='register'?' active':''}`} onClick={()=>setTab('register')}>{editing?'✏️ Edit':'+ Register'}</button>
        <button className={`tab-pill${tab==='services'?' active':''}`} onClick={()=>setTab('services')}>Services</button>
        <button className={`tab-pill${tab==='portal'?' active':''}`} onClick={()=>setTab('portal')}>🔐 Portal</button>
        <button className={`tab-pill${tab==='care'?' active':''}`} onClick={()=>setTab('care')}>🤝 Manager &amp; stores</button>
        <button className="tab-pill" onClick={()=>navigate('/facility')}>🌏 Kuripuro World</button>
      </div>

      {tab==='care'&&<ClientCareAdmin clients={clients} onClientsChanged={load} />}

      {/* LIST */}
      {tab==='list'&&(
        <div>
          {loading&&<div style={{color:'var(--text3)',fontSize:13}}>Loading...</div>}
          {(searchId ? clients.filter(c => c.id === searchId) : clients).map(c=>{
            const profit = c.monthly_cost == null ? null : Number(c.monthly_revenue||0) - Number(c.monthly_cost||0)
            const margin = marginPct(c.monthly_revenue, c.monthly_cost)
            return (
              <div key={c.id} className="card" style={{marginBottom:14}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:16}}><ClientLink id={c.id} name={c.company_name} /></div>
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
                    <div style={{fontSize:14,fontWeight:700,color:profit != null && profit < 0 ? 'var(--red)' : 'var(--green)'}}>{profit == null ? '—' : `${profit < 0 ? '−' : ''}¥${Math.abs(profit).toLocaleString()}`}</div>
                    <div style={{fontSize:10,color:'var(--text3)'}}>Profit{costMonth ? ` (${costMonth})` : ''}</div>
                  </div>
                  <div style={{background:'var(--surface2)',borderRadius:8,padding:'8px 10px',textAlign:'center'}}>
                    <div style={{fontSize:14,fontWeight:700,color:margin==null?'var(--text3)':margin>=70?'var(--green)':margin>=50?'#EF9F27':'var(--red)'}} title={margin==null?'No completed job last month: cost unknown':''}>{margin == null ? '—' : `${margin}%`}</div>
                    <div style={{fontSize:10,color:'var(--text3)'}}>Margin</div>
                  </div>
                </div>
                {c.notes&&<div style={{fontSize:12,color:'var(--text2)',background:'var(--surface2)',borderRadius:8,padding:'8px 10px',marginBottom:10}}>{c.notes}</div>}
                <label className="client-seller-row">
                  <span>👤 Seller</span>
                  <select value={c.salesperson_id || ''} onChange={e => assignSeller(c, e.target.value)}>
                    <option value="">— No seller —</option>
                    {sellers.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                    {c.salesperson_id && !sellers.some(p => p.id === c.salesperson_id) && <option value={c.salesperson_id}>…</option>}
                  </select>
                </label>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  <button className="btn btn-sm btn-primary" onClick={()=>handleEdit(c)}>✏️ Edit</button>
                  <button className="btn btn-sm" onClick={()=>navigate(`/jobs?tab=locations&client=${c.id}`)}>📍 Places</button>
                  <button className="btn btn-sm" onClick={()=>navigate(`/contracts?client=${c.id}`)}>📄 Contracts</button>
                  <button className="btn btn-sm" onClick={()=>{setPortalClientId(c.id);setTab('portal')}}>🔐 Portal</button>
                  <button className="btn btn-sm" onClick={()=>navigate(`/facility?client=${c.id}`)}>🏢 3D</button>
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
            <div className="form-group" style={{gridColumn:'1/-1',fontSize:12,color:'var(--text3)'}}>💴 Monthly revenue comes from the client's contracts (Contracts) and the cost from the team's real work — they are not typed here.</div>
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
                const profit = c.monthly_cost == null ? null : Number(c.monthly_revenue||0)-Number(c.monthly_cost||0)
                const margin = marginPct(c.monthly_revenue, c.monthly_cost)
                return (
                  <tr key={c.id}>
                    <td style={{fontWeight:500}}><ClientLink id={c.id} name={c.company_name} /></td>
                    <td>{c.service_type}</td>
                    <td>¥{Number(c.monthly_revenue||0).toLocaleString()}</td>
                    <td style={{color:'var(--red)'}}>{c.monthly_cost == null ? '—' : `¥${Number(c.monthly_cost).toLocaleString()}`}</td>
                    <td style={{color:profit != null && profit < 0 ? 'var(--red)' : 'var(--green)',fontWeight:600}}>{profit == null ? '—' : `${profit < 0 ? '−' : ''}¥${Math.abs(profit).toLocaleString()}`}</td>
                    <td>{margin == null ? '—' : <span className={`badge ${margin>=70?'badge-green':margin>=50?'badge-amber':'badge-red'}`}>{margin}%</span>}</td>
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
          {(!portalSchemaOk || !storageOk) && (
            <div className="card" style={{ marginBottom: 14, border: '2px solid #f87171', background: 'rgba(248,113,113,0.08)' }}>
              <div style={{ fontWeight: 800, fontSize: 16, color: '#f87171', marginBottom: 10 }}>
                ⚠️ Configuração necessária (só 1 vez)
              </div>
              {!portalSchemaOk && (
                <p style={{ fontSize: 14, color: 'var(--text2)', margin: '0 0 12px' }}>
                  Tabelas do portal do cliente ainda não existem no Supabase.
                </p>
              )}
              {portalSchemaOk && !storageOk && (
                <p style={{ fontSize: 14, color: 'var(--text2)', margin: '0 0 12px' }}>
                  Bucket de fotos (<code>service-photos</code>) não configurado — relatórios com foto não funcionam.
                </p>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                <button className="btn btn-primary" onClick={runAutoSetup} disabled={autoSetupBusy} type="button" style={{ fontSize: 15, padding: '12px 20px', fontWeight: 800 }}>
                  {autoSetupBusy ? 'Configurando...' : '⚡ Configurar automaticamente'}
                </button>
                <button className="btn btn-primary" onClick={copyPortalSql} type="button" style={{ fontSize: 15, padding: '12px 20px', fontWeight: 800 }}>
                  📋 COPIAR SQL
                </button>
                <button className="btn" onClick={openSupabaseSql} type="button" style={{ fontSize: 15, padding: '12px 20px', fontWeight: 700 }}>
                  🔗 ABRIR SUPABASE
                </button>
                <button className="btn" onClick={checkPortalSchema} disabled={portalSchemaChecking} type="button">
                  {portalSchemaChecking ? '...' : '🔄 Verificar'}
                </button>
              </div>
              <ol style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
                <li>Automático: adicione <code>SUPABASE_DB_URL</code> na Vercel e clique em Configurar automaticamente</li>
                <li>Manual: COPIAR SQL → ABRIR SUPABASE → RUN</li>
              </ol>
              <textarea readOnly value={PORTAL_SETUP_SQL} onClick={e => e.target.select()} style={{ width: '100%', height: 120, marginTop: 14, fontSize: 10, fontFamily: 'monospace', background: '#0a1525', color: '#94a3b8', border: '1px solid var(--border)', borderRadius: 8, padding: 10, boxSizing: 'border-box' }} />
            </div>
          )}
          {newPasswords && (
            <div className="card" style={{marginBottom:14,border:'1px solid var(--amber)'}}>
              <div className="card-title">🔑 Senhas das contas novas — anote agora, não aparecem de novo</div>
              <table style={{width:'100%',fontSize:13}}><tbody>
                {newPasswords.map(p => <tr key={p.email}><td>{p.store}</td><td style={{color:'var(--text3)'}}>{p.email}</td><td><code>{p.password}</code></td></tr>)}
              </tbody></table>
              <div style={{display:'flex',gap:8,marginTop:10}}>
                <button className="btn btn-sm" type="button" onClick={() => navigator.clipboard?.writeText(newPasswords.map(p => `${p.store}\t${p.email}\t${p.password}`).join('\n')).then(() => toast.success('Copiado'))}>📋 Copiar</button>
                <button className="btn btn-sm btn-primary" type="button" onClick={() => setNewPasswords(null)}>Já anotei</button>
              </div>
            </div>
          )}
          <div className="card" style={{marginBottom:14}}>
            <div className="card-title">🔐 Client Portal Accounts</div>
            <div style={{fontSize:12,color:'var(--text3)',marginBottom:12}}>
              Uma conta por loja. Login com <b>nome do local</b> ou email. Cada loja tem a própria senha (para trocar, use ✎ na conta).
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              <button className="btn btn-primary" onClick={provisionAllStores} disabled={bulkProvisionBusy || !portalSchemaOk} type="button">
                {bulkProvisionBusy ? 'Criando...' : '🏪 Criar contas de todas as lojas (OTP + Atomic)'}
              </button>
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
                  <div className="form-group"><label>Password *</label><input type="password" value={portalForm.password} onChange={e=>setPortalForm(f=>({...f,password:e.target.value}))} placeholder="min 6 chars" /></div>
                  <div className="form-group"><label>店舗（任意）</label>
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
                <thead><tr><th>Name</th><th>Login</th><th>Location</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {portalUsers.map(u=>(
                    <tr key={u.id}>
                      <td style={{fontWeight:500}}>{u.contact_name}</td>
                      <td style={{fontSize:12}}>
                        <div>{u.location_name || '—'}</div>
                        <div style={{color:'var(--text3)',fontSize:11}}>{u.email}</div>
                      </td>
                      <td style={{fontSize:12}}>{u.location_name||'All'}</td>
                      <td><span className={`badge ${u.is_active?'badge-green':'badge-red'}`}>{u.is_active?'Active':'Inactive'}</span></td>
                      <td style={{display:'flex',gap:4}}>
                        <button className="btn btn-sm btn-primary" onClick={()=>openEditPortalUser(u)}>✏️</button>
                        <button className="btn btn-sm" onClick={()=>togglePortalUser(u.id,u.is_active)}>{u.is_active?'Disable':'Enable'}</button>
                        <button className="btn btn-sm btn-danger" onClick={()=>deletePortalUser(u.id)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {editingPortalUser && (
            <div className="card" style={{ marginTop: 14, border: '2px solid #315cf5' }}>
              <div className="card-title">✏️ Editar conta — {editingPortalUser.contact_name}</div>
              <div className="grid-2" style={{ marginTop: 12 }}>
                <div className="form-group"><label>Nome / contato</label><input value={editPortalForm.contact_name} onChange={e=>setEditPortalForm(f=>({...f,contact_name:e.target.value}))} /></div>
                <div className="form-group"><label>Email *</label><input type="email" value={editPortalForm.email} onChange={e=>setEditPortalForm(f=>({...f,email:e.target.value}))} /></div>
                <div className="form-group"><label>Nova senha (vazio = manter)</label><input type="password" value={editPortalForm.password} onChange={e=>setEditPortalForm(f=>({...f,password:e.target.value}))} placeholder="min 6 chars" /></div>
                <div className="form-group"><label>Local</label>
                  <select value={editPortalForm.location_name} onChange={e=>setEditPortalForm(f=>({...f,location_name:e.target.value}))}>
                    <option value="">All locations</option>
                    {contracts.map((ct,i)=><option key={i} value={ct.location_name}>{ct.location_name}</option>)}
                    {editPortalForm.location_name && !contracts.some(c=>c.location_name===editPortalForm.location_name) && (
                      <option value={editPortalForm.location_name}>{editPortalForm.location_name}</option>
                    )}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn btn-primary" onClick={saveEditPortalUser}>✅ Salvar</button>
                <button className="btn" onClick={()=>setEditingPortalUser(null)}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
