import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { hasMapsLink, mapsOpenUrl } from '../lib/mapsLink'
import toast from 'react-hot-toast'
import { useSearchParams } from 'react-router-dom'
import { contractDraftFromQuote, clientForQuote } from '../lib/quoteContract'
import SpotContracts from '../components/SpotContracts'
import DeepCleanTracker from '../components/DeepCleanTracker'
import { spotContractHtml, recurringToContract, contractDetailsDefaults, cleanContractDetails } from '../lib/spotContract'
import ContractDetailsFields from '../components/ContractDetailsFields'
import { showPrintOverlay } from '../lib/openPrintHtml'
import { saveContractPdf, contractPdfUrl } from '../lib/spotContractOps'
import { sellerFields } from '../lib/spotContract'
import { fetchContractSellers } from '../lib/contractSellers'
import SellerCommissionFields from '../components/SellerCommissionFields'
import SetupChain from '../components/SetupChain'
import KeyReveal from '../components/KeyReveal'
import KeyRevealLog from '../components/KeyRevealLog'
import { contractMonthly, contractGross, contractIssues, groupByStore } from '../lib/money'
import { askConfirm } from '../components/ConfirmDialog'
import { splitChecklist } from '../lib/agenda'
import { ensurePlaceForContract } from '../lib/places'
import '../components/agenda.css'
import { useLang, pickLang } from '../hooks/useLang'
import SkeletonRows from '../components/SkeletonRows'
import { undoToast } from '../components/UndoToast'

const NO_SELLER = { salesperson_id:'', salesperson_name:'', commission_type:null, commission_value:null, commission_amount:0 }

const ISSUE_TEXT = {
  zero_value: ['¥0/month: remove or merge into the store', '月額¥0：削除するか店舗の契約にまとめてください', '¥0/mês: remova ou junte ao contrato da loja'],
  zero_visits: ['0 visits/month: bills nothing. Remove it or set the days', '月0回：請求が発生しません。削除するか曜日を設定してください', '0 visitas/mês: não cobra nada. Remova ou marque os dias'],
  generic_deep: ['Generic "Deep Clean ¥5,000": merge into the store contract or describe it', '汎用の「Deep Clean ¥5,000」：店舗の契約にまとめるか内容を書いてください', '"Deep Clean ¥5.000" genérico: junte ao contrato da loja ou descreva'],
  stored_mismatch: ['Saved total differs from visits × price: open and save to fix', '保存済みの合計が回数×単価と違います：開いて保存すると直ります', 'Total salvo diferente de visitas × preço: abra e salve para corrigir'],
}
// saved values stay in EN (other screens and the contract read them); the screen shows the translation
const DAY_TEXT = { Mon:['Mon','月','Seg'], Tue:['Tue','火','Ter'], Wed:['Wed','水','Qua'], Thu:['Thu','木','Qui'], Fri:['Fri','金','Sex'], Sat:['Sat','土','Sáb'], Sun:['Sun','日','Dom'] }
const SERVICE_TEXT = { 'Basic Cleaning':['Basic Cleaning','基本清掃','Limpeza básica'], 'Deep Cleaning':['Deep Cleaning','ディープクリーニング','Limpeza pesada'], 'Range Hood':['Range Hood','レンジフード','Coifa'], 'AC Cleaning':['AC Cleaning','エアコン清掃','Limpeza de ar-condicionado'], 'Grease Trap':['Grease Trap','グリストラップ','Caixa de gordura'], 'Window Cleaning':['Window Cleaning','窓清掃','Limpeza de janelas'], 'Floor Wax':['Floor Wax','床ワックス','Cera no piso'], 'Spot Cleaning':['Spot Cleaning','スポット清掃','Limpeza spot'] }

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const SERVICE_TYPES = ['Basic Cleaning','Deep Cleaning','Range Hood','AC Cleaning','Grease Trap','Window Cleaning','Floor Wax','Spot Cleaning']

export default function ServiceContracts() {
  const [params] = useSearchParams()
  const { lang } = useLang()
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const [view, setView] = useState(params.get('spot') ? 'spot' : params.get('deep') ? 'deep' : 'locations')
  return (
    <div>
      <div className="tab-pills">
        <button type="button" className={`tab-pill${view==='locations'?' active':''}`} onClick={()=>setView('locations')}>📋 {L('Recurring locations','定期契約の拠点','Locais recorrentes')}</button>
        <button type="button" className={`tab-pill${view==='spot'?' active':''}`} onClick={()=>setView('spot')}>⚡ {L('Spot contracts','スポット契約','Contratos spot')}</button>
        <button type="button" className={`tab-pill${view==='deep'?' active':''}`} onClick={()=>setView('deep')}>✨ {L('On The Planet deep cleaning','On The Planet ディープクリーニング','Limpeza pesada On The Planet')}</button>
      </div>
      {view==='spot' ? <SpotContracts /> : view==='deep' ? <DeepCleanTracker /> : <RecurringContracts />}
    </div>
  )
}

function RecurringContracts() {
  const { lang } = useLang()
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const dayText = d => L(...(DAY_TEXT[d] || [d, d, d]))
  const serviceText = s => s ? L(...(SERVICE_TEXT[s] || [s, s, s])) : ''
  const issueText = k => ISSUE_TEXT[k] ? L(...ISSUE_TEXT[k]) : k
  const [pdfBusy, setPdfBusy] = useState('')
  const [details, setDetails] = useState(null)
  const [clients, setClients] = useState([])
  const [contracts, setContracts] = useState([])
  const [contractsLoading, setContractsLoading] = useState(true)
  const [selectedClient, setSelectedClient] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ location_name:'', location_address:'', area:'', service_type:'Basic Cleaning', billing_type:'per_visit', price_per_visit:0, fixed_monthly:0, discount_percent:0, tax_rate:10, price_includes_tax:true, billing_day:10, billing_notes:'', hours_per_visit:2, days_of_week:[], notes:'', training_video_url:'', training_checklist:'', ...NO_SELLER })
  const [sellers, setSellers] = useState({ salespeople: [], rules: [] })

  useEffect(() => { loadClients(); fetchContractSellers().then(setSellers) }, [])
  useEffect(() => { if (selectedClient) loadContracts(selectedClient) }, [selectedClient])

  const [quoteNote, setQuoteNote] = useState('')
  const loadClients = async () => {
    const { data } = await supabase.from('clients').select('*').eq('is_active',true).order('company_name')
    setClients(data||[])
    if (!data?.length) setContractsLoading(false)
    const wanted = new URLSearchParams(window.location.search).get('client')
    if (data?.length>0) setSelectedClient((data.find(c=>c.id===wanted)||data[0]).id)
    // v1.0.116 · ?fromQuote=<mitsumori id> (Quotes → "Convert to job / contract"): form filled from the quote
    const fromQuote = new URLSearchParams(window.location.search).get('fromQuote')
    if (fromQuote) {
      const { data: q } = await supabase.from('mitsumori').select('*').eq('id', fromQuote).maybeSingle()
      if (!q) return toast.error(L('Quote not found','見積が見つかりません','Orçamento não encontrado'))
      const { data: lead } = q.lead_id ? await supabase.from('sales_leads').select('site_name,address').eq('id', q.lead_id).maybeSingle() : { data: null }
      const client = clientForQuote(q, data || [])
      const draft = contractDraftFromQuote(q, lead)
      if (client) setSelectedClient(client.id)
      setEditing(null); setForm(f => ({ ...f, ...draft, salesperson_name:'' })); setShowForm(true)
      setQuoteNote(client
        ? L(`Filled from quote ${q.quote_number || ''} (${q.company_name}). Pick the days of the week, check the amount and save.`, `見積${q.quote_number || ''}（${q.company_name}）から入力しました。曜日を選び、金額を確認して保存してください。`, `Preenchido do orçamento ${q.quote_number || ''} (${q.company_name}). Escolha os dias da semana, confira o valor e salve.`)
        : L(`Quote ${q.quote_number || ''}: client "${q.company_name}" is not registered. Create it in Clients first, then convert again.`, `見積${q.quote_number || ''}：顧客「${q.company_name}」が未登録です。先に顧客に登録してから、もう一度変換してください。`, `Orçamento ${q.quote_number || ''}: o cliente "${q.company_name}" não está cadastrado. Cadastre em Clientes primeiro e converta de novo.`))
    }
  }

  const loadContracts = async (clientId) => {
    setContractsLoading(true)
    const { data } = await supabase.from('service_contracts').select('*').eq('client_id',clientId).eq('is_active',true).order('location_name')
    setContracts(data||[])
    setContractsLoading(false)
  }

  const [errors, setErrors] = useState({})
  const upd = (k,v) => { setForm(f=>({...f,[k]:v})); setErrors(e=>({ ...e, [k]: null })) }
  const fieldErr = k => errors[k] && <div className="ag-field-error">{errors[k]}</div>

  const toggleDay = (d) => setForm(f=>({ ...f, days_of_week: f.days_of_week.includes(d) ? f.days_of_week.filter(x=>x!==d) : [...f.days_of_week, d] }))

  const calcVisits = (days) => {
    const weeksPerMonth = 4.33
    return Math.round(days.length * weeksPerMonth)
  }

  const visitsPerMonth = calcVisits(form.days_of_week)
  const monthlyRevenue = visitsPerMonth * parseFloat(form.price_per_visit||0)
  const totalHours = visitsPerMonth * parseFloat(form.hours_per_visit||0)

  const handleSave = async () => {
    const errs = {}
    if (!selectedClient) errs.client = L('Pick the client first','先に顧客を選んでください','Escolha o cliente primeiro')
    if (!form.location_name.trim()) errs.location_name = L('Location name is required','拠点名は必須です','O nome do local é obrigatório')
    if ((form.billing_type||'per_visit')==='per_visit' && !(parseFloat(form.price_per_visit) > 0)) errs.price_per_visit = L('Enter the price per visit','1回あたりの料金を入力してください','Informe o preço por visita')
    if (form.billing_type==='fixed_monthly' && !(parseFloat(form.fixed_monthly) > 0)) errs.fixed_monthly = L('Enter the monthly amount','月額を入力してください','Informe o valor mensal')
    if (!(parseFloat(form.hours_per_visit) > 0)) errs.hours_per_visit = L('Enter the hours per visit','1回あたりの時間を入力してください','Informe as horas por visita')
    setErrors(errs)
    if (Object.keys(errs).length) return
    const visits = calcVisits(form.days_of_week)
    const revenue = form.billing_type==='fixed_monthly' ? parseFloat(form.fixed_monthly||0) : visits * parseFloat(form.price_per_visit||0)
    // v1.0.109 · visits × price must match the monthly total; when it does not, show the difference first.
    const byVisits = visits * (parseFloat(form.price_per_visit)||0)
    if (form.billing_type==='fixed_monthly' && byVisits > 0 && Math.round(byVisits) !== Math.round(revenue)) {
      const ok = await askConfirm({ title: L('Visits × price ≠ monthly total','回数×単価 ≠ 月額','Visitas × preço ≠ total mensal'), message: `${visits} ${L('visits','回','visitas')} × ¥${Number(form.price_per_visit).toLocaleString()} = ¥${Math.round(byVisits).toLocaleString()}\n${L('Fixed monthly','固定月額','Mensal fixo')}: ¥${Math.round(revenue).toLocaleString()}\n${L('Difference','差額','Diferença')}: ¥${Math.round(revenue - byVisits).toLocaleString()}\n\n${L('Save anyway? The invoice uses the fixed monthly amount.','このまま保存しますか？請求書には固定月額が使われます。','Salvar mesmo assim? A fatura usa o valor mensal fixo.')}`, confirmLabel: L('Save','保存','Salvar') })
      if (!ok) return
    }
    if (!(revenue > 0)) { setErrors({ price_per_visit: L('This contract would be ¥0/month: pick the days or enter the price','この契約は月額¥0になります。曜日を選ぶか料金を入力してください','Este contrato ficaria ¥0/mês: escolha os dias ou informe o preço') }); return }
    const payload = { client_id:selectedClient, ...form, location_name:form.location_name.trim(), training_checklist:splitChecklist(form.training_checklist).join('\n')||null, price_per_visit:parseFloat(form.price_per_visit)||0, fixed_monthly:parseFloat(form.fixed_monthly||0), hours_per_visit:parseFloat(form.hours_per_visit)||0, visits_per_month:visits, discount_percent:Math.max(0,Math.min(100,parseFloat(form.discount_percent)||0)), tax_rate:parseInt(form.tax_rate)||0, price_includes_tax:form.price_includes_tax!==false, billing_day:Math.max(1,Math.min(28,parseInt(form.billing_day)||10)), billing_notes:form.billing_notes||null, area:(form.area||'').trim()||null, monthly_revenue:revenue }
    // Seller of this location: monthly commission (salesperson_name is only on spot contracts).
    Object.assign(payload, sellerFields(form))
    delete payload.salesperson_name

    if (editing) {
      const { error } = await supabase.from('service_contracts').update(payload).eq('id',editing)
      if (error) return toast.error(error.message)
      toast.success(L('Contract updated','契約を更新しました','Contrato atualizado'))
    } else {
      const { error } = await supabase.from('service_contracts').insert(payload)
      if (error) return toast.error(error.message)
      toast.success(L('Contract added','契約を追加しました','Contrato adicionado'))
    }
    // Every contract store is also a place in the single registry (Jobs → Places).
    await ensurePlaceForContract(supabase, payload)

    // Update client monthly_revenue
    const { data: allContracts } = await supabase.from('service_contracts').select('*').eq('client_id',selectedClient).eq('is_active',true)
    const totalRevenue = (allContracts||[]).reduce((s,c)=>s+contractMonthly(c),0)
    await supabase.from('clients').update({ monthly_revenue: totalRevenue }).eq('id', selectedClient)

    setShowForm(false); setEditing(null)
    setForm({ location_name:'', location_address:'', area:'', service_type:'Basic Cleaning', billing_type:'per_visit', price_per_visit:0, fixed_monthly:0, hours_per_visit:2, days_of_week:[], notes:'', training_video_url:'', training_checklist:'', ...NO_SELLER })
    loadContracts(selectedClient)
  }

  const handleEdit = (c) => {
    setEditing(c.id)
    setForm({ location_name:c.location_name||'', location_address:c.location_address||'', area:c.area||'', service_type:c.service_type||'Basic Cleaning', billing_type:c.billing_type||'per_visit', price_per_visit:c.price_per_visit||0, fixed_monthly:c.fixed_monthly||0, discount_percent:c.discount_percent||0, tax_rate:c.tax_rate??10, price_includes_tax:c.price_includes_tax!==false, billing_day:c.billing_day||10, billing_notes:c.billing_notes||'', hours_per_visit:c.hours_per_visit||2, days_of_week:c.days_of_week||[], notes:c.notes||'', training_video_url:c.training_video_url||'', training_checklist:c.training_checklist||'', salesperson_id:c.salesperson_id||'', salesperson_name:'', commission_type:c.commission_type||null, commission_value:c.commission_value??null, commission_amount:c.commission_amount||0 })
    setShowForm(true)
  }

  const recalcClient = async (clientId) => {
    const { data } = await supabase.from('service_contracts').select('*').eq('client_id',clientId).eq('is_active',true)
    const total = (data||[]).reduce((s,c)=>s+contractMonthly(c),0)
    await supabase.from('clients').update({ monthly_revenue:total }).eq('id',clientId)
  }

  const handleDelete = async (id) => {
    const c = contracts.find(x=>x.id===id)
    const clientId = selectedClient
    const ok = await askConfirm({
      title: L('Remove this contract?','この契約を外しますか？','Remover este contrato?'),
      message: L(`${c?.location_name||''} · ¥${contractMonthly(c||{}).toLocaleString()}/mo\nIt stops generating jobs and leaves this client's monthly revenue. The place stays in the registry; past jobs and invoices are kept.`,
        `${c?.location_name||''} · ¥${contractMonthly(c||{}).toLocaleString()}/月\n作業の自動作成が止まり、この顧客の月の売上から外れます。拠点は登録に残り、過去の作業と請求書も残ります。`,
        `${c?.location_name||''} · ¥${contractMonthly(c||{}).toLocaleString()}/mês\nDeixa de gerar jobs e sai da receita mensal deste cliente. O local continua no cadastro; jobs e faturas antigos ficam guardados.`),
      confirmLabel: L('Remove','外す','Remover'), danger: true,
    })
    if (!ok) return
    const { error } = await supabase.from('service_contracts').update({ is_active:false }).eq('id',id)
    if (error) return toast.error(error.message)
    loadContracts(clientId)
    await recalcClient(clientId)
    undoToast(L('Contract removed','契約を外しました','Contrato removido'), async () => {
      const res = await supabase.from('service_contracts').update({ is_active:true }).eq('id',id)
      if (!res.error) await recalcClient(clientId)
      return res
    }, lang, () => loadContracts(clientId))
  }

  // v1.0.109 · one rule for the monthly value (lib/money): same number as Clients and Dashboard
  const totalMonthlyRevenue = contracts.reduce((s,c)=>s+contractMonthly(c),0)
  const stores = groupByStore(contracts)
  const totalMonthlyHours = contracts.reduce((s,c)=>s+Number(c.visits_per_month||0)*Number(c.hours_per_visit||0),0)
  const totalVisits = contracts.reduce((s,c)=>s+Number(c.visits_per_month||0),0)
  const client = clients.find(c=>c.id===selectedClient)

  // "Generate contract" first opens the contract details (written address, 責任者, 作業内容, notes per item).
  const openDetails = (c) => setDetails({ c, value: contractDetailsDefaults(recurringToContract(c, client)) })
  const withDetails = (c, value) => ({ ...c, contract_details: cleanContractDetails(value) })
  const saveDetails = async () => {
    const { c, value } = details
    const contract_details = cleanContractDetails(value)
    const { error } = await supabase.from('service_contracts').update({ contract_details }).eq('id', c.id)
    if (error) return toast.error(error.message)
    setDetails(null)
    await savePdf({ ...c, contract_details })
  }

  // Saves the location's 業務委託契約書 as a PDF on the contract and opens it.
  const savePdf = async (c) => {
    const tab = window.open('', '_blank')
    setPdfBusy(c.id)
    try {
      const { blob } = await saveContractPdf(recurringToContract(c, client), { table: 'service_contracts', id: c.id })
      const url = URL.createObjectURL(blob)
      if (tab) tab.location.href = url
      toast.success(L('📥 PDF saved on this location','📥 この拠点にPDFを保存しました','📥 PDF salvo neste local'))
      loadContracts(selectedClient)
    } catch (err) { tab?.close(); toast.error(`PDF: ${err.message}`) } finally { setPdfBusy('') }
  }

  return (
    <div>
      <SetupChain current="contract" clientId={selectedClient} />
      {details && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={()=>setDetails(null)}>
          <div className="card" style={{ width:'min(680px,100%)', maxHeight:'92vh', overflowY:'auto' }} onClick={e=>e.stopPropagation()}>
            <div className="card-title">📄 {L('Contract','契約書','Contrato')} 業務委託契約書 · {details.c.location_name}</div>
            <div style={{ fontSize:12, color:'var(--text3)', marginBottom:10 }}>{L('Check what the contract will say. Everything here is printed in Japanese; the notes explain the reason for each item.','契約書の内容を確認してください。ここの内容はすべて日本語で印刷されます。メモは各項目の理由です。','Confira o que o contrato vai dizer. Tudo aqui sai impresso em japonês; as notas explicam o motivo de cada item.')}</div>
            <ContractDetailsFields value={details.value} onChange={value=>setDetails(d=>({ ...d, value }))} />
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              <button className="btn btn-primary" disabled={pdfBusy===details.c.id} onClick={saveDetails}>💾 {L('Save + PDF','保存＋PDF','Salvar + PDF')}</button>
              <button className="btn" onClick={()=>showPrintOverlay(spotContractHtml(recurringToContract(withDetails(details.c, details.value), client), 'ja'))}>👁 {L('Preview','プレビュー','Pré-visualizar')}</button>
              <button className="btn" onClick={()=>setDetails(null)}>{L('Cancel','キャンセル','Cancelar')}</button>
            </div>
          </div>
        </div>
      )}
      {!selectedClient && contractsLoading && <SkeletonRows rows={4} label={L('Loading…','読み込み中…','Carregando…')} />}
      {!selectedClient && !contractsLoading && <div className="card" style={{fontSize:13,color:'var(--text2)'}}>{L('No active clients yet. Register the client in Clients first; then its contracts are added here.','有効な顧客がいません。先に顧客に登録してから、ここで契約を追加してください。','Nenhum cliente ativo ainda. Cadastre o cliente em Clientes primeiro; depois os contratos dele são adicionados aqui.')}</div>}
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
          <div className="kp-two-mobile" style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:16}}>
            {[[L('Stores','店舗','Lojas'),stores.length],[L('Visits/mo','月の回数','Visitas/mês'),totalVisits],[L('Hours/mo','月の時間','Horas/mês'),totalMonthlyHours.toFixed(0)+'h'],[L('Revenue/mo','月の売上','Receita/mês'),'¥'+totalMonthlyRevenue.toLocaleString()]].map(([l,v])=>(
              <div key={l} className="card" style={{padding:'12px 14px',textAlign:'center'}}>
                <div style={{fontSize:20,fontWeight:700,color:'var(--green)'}}>{contractsLoading ? <span className="kp-skel" style={{display:'inline-block',width:48,height:20}} /> : v}</div>
                <div style={{fontSize:11,color:'var(--text3)',marginTop:3}}>{l}</div>
              </div>
            ))}
          </div>

          {/* Add button */}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <div style={{fontSize:14,fontWeight:600}}>{client?.company_name} — {L('Service Locations','サービス拠点','Locais de serviço')}</div>
            <button className="btn btn-primary" onClick={()=>{setShowForm(!showForm);setEditing(null);setForm({ location_name:'', location_address:'', area:'', service_type:'Basic Cleaning', billing_type:'per_visit', price_per_visit:0, fixed_monthly:0, hours_per_visit:2, days_of_week:[], notes:'', training_video_url:'', training_checklist:'' })}}>
              {showForm?L('Cancel','キャンセル','Cancelar'):`+ ${L('Add Location','拠点を追加','Adicionar local')}`}
            </button>
          </div>

          {/* Form */}
          {showForm&&(
            <div className="card" style={{marginBottom:16,border:'1px solid var(--navy)'}}>
              <div className="card-title">{editing?L('Edit Location','拠点を編集','Editar local'):L('New Location','拠点の新規登録','Novo local')}</div>
              {quoteNote && !editing && <div style={{fontSize:13,background:'var(--blue-light, #eef3ff)',borderRadius:8,padding:'8px 10px',marginBottom:10}}>🔁 {quoteNote}</div>}
              <div className="grid-2">
                <div className="form-group"><label>{L('Location Name','拠点名','Nome do local')} *</label><input className={errors.location_name?'ag-invalid':''} value={form.location_name} onChange={e=>upd('location_name',e.target.value)} placeholder="Atomic Bar" />{fieldErr('location_name')}{fieldErr('client')}</div>
                <div className="form-group"><label>{L('Area / zone','エリア','Área / região')}</label><input list="kp-areas" value={form.area||''} onChange={e=>upd('area',e.target.value)} placeholder="Shinbashi" /><datalist id="kp-areas">{[...new Set(contracts.map(c=>c.area).filter(Boolean))].sort().map(a=><option key={a} value={a} />)}</datalist></div>
                <div className="form-group"><label>{L('Service Type','サービス種別','Tipo de serviço')}</label>
                  <select value={form.service_type} onChange={e=>upd('service_type',e.target.value)}>
                    {SERVICE_TYPES.map(s=><option key={s} value={s}>{serviceText(s)}</option>)}
                  </select>
                </div>
                <div className="form-group"><label>{L('Billing Type','請求方法','Forma de cobrança')}</label>
                  <select value={form.billing_type||'per_visit'} onChange={e=>upd('billing_type',e.target.value)}>
                    <option value="per_visit">{L('Per Visit','1回ごと','Por visita')}</option>
                    <option value="fixed_monthly">{L('Fixed Monthly','固定月額','Mensal fixo')}</option>
                  </select>
                </div>
                {(form.billing_type||'per_visit')==='per_visit'&&<div className="form-group"><label>{L('Price per Visit (¥)','1回の料金（¥）','Preço por visita (¥)')}</label><input type="number" className={errors.price_per_visit?'ag-invalid':''} value={form.price_per_visit} onChange={e=>upd('price_per_visit',e.target.value)} />{fieldErr('price_per_visit')}</div>}
                {form.billing_type==='fixed_monthly'&&<div className="form-group"><label>{L('Fixed Monthly (¥)','固定月額（¥）','Mensal fixo (¥)')}</label><input type="number" className={errors.fixed_monthly?'ag-invalid':''} value={form.fixed_monthly||0} onChange={e=>upd('fixed_monthly',e.target.value)} />{fieldErr('fixed_monthly')}</div>}
                <div className="form-group"><label>{L('Hours per Visit','1回の時間','Horas por visita')}</label><input type="number" step="0.5" className={errors.hours_per_visit?'ag-invalid':''} value={form.hours_per_visit} onChange={e=>upd('hours_per_visit',e.target.value)} />{fieldErr('hours_per_visit')}</div>
                <div className="form-group"><label>{L('Discount (%)','割引（%）','Desconto (%)')}</label><input type="number" min="0" max="100" step="0.1" value={form.discount_percent||0} onChange={e=>upd('discount_percent',e.target.value)} /></div>
                <div className="form-group"><label>{L('Tax (%)','消費税（%）','Imposto (%)')}</label><select value={form.tax_rate??10} onChange={e=>upd('tax_rate',e.target.value)}><option value="10">10%</option><option value="8">8%</option><option value="0">0%</option></select></div>
                <div className="form-group"><label>{L('Price includes tax?','税込価格？','Preço inclui imposto?')}</label><select value={String(form.price_includes_tax !== false)} onChange={e=>upd('price_includes_tax',e.target.value==='true')}><option value="true">{L('Yes','はい','Sim')}</option><option value="false">{L('No','いいえ','Não')}</option></select></div>
                <div className="form-group"><label>{L('Payment day (next month)','支払日（翌月）','Dia do pagamento (mês seguinte)')}</label><input type="number" min="1" max="28" value={form.billing_day||10} onChange={e=>upd('billing_day',e.target.value)} /></div>
                <SellerCommissionFields monthly sellers={sellers.salespeople} rules={sellers.rules} contract={{ price: form.billing_type==='fixed_monthly' ? form.fixed_monthly : monthlyRevenue, tax_rate: form.tax_rate, price_includes_tax: form.price_includes_tax }} value={form} onChange={patch=>setForm(f=>({...f,...patch}))} />
                <div className="form-group" style={{gridColumn:'1/-1'}}><label>{L('Billing notes','請求メモ','Observações da cobrança')}</label><input value={form.billing_notes||''} onChange={e=>upd('billing_notes',e.target.value)} placeholder={L('e.g. discount agreed with the client','例：顧客と合意した割引','Ex.: desconto acordado com o cliente')} /></div>
                <div className="form-group" style={{gridColumn:'1/-1'}}><label>{L('Address / Maps URL','住所・地図URL','Endereço / link do Maps')}</label><input value={form.location_address} onChange={e=>upd('location_address',e.target.value)} placeholder="https://maps.app.goo.gl/..." /></div>
                <div className="form-group" style={{gridColumn:'1/-1'}}>
                  <label>{L('Days of Week','曜日','Dias da semana')}</label>
                  <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:4}}>
                    {DAYS.map(d=>(
                      <button key={d} type="button" onClick={()=>toggleDay(d)}
                        style={{padding:'6px 14px',borderRadius:20,border:'1.5px solid',borderColor:form.days_of_week.includes(d)?'var(--navy)':'var(--border)',background:form.days_of_week.includes(d)?'var(--navy)':'none',color:form.days_of_week.includes(d)?'#fff':'var(--text2)',fontSize:13,cursor:'pointer'}}>
                        {dayText(d)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="form-group"><label>{L('Notes','メモ','Observações')}</label><input value={form.notes} onChange={e=>upd('notes',e.target.value)} placeholder={L('Key box: 1234','キーボックス：1234','Key box: 1234')} /></div>
                <div className="form-group" style={{gridColumn:'1/-1'}}><label>{L('Training Video (YouTube URL)','研修動画（YouTube URL）','Vídeo de treinamento (link do YouTube)')}</label><input value={form.training_video_url} onChange={e=>upd('training_video_url',e.target.value)} placeholder="https://www.youtube.com/watch?v=..." /></div>
                <div className="form-group" style={{gridColumn:'1/-1'}}><label>{L('Training Checklist (one item per line)','研修チェックリスト（1行に1項目）','Checklist de treinamento (um item por linha)')}</label><textarea value={form.training_checklist} onChange={e=>upd('training_checklist',e.target.value)} rows={4} placeholder="Check hood filters&#10;Wipe all surfaces&#10;Mop floor" /></div>
              </div>

              {/* Preview calc */}
              {form.days_of_week.length>0&&(
                <div style={{background:'var(--surface2)',borderRadius:10,padding:'12px 14px',marginBottom:14,display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
                  {[[L('Visits/month','月の回数','Visitas/mês'),visitsPerMonth],[L('Hours/month','月の時間','Horas/mês'),totalHours.toFixed(1)+'h'],[L('Revenue/month','月の売上','Receita/mês'),'¥'+monthlyRevenue.toLocaleString()]].map(([l,v])=>(
                    <div key={l} style={{textAlign:'center'}}>
                      <div style={{fontSize:16,fontWeight:700,color:'var(--green)'}}>{v}</div>
                      <div style={{fontSize:10,color:'var(--text3)'}}>{l}</div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-primary" onClick={handleSave}>{editing?`✅ ${L('Update','更新','Atualizar')}`:`✅ ${L('Add','追加','Adicionar')}`}</button>
                <button className="btn" onClick={()=>{setShowForm(false);setEditing(null)}}>{L('Cancel','キャンセル','Cancelar')}</button>
              </div>
            </div>
          )}

          <KeyRevealLog />
          {/* Contracts list */}
          {contractsLoading&&<SkeletonRows rows={3} label={L('Loading…','読み込み中…','Carregando…')} />}
          {!contractsLoading&&contracts.length===0&&<div className="card"><div style={{color:'var(--text3)',fontSize:13}}>{L('No locations yet. Tap “+ Add Location” to add the first place this client pays for; jobs are generated from it.','拠点はまだありません。「+ 拠点を追加」から、この顧客の最初の拠点を登録してください。作業はここから作成されます。','Nenhum local ainda. Toque em “+ Adicionar local” para cadastrar o primeiro local que este cliente paga; os jobs são gerados a partir dele.')}</div></div>}
          {/* v1.0.109 · one card per STORE with its items inside (not one line per component) */}
          {stores.map(g=>(
            <div key={g.store} className="card" style={{marginBottom:12}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,flexWrap:'wrap'}}>
                <div style={{fontWeight:700,fontSize:15}}>🏪 {g.store} <span style={{fontSize:12,fontWeight:500,color:'var(--text3)'}}>· {g.items.length} {g.items.length>1?L('items','項目','itens'):L('item','項目','item')} · {g.visits} {L('visits/mo','回/月','visitas/mês')} · {g.hours.toFixed(0)}h/{L('mo','月','mês')}</span></div>
                <div style={{fontSize:16,fontWeight:700,color:'var(--green)'}}>¥{g.monthly.toLocaleString()}/{L('mo','月','mês')}</div>
              </div>
          {g.items.map(c=>(
            <div key={c.id} style={{borderTop:'1px solid var(--border)',paddingTop:10,marginTop:10}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
                <div>
                  <div style={{fontWeight:600,fontSize:14}}>{c.location_name}{c.area&&<span className="badge badge-navy" style={{marginLeft:8,fontWeight:600}}>📍 {c.area}</span>}</div>
                  <div style={{fontSize:12,color:'var(--text3)',marginTop:1}}>{serviceText(c.service_type)} · {c.hours_per_visit}h/{L('visit','回','visita')} · <span style={{color:c.billing_type==='fixed_monthly'?'var(--amber)':'var(--text3)'}}>{c.billing_type==='fixed_monthly'?L('Fixed Monthly','固定月額','Mensal fixo'):L('Per Visit','1回ごと','Por visita')}</span></div>
                  {hasMapsLink(c.location_address, c.location_name)&&<a href={mapsOpenUrl(c.location_address, c.location_name)} target="_blank" rel="noreferrer" style={{fontSize:11,color:'#60a5fa',textDecoration:'none'}}>🗺 Maps</a>}
                  {c.notes&&<KeyReveal value={c.notes} multiline source="contract" refId={c.id} label={c.location_name} style={{fontSize:11,color:'var(--text3)',marginTop:2}} />}
                  {c.training_video_url&&<div style={{fontSize:11,color:'#60a5fa',marginTop:2}}>🎬 {L('Training video configured','研修動画あり','Vídeo de treinamento configurado')}</div>}
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:15,fontWeight:700,color:'var(--green)'}}>¥{contractMonthly(c).toLocaleString()}/{L('mo','月','mês')}</div>
                  {contractMonthly(c)!==contractGross(c)&&<div style={{fontSize:11,color:'var(--text3)'}}>−{c.discount_percent}% {L('of','／','de')} ¥{contractGross(c).toLocaleString()}</div>}
                  <div style={{fontSize:11,color:'var(--text3)'}}>¥{Number(c.price_per_visit||0).toLocaleString()}/{L('visit','回','visita')}</div>
                </div>
              </div>
              {contractIssues(c).length>0&&<div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>{contractIssues(c).map(k=><span key={k} className="badge badge-amber" style={{whiteSpace:'normal'}}>⚠️ {k==='stored_mismatch'?`${issueText(k)} (${L('saved','保存値','salvo')} ¥${Number(c.monthly_revenue||0).toLocaleString()})`:issueText(k)}</span>)}</div>}
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>
                {(c.days_of_week||[]).map(d=><span key={d} style={{background:'var(--navy)',color:'#fff',borderRadius:20,padding:'2px 10px',fontSize:11,fontWeight:500}}>{dayText(d)}</span>)}
                <span style={{background:'var(--surface2)',borderRadius:20,padding:'2px 10px',fontSize:11,color:'var(--text3)'}}>{c.visits_per_month} {L('visits/mo','回/月','visitas/mês')}</span>
                <span style={{background:'var(--surface2)',borderRadius:20,padding:'2px 10px',fontSize:11,color:'var(--text3)'}}>{(c.visits_per_month*c.hours_per_visit).toFixed(0)}h/{L('mo','月','mês')}</span>
                <span style={{background:'var(--surface2)',borderRadius:20,padding:'2px 10px',fontSize:11,color:'var(--text2)'}}>💴 {L(`payment by the ${c.billing_day||10}th of next month`, `翌月${c.billing_day||10}日までに支払い`, `pagamento até o dia ${c.billing_day||10} do mês seguinte`)}</span>
                {c.salesperson_id&&<span style={{background:'var(--surface2)',borderRadius:20,padding:'2px 10px',fontSize:11,color:'var(--text2)'}}>💼 {sellers.salespeople.find(p=>p.id===c.salesperson_id)?.full_name||L('Seller','営業担当','Vendedor')} · ¥{Number(c.commission_amount||0).toLocaleString()}/{L('mo','月','mês')}</span>}
              </div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                <button className="btn btn-sm btn-primary" onClick={()=>openDetails(c)}>📄 {L('Generate contract','契約書を作成','Gerar contrato')} 契約書</button>
                <button className="btn btn-sm" onClick={()=>showPrintOverlay(spotContractHtml(recurringToContract(c, client), 'en'))}>📄 EN</button>
                <button className="btn btn-sm" disabled={pdfBusy===c.id} onClick={()=>savePdf(c)}>{pdfBusy===c.id?'…':`📥 ${L('Save PDF','PDFを保存','Salvar PDF')}`}</button>
                {c.contract_pdf_path&&<a className="btn btn-sm" href={contractPdfUrl(c.contract_pdf_path, c.contract_pdf_saved_at)} target="_blank" rel="noreferrer" title={new Date(c.contract_pdf_saved_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}>📄 {L('Saved PDF','保存済みPDF','PDF salvo')}</a>}
                <button className="btn btn-sm" onClick={()=>handleEdit(c)}>✏️ {L('Edit','編集','Editar')}</button>
                <button className="btn btn-sm btn-danger" onClick={()=>handleDelete(c.id)}>✕ {L('Remove','外す','Remover')}</button>
              </div>
            </div>
          ))}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
