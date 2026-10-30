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
import { useLang, pickLang } from '../hooks/useLang'
import { maskEmail, maskPhone } from '../lib/contactMask'
import { clientContact } from '../lib/clientContact'
import { newSetupToken, setupPassword, setupLink } from '../lib/passwordLink'
import { undoToast } from '../components/UndoToast'
import SetupLinkCard from '../components/SetupLinkCard'

export default function Clients() {
  const [searchParams] = useSearchParams()
  const searchId = searchParams.get('search')
  const { lang } = useLang()
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const [newLink, setNewLink] = useState(null)
  const [tab, setTab] = useState('list')
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [portalClientId, setPortalClientId] = useState('')
  const navigate = useNavigate()
  const [portalUsers, setPortalUsers] = useState([])
  const [portalForm, setPortalForm] = useState({ contact_name: '', email: '', location_name: '' })
  const [editingPortalUser, setEditingPortalUser] = useState(null)
  const [editPortalForm, setEditPortalForm] = useState({ contact_name: '', email: '', password: '', location_name: '' })
  const [bulkProvisionBusy, setBulkProvisionBusy] = useState(false)
  const [portalSchemaOk, setPortalSchemaOk] = useState(true)
  const [portalSchemaChecking, setPortalSchemaChecking] = useState(false)
  const [contracts, setContracts] = useState([])
  const [sellers, setSellers] = useState([])
  const [form, setForm] = useState({ company_name:'', contact_name:'', phone:'', email:'', address:'', service_type:'Daily cleaning', monthly_revenue:0, monthly_cost:0, notes:'' })

  const SERVICE_TYPES = ['Daily cleaning','Weekly cleaning','Night cleaning','Deep cleaning','Spot cleaning','Monthly cleaning']
  // saved value stays in EN; the screen shows the translation
  const SERVICE_TEXT = { 'Daily cleaning':['Daily cleaning','毎日清掃','Limpeza diária'], 'Weekly cleaning':['Weekly cleaning','週次清掃','Limpeza semanal'], 'Night cleaning':['Night cleaning','夜間清掃','Limpeza noturna'], 'Deep cleaning':['Deep cleaning','ディープクリーニング','Limpeza pesada'], 'Spot cleaning':['Spot cleaning','スポット清掃','Limpeza spot'], 'Monthly cleaning':['Monthly cleaning','月次清掃','Limpeza mensal'] }
  const serviceText = s => s ? L(...(SERVICE_TEXT[s] || [s, s, s])) : ''

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
          toast.error(L('Set SUPABASE_DB_URL on Vercel or use COPY SQL','VercelにSUPABASE_DB_URLを設定するか、SQLをコピーしてください','Configure SUPABASE_DB_URL na Vercel ou use COPIAR SQL'))
          openSupabaseSql()
        } else {
          toast.error(data.error || L('Setup failed','設定に失敗しました','A configuração falhou'))
        }
        return
      }
      toast.success(data.message || L('Setup done','設定が完了しました','Configuração concluída'))
      await checkPortalSchema()
    } catch (e) {
      toast.error(e.message)
    }
    setAutoSetupBusy(false)
  }

  const copyPortalSql = async () => {
    try {
      await navigator.clipboard.writeText(PORTAL_SETUP_SQL)
      toast.success(L('✅ SQL copied. Now open Supabase, paste with Ctrl+V → Run','✅ SQLをコピーしました。Supabaseを開いてCtrl+Vで貼り付け → Run','✅ SQL copiado! Agora abra o Supabase e cole com Ctrl+V → Run'))
    } catch {
      toast.error(L('Could not copy: select the SQL below by hand','コピーできませんでした。下のSQLを手動で選択してください','Não foi possível copiar: selecione o SQL abaixo à mão'))
    }
  }

  const openSupabaseSql = () => {
    window.open(SUPABASE_SQL_URL, '_blank')
    toast(L('Paste the SQL (Ctrl+V) and click RUN','SQLを貼り付けて（Ctrl+V）RUNを押してください','Cole o SQL (Ctrl+V) e clique RUN'))
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
    if (!portalClientId || !portalForm.email || !portalForm.contact_name) {
      return toast.error(L('Name and e-mail are required','氏名とメールは必須です','Nome e e-mail são obrigatórios'))
    }
    if (!portalSchemaOk) {
      return toast.error(L('First run the SQL in Supabase (COPY SQL button above)','先にSupabaseでSQLを実行してください（上の「SQLをコピー」）','Primeiro rode o SQL no Supabase (botão COPIAR SQL acima)'))
    }
    // v1.0.117 · the person creates their own password through a one-time link
    const token = newSetupToken()
    const email = portalForm.email.trim().toLowerCase()
    const client = clients.find(c => c.id === portalClientId)
    const { error } = await supabase.from('client_users').insert({
      client_id: portalClientId,
      client_name: client?.company_name || '',
      location_name: portalForm.location_name || null,
      contact_name: portalForm.contact_name,
      email,
      password: setupPassword(token),
      is_active: true,
    })
    if (error) {
      if (error.message?.includes('client_users')) {
        setPortalSchemaOk(false)
        return toast.error(L('The client_users table does not exist. Click "Copy SQL" and run it in Supabase.','client_usersテーブルがありません。「SQLをコピー」してSupabaseで実行してください。','A tabela client_users não existe. Clique em "Copiar SQL" e rode no Supabase.'))
      }
      return toast.error(error.message)
    }
    toast.success(L('Portal login created','ポータルのログインを作成しました','Login do portal criado'))
    setNewLink({ name: portalForm.contact_name, url: setupLink('client', email, token) })
    setPortalForm({ contact_name: '', email: '', location_name: '' })
    loadPortal(portalClientId)
  }

  const togglePortalUser = async (u) => {
    const id = u.id, active = u.is_active
    if (active && !(await askConfirm({
      title: L(`Disable ${u.contact_name || u.email}?`, `${u.contact_name || u.email}を無効にしますか？`, `Desativar ${u.contact_name || u.email}?`),
      message: L('This login can no longer open the client portal. Reports, invoices and messages are kept. You can enable it again.', 'このログインではお客様ポータルを開けなくなります。報告書・請求書・メッセージは残ります。再度有効にできます。', 'Este login não consegue mais abrir o portal do cliente. Relatórios, faturas e mensagens ficam guardados. Dá para reativar.'),
      confirmLabel: L('Disable','無効にする','Desativar'), danger: true,
    }))) return
    const { error } = await supabase.from('client_users').update({ is_active: !active }).eq('id', id)
    if (error) return toast.error(error.message)
    loadPortal(portalClientId)
    if (active) undoToast(L('Login disabled','ログインを無効にしました','Login desativado'), () => supabase.from('client_users').update({ is_active: true }).eq('id', id), lang, () => loadPortal(portalClientId))
  }

  const deletePortalUser = async (u) => {
    if (!(await askConfirm({
      title: L(`Delete the login of ${u.contact_name || u.email}?`, `${u.contact_name || u.email}のログインを削除しますか？`, `Excluir o login de ${u.contact_name || u.email}?`),
      message: L('The person can no longer sign in to the portal and the login cannot be recovered. The client, reports and invoices stay. To pause it instead, use Disable.', 'ポータルにログインできなくなり、ログインは元に戻せません。顧客・報告書・請求書は残ります。一時停止なら「無効にする」を使ってください。', 'A pessoa não entra mais no portal e o login não volta. Cliente, relatórios e faturas continuam. Para só pausar, use Desativar.'),
      confirmLabel: L('Delete login','ログインを削除','Excluir login'), danger: true,
    }))) return
    const { error } = await supabase.from('client_users').delete().eq('id', u.id)
    if (error) return toast.error(error.message)
    toast.success(L('Login deleted','ログインを削除しました','Login excluído'))
    loadPortal(portalClientId)
  }

  const sendPortalPasswordLink = async (u) => {
    if (!u.email) return toast.error(L('This login has no e-mail','メールが登録されていません','Este login não tem e-mail'))
    if (!(await askConfirm({
      title: L('New password link?','パスワード設定リンクを作成しますか？','Criar link de senha?'),
      message: L('The current password of this login stops working now. The person signs in again after opening the link and creating their own password.', 'このログインの現在のパスワードはすぐに使えなくなります。リンクから自分のパスワードを作成すると、再びログインできます。', 'A senha atual deste login para de funcionar agora. A pessoa entra de novo depois de abrir o link e criar a própria senha.'),
      confirmLabel: L('Create link','リンクを作成','Criar link'), danger: true,
    }))) return
    const token = newSetupToken()
    const { error } = await supabase.from('client_users').update({ password: setupPassword(token) }).eq('id', u.id)
    if (error) return toast.error(error.message)
    setEditingPortalUser(null)
    setNewLink({ name: u.contact_name || u.email, url: setupLink('client', u.email, token) })
  }

  const openEditPortalUser = (u) => {
    setEditingPortalUser(u)
    setEditPortalForm({
      contact_name: u.contact_name || '',
      email: u.email || '',
      location_name: u.location_name || '',
    })
  }

  const saveEditPortalUser = async () => {
    if (!editingPortalUser) return
    if (!editPortalForm.email?.trim()) return toast.error(L('E-mail is required','メールは必須です','E-mail é obrigatório'))
    const patch = {
      contact_name: editPortalForm.contact_name.trim(),
      email: editPortalForm.email.trim().toLowerCase(),
      location_name: editPortalForm.location_name || null,
    }
    const client = clients.find(c => c.id === portalClientId)
    if (client) patch.client_name = client.company_name
    const { error } = await supabase.from('client_users').update(patch).eq('id', editingPortalUser.id)
    if (error) return toast.error(error.message)
    toast.success(L('Portal login updated','ポータルのログインを更新しました','Login do portal atualizado'))
    setEditingPortalUser(null)
    loadPortal(portalClientId)
  }

  const [newPasswords, setNewPasswords] = useState(null) // shown once after creating store accounts
  const provisionAllStores = async () => {
    if (!portalSchemaOk) return toast.error(L('First run the SQL in Supabase','先にSupabaseでSQLを実行してください','Primeiro rode o SQL no Supabase'))
    if (!(await askConfirm({ message: L(`Create/update ${getPortalStores().length} logins (On The Planet + Atomic)?\nNew logins get their own password; existing ones keep their current password.`, `${getPortalStores().length}件のログインを作成・更新しますか？（On The Planet + Atomic）\n新しいログインには個別のパスワードが付き、既存のログインは今のパスワードのままです。`, `Criar/atualizar ${getPortalStores().length} contas (On The Planet + Atomic)?\nContas novas recebem senha própria; as existentes mantêm a senha atual.`), danger: false }))) return
    setBulkProvisionBusy(true)
    try {
      const results = await provisionAllStoreAccounts(supabase, clients)
      const msg = L(`✅ ${results.created} created, ${results.updated} updated, ${results.contracts} new contracts`, `✅ 作成${results.created}件・更新${results.updated}件・新規契約${results.contracts}件`, `✅ ${results.created} criadas, ${results.updated} atualizadas, ${results.contracts} contratos novos`)
      if (results.errors.length) toast.error(L(`${results.errors.length} errors (see console)`, `エラー${results.errors.length}件（コンソール参照）`, `${results.errors.length} erros (veja o console)`))
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
    if (!form.company_name) return toast.error(L('Company name is required','会社名は必須です','Nome da empresa é obrigatório'))
    if (editing) {
      const { error } = await supabase.from('clients').update({ ...form, monthly_revenue:parseFloat(form.monthly_revenue)||0, monthly_cost:parseFloat(form.monthly_cost)||0 }).eq('id', editing)
      if (error) return toast.error(error.message)
      toast.success(L('Client updated','顧客を更新しました','Cliente atualizado'))
    } else {
      const { error } = await supabase.from('clients').insert({ ...form, monthly_revenue:parseFloat(form.monthly_revenue)||0, monthly_cost:parseFloat(form.monthly_cost)||0, is_active:true })
      if (error) return toast.error(error.message)
      toast.success(L('Client registered','顧客を登録しました','Cliente cadastrado'))
    }
    setForm({ company_name:'', contact_name:'', phone:'', email:'', address:'', service_type:'Daily cleaning', monthly_revenue:0, monthly_cost:0, notes:'' })
    setEditing(null); setTab('list'); load()
  }

  const handleEdit = (c) => {
    setForm({ company_name:c.company_name||'', contact_name:c.contact_name||'', phone:c.phone||'', email:c.email||'', address:c.address||'', service_type:c.service_type||'Daily cleaning', monthly_revenue:c.monthly_revenue||0, monthly_cost:c.monthly_cost||0, notes:c.notes||'' })
    setEditing(c.id); setTab('register')
  }

  const handleDelete = async (id, name) => {
    if (!(await askConfirm({ title: L(`Delete ${name}?`, `${name}を削除しますか？`, `Excluir ${name}?`), message: L('The client is deleted for good and cannot be recovered. If it has contracts, invoices, logins or jobs, deleting is blocked: use Deactivate instead (keeps the history).', '顧客は完全に削除され、元に戻せません。契約・請求書・ログイン・作業がある場合は削除できないので「無効にする」を使ってください（履歴は残ります）。', 'O cliente é apagado de vez e não volta. Se ele tiver contratos, faturas, logins ou jobs, a exclusão é bloqueada: use Desativar (mantém o histórico).'), confirmLabel: L('Delete forever','完全に削除','Excluir de vez'), danger: true }))) return
    const { error } = await supabase.from('clients').delete().eq('id', id)
    if (error) return toast.error(/foreign key|violates/i.test(error.message) ? L('This client has linked records (contracts, invoices, logins). Use Deactivate instead.','この顧客には関連データ（契約・請求書・ログイン）があります。「無効にする」を使ってください。','Este cliente tem registros ligados (contratos, faturas, logins). Use Desativar.') : error.message)
    toast.success(L('Client deleted','顧客を削除しました','Cliente excluído'))
    load()
  }

  // v1.0.56 · Seller responsible for the account: gets this client's quote requests and
  // earns the extra they add on top of the company price.
  const assignSeller = async (c, salespersonId) => {
    const { error } = await supabase.from('clients').update({ salesperson_id: salespersonId || null }).eq('id', c.id)
    if (error) return toast.error(/salesperson_id/.test(error.message) ? L('Run sql/2026-10-17_orcamento_vendedor.sql first','先に sql/2026-10-17_orcamento_vendedor.sql を実行してください','Rode primeiro sql/2026-10-17_orcamento_vendedor.sql') : error.message)
    setClients(list => list.map(x => x.id === c.id ? { ...x, salesperson_id: salespersonId || null } : x))
    toast.success(salespersonId ? `${L('Seller','営業担当','Vendedor')}: ${sellers.find(p => p.id === salespersonId)?.full_name || ''}` : L('Seller removed','営業担当を外しました','Vendedor removido'))
  }

  const handleToggle = async (id, current, name) => {
    if (current && !(await askConfirm({
      title: L(`Deactivate ${name}?`, `${name}を無効にしますか？`, `Desativar ${name}?`),
      message: L('The client leaves the active lists, new jobs and the monthly totals. Contracts, invoices and history are kept. You can activate again.', '有効な一覧・新しい作業・月の合計から外れます。契約・請求書・履歴は残ります。再度有効にできます。', 'O cliente sai das listas ativas, dos jobs novos e dos totais do mês. Contratos, faturas e histórico ficam guardados. Dá para reativar.'),
      confirmLabel: L('Deactivate','無効にする','Desativar'), danger: true,
    }))) return
    const { error } = await supabase.from('clients').update({ is_active:!current }).eq('id', id)
    if (error) return toast.error(error.message)
    load()
    if (current) undoToast(L('Client deactivated','顧客を無効にしました','Cliente desativado'), () => supabase.from('clients').update({ is_active: true }).eq('id', id), lang, load)
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
        <button className={`tab-pill${tab==='list'?' active':''}`} onClick={()=>{setTab('list');setEditing(null);setForm({ company_name:'', contact_name:'', phone:'', email:'', address:'', service_type:'Daily cleaning', monthly_revenue:0, monthly_cost:0, notes:'' })}}>{L('List','一覧','Lista')} ({clients.length})</button>
        <button className={`tab-pill${tab==='register'?' active':''}`} onClick={()=>setTab('register')}>{editing?`✏️ ${L('Edit','編集','Editar')}`:`+ ${L('Register','登録','Cadastrar')}`}</button>
        <button className={`tab-pill${tab==='services'?' active':''}`} onClick={()=>setTab('services')}>{L('Services','サービス','Serviços')}</button>
        <button className={`tab-pill${tab==='portal'?' active':''}`} onClick={()=>setTab('portal')}>🔐 {L('Portal','ポータル','Portal')}</button>
        <button className={`tab-pill${tab==='care'?' active':''}`} onClick={()=>setTab('care')}>🤝 {L('Manager & stores','担当者・店舗','Gerente e lojas')}</button>
        <button className="tab-pill" onClick={()=>navigate('/facility')}>🌏 Kuripuro World</button>
      </div>

      {newLink && <SetupLinkCard name={newLink.name} url={newLink.url} lang={lang} onClose={()=>setNewLink(null)} />}

      {tab==='care'&&<ClientCareAdmin clients={clients} onClientsChanged={load} />}

      {/* LIST */}
      {tab==='list'&&(
        <div>
          {loading&&<div aria-busy="true" aria-label={L('Loading…','読み込み中…','Carregando…')}>{[0,1,2].map(i => <div key={i} className="kp-skel kp-skel-row" />)}</div>}
          {!loading&&clients.length===0&&<div className="card" style={{fontSize:13,color:'var(--text2)'}}>{L('No clients yet. Tap “+ Register” to add the first one; then add its places and contracts.','顧客はまだいません。「+ 登録」から最初の顧客を追加し、その後に拠点と契約を追加してください。','Nenhum cliente ainda. Toque em “+ Cadastrar” para criar o primeiro; depois cadastre os locais e contratos dele.')}</div>}
          {(searchId ? clients.filter(c => c.id === searchId) : clients).map(c=>{
            const profit = c.monthly_cost == null ? null : Number(c.monthly_revenue||0) - Number(c.monthly_cost||0)
            const margin = marginPct(c.monthly_revenue, c.monthly_cost)
            return (
              <div key={c.id} className="card" style={{marginBottom:14}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:12}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:16}}><ClientLink id={c.id} name={c.company_name} /></div>
                    <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{[clientContact(c).name, maskPhone(clientContact(c).phone)].filter(Boolean).join(' · ') || '—'}</div>
                    <div style={{fontSize:12,color:'var(--text3)'}}>{serviceText(c.service_type)}</div>
                  </div>
                  <span className={`badge ${c.is_active?'badge-green':'badge-red'}`}>{c.is_active?L('Active','有効','Ativo'):L('Inactive','無効','Inativo')}</span>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:12}}>
                  <div style={{background:'var(--surface2)',borderRadius:8,padding:'8px 10px',textAlign:'center'}}>
                    <div style={{fontSize:14,fontWeight:700}}>¥{Number(c.monthly_revenue||0).toLocaleString()}</div>
                    <div style={{fontSize:10,color:'var(--text3)'}}>{L('Revenue','売上','Receita')}</div>
                  </div>
                  <div style={{background:'var(--surface2)',borderRadius:8,padding:'8px 10px',textAlign:'center'}}>
                    <div style={{fontSize:14,fontWeight:700,color:profit != null && profit < 0 ? 'var(--red)' : 'var(--green)'}}>{profit == null ? '—' : `${profit < 0 ? '−' : ''}¥${Math.abs(profit).toLocaleString()}`}</div>
                    <div style={{fontSize:10,color:'var(--text3)'}}>{L('Profit','利益','Lucro')}{costMonth ? ` (${costMonth})` : ''}</div>
                  </div>
                  <div style={{background:'var(--surface2)',borderRadius:8,padding:'8px 10px',textAlign:'center'}}>
                    <div style={{fontSize:14,fontWeight:700,color:margin==null?'var(--text3)':margin>=70?'var(--green)':margin>=50?'#EF9F27':'var(--red)'}} title={margin==null?L('No completed job last month: cost unknown','先月の完了作業がないため原価不明','Nenhum job concluído no mês passado: custo desconhecido'):''}>{margin == null ? '—' : `${margin}%`}</div>
                    <div style={{fontSize:10,color:'var(--text3)'}}>{L('Margin','利益率','Margem')}</div>
                  </div>
                </div>
                {c.notes&&<div style={{fontSize:12,color:'var(--text2)',background:'var(--surface2)',borderRadius:8,padding:'8px 10px',marginBottom:10}}>{c.notes}</div>}
                <label className="client-seller-row">
                  <span>👤 {L('Seller','営業担当','Vendedor')}</span>
                  <select value={c.salesperson_id || ''} onChange={e => assignSeller(c, e.target.value)}>
                    <option value="">— {L('No seller','担当なし','Sem vendedor')} —</option>
                    {sellers.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                    {c.salesperson_id && !sellers.some(p => p.id === c.salesperson_id) && <option value={c.salesperson_id}>…</option>}
                  </select>
                </label>
                <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                  <button className="btn btn-sm btn-primary" onClick={()=>handleEdit(c)}>✏️ {L('Edit','編集','Editar')}</button>
                  <button className="btn btn-sm" onClick={()=>navigate(`/jobs?tab=locations&client=${c.id}`)}>📍 {L('Places','拠点','Locais')}</button>
                  <button className="btn btn-sm" onClick={()=>navigate(`/contracts?client=${c.id}`)}>📄 {L('Contracts','契約','Contratos')}</button>
                  <button className="btn btn-sm" onClick={()=>{setPortalClientId(c.id);setTab('portal')}}>🔐 {L('Portal','ポータル','Portal')}</button>
                  <button className="btn btn-sm" onClick={()=>navigate(`/facility?client=${c.id}`)}>🏢 3D</button>
                  <button className="btn btn-sm" onClick={()=>handleToggle(c.id,c.is_active,c.company_name)}>{c.is_active?L('Deactivate','無効にする','Desativar'):L('Activate','有効にする','Ativar')}</button>
                  <button className="btn btn-sm btn-danger" onClick={()=>handleDelete(c.id,c.company_name)}>🗑 {L('Delete','削除','Excluir')}</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* REGISTER / EDIT */}
      {tab==='register'&&(
        <div className="card">
          <div className="card-title">{editing?L('Edit Client','顧客を編集','Editar cliente'):L('New Client','顧客の新規登録','Novo cliente')}</div>
          <div className="grid-2">
            <div className="form-group" style={{gridColumn:'1/-1'}}><label>{L('Company Name','会社名','Nome da empresa')} *</label><input value={form.company_name} onChange={e=>upd('company_name',e.target.value)} placeholder="Hotel Grand" /></div>
            <div className="form-group"><label>{L('Contact person','担当者','Contato do cliente')}</label><input value={form.contact_name} onChange={e=>upd('contact_name',e.target.value)} placeholder="Tanaka Hiroshi" /></div>
            <div className="form-group"><label>{L('Phone','電話','Telefone')}</label><input value={form.phone} onChange={e=>upd('phone',e.target.value)} placeholder="03-1111-2222" /></div>
            <div className="form-group"><label>E-mail</label><input type="email" value={form.email} onChange={e=>upd('email',e.target.value)} /></div>
            <div className="form-group"><label>{L('Service Type','サービス種別','Tipo de serviço')}</label>
              <select value={form.service_type} onChange={e=>upd('service_type',e.target.value)}>
                {SERVICE_TYPES.map(s=><option key={s} value={s}>{serviceText(s)}</option>)}
              </select>
            </div>
            <div className="form-group" style={{gridColumn:'1/-1',fontSize:12,color:'var(--text3)'}}>💴 {L("Monthly revenue comes from the client's contracts (Contracts) and the cost from the team's real work. They are not typed here.",'月の売上は顧客の契約（契約）から、原価はチームの実際の作業から計算します。ここでは入力しません。','A receita mensal vem dos contratos do cliente (Contratos) e o custo vem do trabalho real da equipe. Eles não são digitados aqui.')}
              <div style={{marginTop:4}}>👤 {L('The contact person is registered only here (or in the client sheet). Contracts and the portal read it from here.','担当者はここ（または顧客シート）だけで登録します。契約やポータルはここから読み込みます。','O contato do cliente é cadastrado só aqui (ou na ficha do cliente). Contratos e portal leem daqui.')}</div></div>
            <div className="form-group" style={{gridColumn:'1/-1'}}><label>{L('Address','住所','Endereço')}</label><input value={form.address} onChange={e=>upd('address',e.target.value)} /></div>
            <div className="form-group" style={{gridColumn:'1/-1'}}><label>{L('Notes','メモ','Observações')}</label><textarea value={form.notes} onChange={e=>upd('notes',e.target.value)} /></div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-primary" onClick={handleSave}>{editing?`✅ ${L('Update','更新','Atualizar')}`:`✅ ${L('Register','登録','Cadastrar')}`}</button>
            <button className="btn" onClick={()=>{setEditing(null);setTab('list')}}>{L('Cancel','キャンセル','Cancelar')}</button>
          </div>
        </div>
      )}

      {/* SERVICES */}
      {tab==='services'&&(
        <div className="card">
          <div className="card-title">{L('Services Overview','サービス概要','Resumo dos serviços')}</div>
          <table>
            <thead>
              <tr><th>{L('Company','会社','Empresa')}</th><th>{L('Service','サービス','Serviço')}</th><th>{L('Revenue','売上','Receita')}</th><th>{L('Cost','原価','Custo')}</th><th>{L('Profit','利益','Lucro')}</th><th>{L('Margin','利益率','Margem')}</th></tr>
            </thead>
            <tbody>
              {clients.filter(c=>c.is_active).map(c=>{
                const profit = c.monthly_cost == null ? null : Number(c.monthly_revenue||0)-Number(c.monthly_cost||0)
                const margin = marginPct(c.monthly_revenue, c.monthly_cost)
                return (
                  <tr key={c.id}>
                    <td style={{fontWeight:500}}><ClientLink id={c.id} name={c.company_name} /></td>
                    <td>{serviceText(c.service_type)}</td>
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
            {[[L('Total Revenue','売上合計','Receita total'),totalRevenue,'var(--text)'],[L('Total Cost','原価合計','Custo total'),totalCost,'var(--red)'],[L('Total Profit','利益合計','Lucro total'),totalProfit,'var(--green)']].map(([l,v,color])=>(
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
                ⚠️ {L('Setup needed (only once)','初回設定が必要です（1回のみ）','Configuração necessária (só 1 vez)')}
              </div>
              {!portalSchemaOk && (
                <p style={{ fontSize: 14, color: 'var(--text2)', margin: '0 0 12px' }}>
                  {L('The client portal tables do not exist in Supabase yet.','お客様ポータルのテーブルがSupabaseにまだありません。','As tabelas do portal do cliente ainda não existem no Supabase.')}
                </p>
              )}
              {portalSchemaOk && !storageOk && (
                <p style={{ fontSize: 14, color: 'var(--text2)', margin: '0 0 12px' }}>
                  {L('Photo bucket','写真バケット','Bucket de fotos')} (<code>service-photos</code>) {L('is not set up: reports with photos do not work.','が未設定のため、写真付きの報告書が使えません。','não configurado: relatórios com foto não funcionam.')}
                </p>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                <button className="btn btn-primary" onClick={runAutoSetup} disabled={autoSetupBusy} type="button" style={{ fontSize: 15, padding: '12px 20px', fontWeight: 800 }}>
                  {autoSetupBusy ? L('Setting up…','設定中…','Configurando…') : `⚡ ${L('Set up automatically','自動で設定','Configurar automaticamente')}`}
                </button>
                <button className="btn btn-primary" onClick={copyPortalSql} type="button" style={{ fontSize: 15, padding: '12px 20px', fontWeight: 800 }}>
                  📋 {L('COPY SQL','SQLをコピー','COPIAR SQL')}
                </button>
                <button className="btn" onClick={openSupabaseSql} type="button" style={{ fontSize: 15, padding: '12px 20px', fontWeight: 700 }}>
                  🔗 {L('OPEN SUPABASE','Supabaseを開く','ABRIR SUPABASE')}
                </button>
                <button className="btn" onClick={checkPortalSchema} disabled={portalSchemaChecking} type="button">
                  {portalSchemaChecking ? '…' : `🔄 ${L('Check','確認','Verificar')}`}
                </button>
              </div>
              <ol style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
                <li>{L('Automatic: add','自動：Vercelに','Automático: adicione')} <code>SUPABASE_DB_URL</code> {L('on Vercel and click Set up automatically','を追加して「自動で設定」を押す','na Vercel e clique em Configurar automaticamente')}</li>
                <li>{L('Manual: COPY SQL → OPEN SUPABASE → RUN','手動：SQLをコピー → Supabaseを開く → RUN','Manual: COPIAR SQL → ABRIR SUPABASE → RUN')}</li>
              </ol>
              <textarea readOnly value={PORTAL_SETUP_SQL} onClick={e => e.target.select()} style={{ width: '100%', height: 120, marginTop: 14, fontSize: 10, fontFamily: 'monospace', background: '#0a1525', color: '#94a3b8', border: '1px solid var(--border)', borderRadius: 8, padding: 10, boxSizing: 'border-box' }} />
            </div>
          )}
          {newPasswords && (
            <div className="card" style={{marginBottom:14,border:'1px solid var(--amber)'}}>
              <div className="card-title">🔑 {L('Passwords of the new logins: note them now, they are not shown again','新しいログインのパスワード：今メモしてください。再表示されません','Senhas das contas novas: anote agora, elas não aparecem de novo')}</div>
              <table style={{width:'100%',fontSize:13}}><tbody>
                {newPasswords.map(p => <tr key={p.email}><td>{p.store}</td><td style={{color:'var(--text3)'}}>{p.email}</td><td><code>{p.password}</code></td></tr>)}
              </tbody></table>
              <div style={{display:'flex',gap:8,marginTop:10}}>
                <button className="btn btn-sm" type="button" onClick={() => navigator.clipboard?.writeText(newPasswords.map(p => `${p.store}\t${p.email}\t${p.password}`).join('\n')).then(() => toast.success(L('Copied','コピーしました','Copiado')))}>📋 {L('Copy','コピー','Copiar')}</button>
                <button className="btn btn-sm btn-primary" type="button" onClick={() => setNewPasswords(null)}>{L('Noted','メモしました','Já anotei')}</button>
              </div>
            </div>
          )}
          <div className="card" style={{marginBottom:14}}>
            <div className="card-title">🔐 {L('Client Portal Logins','お客様ポータルのログイン','Logins do portal do cliente')}</div>
            <div style={{fontSize:12,color:'var(--text3)',marginBottom:12}}>
              {L('One login per store. Sign in with the place name or e-mail. Each person creates their own password through a link (🔑 on the login).','店舗ごとに1つのログイン。拠点名またはメールでログインします。パスワードは本人がリンクから作成します（ログインの🔑）。','Uma conta por loja. Login com o nome do local ou e-mail. Cada pessoa cria a própria senha por link (🔑 na conta).')}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              <button className="btn btn-primary" onClick={provisionAllStores} disabled={bulkProvisionBusy || !portalSchemaOk} type="button">
                {bulkProvisionBusy ? L('Creating…','作成中…','Criando…') : `🏪 ${L('Create logins for all stores (OTP + Atomic)','全店舗のログインを作成（OTP + Atomic）','Criar contas de todas as lojas (OTP + Atomic)')}`}
              </button>
            </div>
            <div className="form-group">
              <label>{L('Client','顧客','Cliente')}</label>
              <select value={portalClientId} onChange={e=>setPortalClientId(e.target.value)}>
                <option value="">— {L('Select client','顧客を選択','Escolha o cliente')} —</option>
                {clients.filter(c=>c.is_active).map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
            {portalClientId && (
              <>
                <div className="grid-2" style={{marginTop:12}}>
                  <div className="form-group"><label>{L('Name of the person','利用者の氏名','Nome da pessoa')} *</label><input value={portalForm.contact_name} onChange={e=>setPortalForm(f=>({...f,contact_name:e.target.value}))} placeholder="Tanaka Hiroshi" /></div>
                  <div className="form-group"><label>E-mail *</label><input type="email" value={portalForm.email} onChange={e=>setPortalForm(f=>({...f,email:e.target.value}))} /></div>
                  <div className="form-group"><label>{L('Store (optional)','店舗（任意）','Loja (opcional)')}</label>
                    <select value={portalForm.location_name} onChange={e=>setPortalForm(f=>({...f,location_name:e.target.value}))}>
                      <option value="">{L('All locations','全店舗','Todos os locais')}</option>
                      {contracts.map((ct,i)=><option key={i} value={ct.location_name}>{ct.location_name}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{fontSize:12,color:'var(--text3)'}}>🔑 {L('No password here: after creating you get a link for the person to create their own password.','ここではパスワードを入力しません。作成後、本人がパスワードを作成するリンクが表示されます。','Sem senha aqui: depois de criar aparece um link para a pessoa criar a própria senha.')}</div>
                <button className="btn btn-primary" onClick={createPortalUser} style={{marginTop:8}}>✅ {L('Create Portal Login','ポータルのログインを作成','Criar login do portal')}</button>
              </>
            )}
          </div>

          {portalClientId && (
            <div className="card">
              <div className="card-title">{L('Portal Logins','ポータルのログイン','Logins do portal')} ({portalUsers.length})</div>
              {portalUsers.length===0 && <div style={{color:'var(--text3)',fontSize:13}}>{L('No portal logins yet. Create one above so the client can see reports and invoices.','ポータルのログインはまだありません。上で作成すると、お客様が報告書と請求書を見られます。','Nenhum login do portal ainda. Crie um acima para o cliente ver relatórios e faturas.')}</div>}
              <table>
                <thead><tr><th>{L('Name','氏名','Nome')}</th><th>{L('Login','ログイン','Login')}</th><th>{L('Location','拠点','Local')}</th><th>{L('Status','状態','Situação')}</th><th></th></tr></thead>
                <tbody>
                  {portalUsers.map(u=>(
                    <tr key={u.id}>
                      <td style={{fontWeight:500}}>{u.contact_name}</td>
                      <td style={{fontSize:12}}>
                        <div>{u.location_name || '—'}</div>
                        <div style={{color:'var(--text3)',fontSize:11}}>{maskEmail(u.email)}</div>
                      </td>
                      <td style={{fontSize:12}}>{u.location_name||L('All','すべて','Todos')}</td>
                      <td><span className={`badge ${u.is_active?'badge-green':'badge-red'}`}>{u.is_active?L('Active','有効','Ativo'):L('Inactive','無効','Inativo')}</span></td>
                      <td style={{display:'flex',gap:4}}>
                        <button className="btn btn-sm btn-primary" onClick={()=>openEditPortalUser(u)}>✏️</button>
                        <button className="btn btn-sm" title={L('Password link','パスワード設定リンク','Link de senha')} onClick={()=>sendPortalPasswordLink(u)}>🔑</button>
                        <button className="btn btn-sm" onClick={()=>togglePortalUser(u)}>{u.is_active?L('Disable','無効にする','Desativar'):L('Enable','有効にする','Ativar')}</button>
                        <button className="btn btn-sm btn-danger" aria-label={L('Delete login','ログインを削除','Excluir login')} onClick={()=>deletePortalUser(u)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {editingPortalUser && (
            <div className="card" style={{ marginTop: 14, border: '2px solid #315cf5' }}>
              <div className="card-title">✏️ {L('Edit login','ログインを編集','Editar conta')} — {editingPortalUser.contact_name}</div>
              <div className="grid-2" style={{ marginTop: 12 }}>
                <div className="form-group"><label>{L('Name of the person','利用者の氏名','Nome da pessoa')}</label><input value={editPortalForm.contact_name} onChange={e=>setEditPortalForm(f=>({...f,contact_name:e.target.value}))} /></div>
                <div className="form-group"><label>E-mail *</label><input type="email" value={editPortalForm.email} onChange={e=>setEditPortalForm(f=>({...f,email:e.target.value}))} /></div>
                <div className="form-group"><label>{L('Password','パスワード','Senha')}</label><button type="button" className="btn btn-sm" onClick={()=>sendPortalPasswordLink(editingPortalUser)}>🔑 {L('Send a link to create a new password','新しいパスワードを作成するリンクを送る','Enviar link para criar nova senha')}</button></div>
                <div className="form-group"><label>{L('Location','拠点','Local')}</label>
                  <select value={editPortalForm.location_name} onChange={e=>setEditPortalForm(f=>({...f,location_name:e.target.value}))}>
                    <option value="">{L('All locations','全店舗','Todos os locais')}</option>
                    {contracts.map((ct,i)=><option key={i} value={ct.location_name}>{ct.location_name}</option>)}
                    {editPortalForm.location_name && !contracts.some(c=>c.location_name===editPortalForm.location_name) && (
                      <option value={editPortalForm.location_name}>{editPortalForm.location_name}</option>
                    )}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn btn-primary" onClick={saveEditPortalUser}>✅ {L('Save','保存','Salvar')}</button>
                <button className="btn" onClick={()=>setEditingPortalUser(null)}>{L('Cancel','キャンセル','Cancelar')}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
