import { useState, useEffect } from 'react'
import { statusLabel, shortDate } from '../lib/statusLabel'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { tokyoToday } from '../lib/dates'
import { ensureServiceReports } from '../lib/jobReport'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { dueDateAfter } from '../lib/spotContract'
import { useLang, fill } from '../hooks/useLang'
import { buildContractLine, monthBounds, monthlyTotals, monthlySubject } from '../lib/invoiceAutomation'
import { ClientLink } from '../components/ClientSheetHost'
import { askConfirm } from '../components/ConfirmDialog'
import { invoiceMonth, isReceivable, isOverdueInvoice } from '../lib/money'
import { printInvoiceDoc, loadInvoiceView } from '../lib/invoicePrintOps'
import InvoiceDatesDialog from '../components/InvoiceDatesDialog'
import { suggestedInvoiceDates, dayOfNextMonth, periodLabel } from '../lib/invoiceDates'

export default function Faturas() {
  const [searchParams] = useSearchParams()
  const searchId = searchParams.get('search')
  const navigate = useNavigate()
  const { t, lang, tr } = useLang()
  const inv = t.invoices
  const [faturas, setFaturas] = useState([])
  const [clients, setClients] = useState([])
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('list')
  const [selected, setSelected] = useState(null)
  const [items, setItems] = useState([])
  const [form, setForm] = useState({ client_id:'', issue_date:tokyoToday(), period_start:'', period_end:'', due_date:'', tax_rate:10, notes:'' })
  // v1.0.146 · { f, mode: 'edit' | 'send' } — the admin picks 発行日 / 対象期間 / 支払期限
  const [datesFor, setDatesFor] = useState(null)
  const [autoPeriod, setAutoPeriod] = useState(tokyoToday().slice(0,7))
  const [listView, setListView] = useState(() => searchParams.get('view') || 'all')
  useEffect(() => { const v = searchParams.get('view'); if (v) setListView(v) }, [searchParams])
  const [autoLoading, setAutoLoading] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const [f, c] = await Promise.all([
      supabase.from('faturas').select('*').order('created_at', { ascending:false }),
      // v1.0.96 · every client: active ones first, inactive ones below (some still have jobs to bill)
      supabase.from('clients').select('*').order('company_name'),
    ])
    setFaturas(f.data||[]); setClients(c.data||[])
    setLoading(false)
  }

  const loadJobs = async (clientId, start, end) => {
    if (!clientId||!start||!end) return
    const { data } = await supabase.from('jobs').select('*')
      .eq('client_id', clientId)
      .gte('scheduled_date', start)
      .lte('scheduled_date', end)
      .eq('status', 'completed')
    setJobs(data||[])
    setItems((data||[]).map(j=>({ job_id:j.id, description:j.title, quantity:1, unit_price:Number(j.value||j.spot_value||0), total:Number(j.value||j.spot_value||0) })))
  }

  const upd = (k,v) => {
    setForm(f=>({...f,[k]:v}))
    if (k==='client_id'||k==='period_start'||k==='period_end') {
      const nf = {...form,[k]:v}
      if (nf.client_id&&nf.period_start&&nf.period_end) loadJobs(nf.client_id, nf.period_start, nf.period_end)
    }
  }

  const updItem = (i, k, v) => setItems(its => its.map((it,idx) => {
    if (idx!==i) return it
    const updated = {...it,[k]:v}
    if (k==='quantity'||k==='unit_price') updated.total = (parseFloat(updated.quantity)||0)*(parseFloat(updated.unit_price)||0)
    return updated
  }))

  // v1.0.162 · manual invoice in the On The Planet style: one line per restaurant (active contract)
  // with its monthly value; per-visit restaurants use the completed visits of the chosen period.
  const fillMonthlyByRestaurant = async () => {
    if (!form.client_id) return toast.error(inv.selectClient)
    const { data: contracts, error } = await supabase.from('service_contracts').select('*').eq('client_id', form.client_id).eq('is_active', true).order('created_at')
    if (error) return toast.error(error.message)
    const lines = (contracts || []).map(c => buildContractLine(c, jobs)).filter(Boolean)
    if (!lines.length) return toast(tr('This client has no active contract with a value.', 'この顧客に金額のある有効な契約がありません。', 'Este cliente não tem contrato ativo com valor.'))
    setItems(lines.map(l => ({ job_id: null, contract_id: l.contract_id, description: l.restaurant, quantity: 1, unit_price: l.total, total: l.total, job_ids: l.job_ids.join(',') })))
    if (!form.period_start && !form.period_end) {
      const { start, end } = monthBounds(autoPeriod)
      setForm(f => ({ ...f, period_start: start, period_end: end, due_date: f.due_date || dueDateAfter(start, 10) }))
    }
  }

  const addItem = () => setItems(its=>[...its,{ job_id:null, description:'', quantity:1, unit_price:0, total:0 }])
  const removeItem = (i) => setItems(its=>its.filter((_,idx)=>idx!==i))

  const subtotal = items.reduce((s,it)=>s+Number(it.total||0),0)
  const tax = Math.round(subtotal * (form.tax_rate||10)/100)
  const total = subtotal + tax

  // v1.0.109 · automatic billing in two steps: 1) build the preview per client (nothing saved),
  // 2) the admin checks it and confirms; only then the draft invoices are created.
  const [preview, setPreview] = useState(null) // { start, end, plans: [{ client, lines, subtotal, tax, total, taxRate, dueDate }], skipped }

  const handleAutoBilling = async () => {
    setAutoLoading(true)
    try {
      const { start, end } = monthBounds(autoPeriod)
      const { data: contracts, error: contractsError } = await supabase
        .from('service_contracts')
        .select('*')
        .eq('is_active', true)
        .order('client_id')
        .order('created_at')
      if (contractsError) throw contractsError
      if (!contracts?.length) return toast(tr('No active contract found.', '有効な契約がありません。', 'Nenhum contrato ativo encontrado.'))

      const clientIds = [...new Set(contracts.map(c => c.client_id).filter(Boolean))]
      const { data: existing } = await supabase.from('faturas')
        .select('id,client_id,status,period_start,period_end')
        .in('client_id', clientIds)
        .eq('period_start', start)
        .eq('period_end', end)
        .neq('status', 'cancelled')

      // Spot jobs already billed by their own spot-contract invoice are not billed again here.
      const { data: spotBilled } = await supabase.from('spot_contracts').select('job_id').not('fatura_id', 'is', null)
      const spotBilledJobs = new Set((spotBilled || []).map(r => r.job_id).filter(Boolean))

      const existingKeys = new Set((existing || []).map(f => `${f.client_id}:${f.period_start}:${f.period_end}`))
      const plans = []
      const skipped = []

      for (const clientId of clientIds) {
        const client = clients.find(c => c.id === clientId)
        if (!client || client.is_active === false) continue
        if (existingKeys.has(`${clientId}:${start}:${end}`)) { skipped.push(client.company_name); continue }

        const clientContracts = contracts.filter(c => c.client_id === clientId)
        const { data: completedJobs } = await supabase.from('jobs')
          .select('*')
          .eq('client_id', clientId)
          .gte('scheduled_date', start)
          .lte('scheduled_date', end)
          .eq('status', 'completed')

        const lines = clientContracts
          .map(contract => buildContractLine(contract, (completedJobs || []).filter(j => !spotBilledJobs.has(j.id))))
          .filter(Boolean)
        if (!lines.length) continue

        const taxRate = Number(clientContracts[0]?.tax_rate ?? 10)
        const includesTax = clientContracts.every(c => c.price_includes_tax !== false)
        // Payment day of the contract (default the 10th) in the month after the billed period.
        const payDay = clientContracts.find(c => c.billing_day)?.billing_day || 10
        // v1.0.162 · one line per restaurant, in the order the contracts were registered; values editable in the preview
        plans.push({ client, lines, taxRate, taxMode: includesTax ? 'incl' : 'excl', dueDate: dueDateAfter(start, payDay), jobs: completedJobs || [] })
      }
      setPreview({ start, end, plans, skipped })
    } catch (error) {
      toast.error(error.message || 'Falha ao gerar faturamento automático.')
    } finally {
      setAutoLoading(false)
    }
  }

  // v1.0.162 · edit the preview before saving: restaurant value, remove a restaurant, 税抜 / 税込
  const patchPlan = (ci, fn) => setPreview(pv => pv && ({ ...pv, plans: pv.plans.map((p, i) => (i === ci ? fn(p) : p)) }))
  const patchLine = (ci, li, patch) => patchPlan(ci, p => ({ ...p, lines: p.lines.map((l, j) => (j === li ? { ...l, ...patch } : l)) }))
  const planTotals = p => monthlyTotals(p.lines.filter(l => !l.removed), p.taxRate, p.taxMode)
  const activePlans = preview ? preview.plans.filter(p => p.lines.some(l => !l.removed && Number(l.total || 0) > 0)) : []

  const confirmAutoBilling = async () => {
    if (!preview) return
    setAutoLoading(true)
    let created = 0
    try {
      for (const p of preview.plans) {
        const lines = p.lines.filter(l => !l.removed && Number(l.total || 0) > 0)
        if (!lines.length) continue
        const tt = monthlyTotals(lines, p.taxRate, p.taxMode)
        ensureServiceReports(supabase, p.jobs).catch(() => {}) // billed jobs also have their report
        const { data: fatura, error } = await supabase.from('faturas').insert({
          client_id: p.client.id,
          client_name: p.client.company_name,
          period_start: preview.start,
          period_end: preview.end,
          issue_date: tokyoToday(),
          due_date: p.dueDate,
          subtotal: tt.subtotal,
          tax_amount: tt.tax,
          total: tt.total,
          tax_rate: p.taxRate,
          status: 'draft',
          notes: ''
        }).select().single()
        if (error) throw error
        const itemPayload = lines.map(line => ({
          fatura_id: fatura.id,
          contract_id: line.contract_id,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unit_price,
          total: line.total,
          discount_percent: line.discount_percent,
          discount_amount: line.discount_amount,
          job_ids: line.job_ids.join(',')
        }))
        const { error: itemsError } = await supabase.from('fatura_items').insert(itemPayload)
        if (itemsError) throw itemsError
        created++
      }
      toast.success(tr(`${created} draft invoice(s) created`, `下書き請求書 ${created}件を作成`, `${created} fatura(s) em rascunho criada(s)`))
      setPreview(null)
      await load()
    } catch (error) {
      toast.error(error.message || 'Falha ao gerar faturamento automático.')
      await load()
    } finally {
      setAutoLoading(false)
    }
  }

  // v1.0.109 · clicking an invoice opens ITS detail (lines × value × discount × tax), not the client.
  const [detail, setDetail] = useState(null) // { f, items }
  const openDetail = async (f) => {
    setDetail({ f, items: null, view: null })
    const view = await loadInvoiceView(f).catch(() => null)
    setDetail(d => (d?.f.id === f.id ? { f, items: view?.lines || [], view } : d))
  }

  const handleCreate = async () => {
    const client = clients.find(c=>c.id===form.client_id)
    if (!client) return toast.error(inv.selectClient)
    if (items.length===0) return toast.error(inv.addItem)
    const { data: fatura, error } = await supabase.from('faturas').insert({
      client_id: form.client_id,
      client_name: client.company_name,
      period_start: form.period_start||null,
      period_end: form.period_end||null,
      issue_date: form.issue_date||tokyoToday(),
      due_date: form.due_date||null,
      subtotal, tax_amount:tax, total,
      tax_rate: parseInt(form.tax_rate)||10,
      status: 'draft',
      notes: form.notes
    }).select().single()
    if (error) return toast.error(error.message)
    for (const item of items) {
      await supabase.from('fatura_items').insert({ fatura_id:fatura.id, job_id:item.job_id||null, description:item.description, quantity:parseInt(item.quantity)||1, unit_price:parseFloat(item.unit_price)||0, total:parseFloat(item.total)||0, ...(item.contract_id ? { contract_id:item.contract_id, job_ids:item.job_ids||null } : {}) })
    }
    toast.success(inv.created)
    setTab('list'); load()
  }

  const handleDelete = async (id) => {
    if (!(await askConfirm({ message: inv.deleteConfirm, danger: true }))) return
    await supabase.from('faturas').delete().eq('id', id)
    toast(inv.deleted); load()
  }

  const handleStatusChange = async (id, status) => {
    // v1.0.102 · cancelling asks first, like delete
    if (status === 'cancelled' && !(await askConfirm({ message: tr('Cancel this invoice? It stops counting as billed or receivable.', 'この請求書を取り消しますか？請求額・未収金に含まれなくなります。', 'Cancelar esta fatura? Ela deixa de contar como faturado e a receber.'), confirmLabel: tr('Cancel invoice', '請求書を取消', 'Cancelar fatura'), danger: true }))) return
    // paid_at drives the client's thank-you message and receipt date
    await supabase.from('faturas').update({ status, paid_at: status === 'paid' ? new Date().toISOString() : null }).eq('id', id)
    toast.success(`Status: ${status}`); load()
  }

  // v1.0.146 · 発行日 / 対象期間 / 支払期限 chosen by the admin (edit any time; checked before sending).
  const openDates = (f, mode) => {
    const today = tokyoToday()
    const base = mode === 'send'
      ? { ...f, issue_date: today, due_date: f.due_date && f.due_date >= today ? f.due_date : '' }
      : f
    setDatesFor({ f, mode, initial: suggestedInvoiceDates(base, { today }) })
  }
  const saveDates = async (d) => {
    const { f, mode } = datesFor
    const patch = { issue_date: d.issue_date, period_start: d.period_start, period_end: d.period_end, due_date: d.due_date }
    if (mode === 'send') patch.status = 'sent'
    const { error } = await supabase.from('faturas').update(patch).eq('id', f.id)
    if (error) return toast.error(error.message)
    toast.success(mode === 'send' ? tr('Sent with these dates','この日付で送付済にしました','Marcada enviada com essas datas') : tr('Dates saved','日付を保存しました','Datas salvas'))
    setDatesFor(null)
    setDetail(x => (x?.f.id === f.id ? { ...x, f: { ...x.f, ...patch } } : x))
    load()
  }

  // v1.0.122 · same A4 layout as the 見積書, quote lines when it came from one, bank account in the footer
  const handlePrint = (f) => printInvoiceDoc(f, 'ja')

  // v1.0.102 · the list shows only the invoices of the month chosen above (billing period, else issue date)
  const monthOnly = faturas.filter(f => invoiceMonth(f) === autoPeriod)
  // v1.0.133 · every invoice is reachable here: open (to receive) / overdue / this month / all.
  // The Cashflow "A receber" / "Vencido" totals are these same lists (click there → here).
  const today = tokyoToday()
  const views = {
    open: faturas.filter(isReceivable),
    overdue: faturas.filter(f => isOverdueInvoice(f, today)),
    month: monthOnly,
    all: faturas,
  }
  const view = views[listView] ? listView : 'all'
  const monthList = views[view]
  const viewSum = monthList.filter(f => f.status !== 'cancelled').reduce((s, f) => s + Number(f.total || 0), 0)

  const statusBadge = s => ({draft:'badge-amber',sent:'badge-blue',paid:'badge-green',cancelled:'badge-red',overdue:'badge-red'}[s]||'badge-navy')

  return (
    <div>
      <div className="tab-pills">
        <button className={`tab-pill${tab==='list'?' active':''}`} onClick={()=>setTab('list')}>{fill(inv.list, { n: monthList.length })}</button>
        <button className={`tab-pill${tab==='new'?' active':''}`} onClick={()=>setTab('new')}>{inv.new}</button>
      </div>

      {tab==='list'&&(
        <div>
          <div className="card" style={{marginBottom:14}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
              <div>
                <div className="card-title" style={{marginBottom:3}}>⚡ {tr('Automatic billing', '自動請求', 'Faturamento automático')}</div>
                <div style={{fontSize:12,color:'var(--text3)'}}>{tr('One invoice per client · one line per restaurant with its monthly value', '顧客ごとに1枚 · 店舗ごとに月額1行', 'Um 請求書 por cliente · uma linha por restaurante com o valor mensal')}</div>
              </div>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <input type="month" value={autoPeriod} onChange={e=>setAutoPeriod(e.target.value)} />
                <button className="btn btn-primary" onClick={handleAutoBilling} disabled={autoLoading}>
                  {autoLoading ? tr('Generating...', '作成中...', 'Gerando...') : tr('Generate invoices', '請求書を作成', 'Gerar faturas')}
                </button>
              </div>
            </div>
          </div>
          {!searchId && (
            <div className="tab-pills" style={{ marginBottom: 10 }}>
              {[
                ['open', tr('To receive', '未入金', 'A receber')],
                ['overdue', tr('Overdue', '期限切れ', 'Vencidas')],
                ['month', tr(`Month ${autoPeriod}`, `${autoPeriod}`, `Mês ${autoPeriod}`)],
                ['all', tr('All', 'すべて', 'Todas')],
              ].map(([k, label]) => (
                <button key={k} type="button" className={`tab-pill${view === k ? ' active' : ''}`} onClick={() => setListView(k)}>{label} ({views[k].length})</button>
              ))}
              {!loading && <span style={{ fontSize: 12, color: 'var(--text3)', alignSelf: 'center' }}>{tr('Total', '合計', 'Total')} ¥{viewSum.toLocaleString()}</span>}
            </div>
          )}
          {loading&&<div style={{color:'var(--text3)',fontSize:13}}>Loading...</div>}
          {faturas.length===0&&!loading&&<div className="card"><div style={{color:'var(--text3)',fontSize:13}}>{tr('No invoices yet.','請求書はまだありません。','Nenhuma fatura ainda.')}</div></div>}
          {!loading && !searchId && faturas.length > 0 && monthList.length === 0 && <div className="card"><div style={{color:'var(--text2)',fontSize:13}}>{view === 'month' ? tr('No invoices for this month.','この月の請求書はありません。','Nenhuma fatura neste mês.') : tr('No invoices in this list.','この一覧に請求書はありません。','Nenhuma fatura nesta lista.')}</div></div>}
          {(searchId ? faturas.filter(f => f.id === searchId) : monthList).map(f=>(
            <div key={f.id} className="card" style={{marginBottom:12,cursor:'pointer'}} onClick={()=>openDetail(f)}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                <div>
                  <div style={{fontWeight:700,fontSize:15}}>{f.client_name} <span onClick={ev=>ev.stopPropagation()} style={{fontSize:12,fontWeight:500}}><ClientLink id={f.client_id} name={tr('client ›','顧客 ›','cliente ›')} /></span></div>
                  <div style={{fontSize:12,color:'var(--text3)',marginTop:2}}>{tr('Period','対象期間','Período')}: {periodLabel(f.period_start, f.period_end) || '—'}</div>
                  <div style={{fontSize:12,color:'var(--text3)'}}>{tr('Issued', '発行', 'Emitida')}: {shortDate(f.issue_date, lang)} · {tr('Due', '期限', 'Vencimento')}: {shortDate(f.due_date, lang)}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:18,fontWeight:700,color:'var(--green)'}}>¥{Number(f.total||0).toLocaleString()}</div>
                  <span className={`badge ${statusBadge(f.status)}`}>{statusLabel(f.status, lang)}</span>
                </div>
              </div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}} onClick={ev=>ev.stopPropagation()}>
                <button className="btn btn-sm" onClick={()=>openDetail(f)}>📄 {tr('Details','明細','Detalhe')}</button>
                <button className="btn btn-sm" onClick={()=>handlePrint(f)}>🖨️ {tr('Print','印刷','Imprimir')}</button>
                {f.status==='draft'&&<button className="btn btn-sm btn-primary" onClick={()=>openDates(f,'send')}>📤 {tr('Mark sent','送付済にする','Marcar enviada')}</button>}
                {f.status!=='cancelled'&&<button className="btn btn-sm" onClick={()=>openDates(f,'edit')}>📅 {tr('Dates','日付','Datas')}</button>}
                {['sent','pending','overdue'].includes(f.status)&&<button className="btn btn-sm" style={{background:'var(--green)',color:'#fff'}} onClick={()=>handleStatusChange(f.id,'paid')}>✅ {tr('Mark paid','入金済にする','Marcar paga')}</button>}
                {['sent','pending','overdue','paid'].includes(f.status)&&<button className="btn btn-sm" onClick={()=>navigate(`/ryoshu?fatura=${f.id}`)}>🧾 {tr('Receipt','領収書','Recibo')}</button>}
                {f.status!=='cancelled'&&<button className="btn btn-sm btn-danger-soft" onClick={()=>handleStatusChange(f.id,'cancelled')}>{tr('Cancel','取消','Cancelar')}</button>}
                <button className="btn btn-sm btn-danger" onClick={()=>handleDelete(f.id)}>🗑 {tr('Delete','削除','Apagar')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab==='new'&&(
        <div>
          <div className="card" style={{marginBottom:14}}>
            <div className="card-title">{inv.newTitle}</div>
            <div className="grid-2">
              <div className="form-group" style={{gridColumn:'1/-1'}}>
                <label>{tr('Client','顧客','Cliente')} *</label>
                <select value={form.client_id} onChange={e=>upd('client_id',e.target.value)}>
                  <option value="">{tr('Select client…','顧客を選択…','Escolha o cliente…')}</option>
                  {clients.filter(c=>c.is_active!==false).map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}
                  {clients.some(c=>c.is_active===false)&&(
                    <optgroup label={tr('Inactive clients','休止中の顧客','Clientes inativos')}>
                      {clients.filter(c=>c.is_active===false).map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}
                    </optgroup>
                  )}
                </select>
              </div>
              <div className="form-group"><label>{tr('Issue date','発行日','Data de emissão')}</label><input type="date" value={form.issue_date} onChange={e=>upd('issue_date',e.target.value)} /></div>
              <div className="form-group"><label>{tr('Period start','期間開始','Início do período')}</label><input type="date" value={form.period_start} onChange={e=>upd('period_start',e.target.value)} /></div>
              <div className="form-group"><label>{tr('Period end','期間終了','Fim do período')}</label><input type="date" value={form.period_end} onChange={e=>upd('period_end',e.target.value)} /></div>
              <div className="form-group"><label>{tr('Due date','支払期限','Vencimento')}</label><input type="date" value={form.due_date} onChange={e=>upd('due_date',e.target.value)} />
                {!form.due_date && <button type="button" className="btn btn-sm" style={{marginTop:6}} onClick={()=>upd('due_date', dayOfNextMonth(form.issue_date||tokyoToday(), 10))}>{tr('10th next month','翌月10日','Dia 10 do mês seguinte')}</button>}
                {form.due_date && form.issue_date && form.due_date < form.issue_date && <div className="badge badge-red" style={{marginTop:6}}>{tr('Due is before the issue date','支払期限が発行日より前です','Vencimento antes da emissão')}</div>}
              </div>
              <div className="form-group"><label>{tr('Tax rate (%)','税率 (%)','Imposto (%)')}</label>
                <select value={form.tax_rate} onChange={e=>upd('tax_rate',e.target.value)}>
                  <option value={10}>10%</option><option value={8}>8%</option><option value={0}>0%</option>
                </select>
              </div>
              <div className="form-group" style={{gridColumn:'1/-1'}}><label>{tr('Notes','備考','Observações')}</label><input value={form.notes} onChange={e=>upd('notes',e.target.value)} /></div>
            </div>
          </div>

          <div className="card" style={{marginBottom:14}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <div className="card-title" style={{margin:0}}>Items {jobs.length>0&&<span style={{fontSize:11,color:'var(--text3)',fontWeight:400}}>({jobs.length} completed jobs found)</span>}</div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                <button className="btn btn-sm" onClick={fillMonthlyByRestaurant}>🏪 {tr('Monthly value per restaurant','店舗ごとの月額','Valor mensal por restaurante')}</button>
                <button className="btn btn-sm btn-primary" onClick={addItem}>+ Add Item</button>
              </div>
            </div>
            {items.length===0&&<div style={{color:'var(--text3)',fontSize:13}}>No items. Select client + period or add manually.</div>}
            {items.map((it,i)=>(
              <div key={i} style={{display:'grid',gridTemplateColumns:'3fr 1fr 1fr 1fr auto',gap:8,marginBottom:8,alignItems:'center'}}>
                <input value={it.description} onChange={e=>updItem(i,'description',e.target.value)} placeholder={tr('Description','内容','Descrição')} style={{padding:'7px 10px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:13}} />
                <input type="number" value={it.quantity} onChange={e=>updItem(i,'quantity',e.target.value)} placeholder={tr('Qty','数量','Qtd')} style={{padding:'7px 10px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:13}} />
                <input type="number" value={it.unit_price} onChange={e=>updItem(i,'unit_price',e.target.value)} placeholder={tr('Price','単価','Preço')} style={{padding:'7px 10px',borderRadius:8,border:'1px solid var(--border)',background:'var(--surface)',color:'var(--text)',fontSize:13}} />
                <div style={{fontSize:13,fontWeight:600,color:'var(--green)'}}>¥{Number(it.total||0).toLocaleString()}</div>
                <button className="btn btn-sm btn-danger" onClick={()=>removeItem(i)}>✕</button>
              </div>
            ))}
            <div style={{borderTop:'1px solid var(--border)',marginTop:12,paddingTop:12}}>
              <div style={{display:'flex',justifyContent:'flex-end',gap:20,fontSize:13}}>
                <span style={{color:'var(--text3)'}}>Subtotal: <strong>¥{subtotal.toLocaleString()}</strong></span>
                <span style={{color:'var(--text3)'}}>Tax ({form.tax_rate}%): <strong>¥{tax.toLocaleString()}</strong></span>
                <span style={{color:'var(--green)',fontWeight:700,fontSize:15}}>Total: ¥{total.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div style={{display:'flex',gap:8}}>
            <button className="btn btn-primary" onClick={handleCreate}>✅ {tr('Create invoice', '請求書を作成', 'Criar fatura')}</button>
            <button className="btn" onClick={()=>setTab('list')}>{tr('Cancel','キャンセル','Cancelar')}</button>
          </div>
        </div>
      )}

      {preview && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={()=>!autoLoading&&setPreview(null)}>
          <div className="card" style={{ width:'min(680px,100%)', maxHeight:'92vh', overflowY:'auto' }} onClick={e=>e.stopPropagation()}>
            <div className="card-title">👁 {tr('Check before generating', '作成前の確認', 'Conferir antes de gerar')} · {preview.start.slice(0,7)}</div>
            <div style={{ fontSize:12, color:'var(--text3)', marginBottom:10 }}>{tr('Nothing was saved yet. Each client below becomes ONE draft invoice, one line per restaurant with its monthly value. You can change a value or remove a restaurant.', 'まだ保存されていません。顧客ごとに下書き請求書が1件、店舗ごとに月額1行で作成されます。金額の変更・店舗の除外ができます。', 'Nada foi salvo ainda. Cada cliente abaixo vira UMA fatura em rascunho, com uma linha por restaurante e o valor mensal. Dá para mudar o valor ou tirar um restaurante.')}</div>
            {preview.plans.length === 0 && <div style={{ fontSize:13, color:'var(--text2)' }}>{tr('Nothing to bill for this month.', 'この月の請求対象はありません。', 'Nada para faturar neste mês.')}</div>}
            {preview.plans.map((p, ci) => {
              const tt = planTotals(p)
              const subject = monthlySubject(preview.start, preview.end, lang === 'en' ? 'en' : 'ja')
              return (
                <div key={p.client.id} className="kp-monthly-plan" style={{ borderTop:'1px solid var(--border)', padding:'12px 0' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', gap:8, fontWeight:700, flexWrap:'wrap' }}>
                    <span style={{ minWidth:0, overflowWrap:'anywhere' }}>{p.client.company_name} 様</span>
                    <span>¥{tt.total.toLocaleString()}</span>
                  </div>
                  {subject && <div style={{ fontSize:12, color:'var(--text3)', marginTop:2 }}>{tr('Subject','件名','Assunto')}: {subject} · {p.lines.filter(l=>!l.removed).length} {tr('restaurant(s)','店舗','restaurante(s)')}</div>}
                  <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) auto auto', gap:'6px 8px', alignItems:'center', marginTop:8, fontSize:13 }}>
                    <span style={{ fontSize:11, color:'var(--text3)' }}>{tr('Restaurant','店舗・品名','Restaurante')}</span>
                    <span style={{ fontSize:11, color:'var(--text3)', textAlign:'right' }}>{tr('Monthly value','月額','Valor mensal')}</span>
                    <span />
                    {p.lines.map((l, li) => (
                      <div key={l.contract_id || li} style={{ display:'contents' }}>
                        <span style={{ minWidth:0, overflowWrap:'anywhere', opacity: l.removed ? 0.45 : 1, textDecoration: l.removed ? 'line-through' : 'none' }}>
                          {l.restaurant}
                          <span style={{ display:'block', fontSize:11, color:'var(--text3)' }}>
                            {l.monthly ? tr('Fixed monthly','固定月額','Mensal fixo') : `${l.visits} × ¥${Number(l.price_per_visit||0).toLocaleString()}`}
                            {l.discount_amount > 0 ? ` · −${l.discount_percent}%` : ''}
                          </span>
                        </span>
                        <input type="number" min="0" inputMode="numeric" disabled={l.removed} value={l.total}
                          onChange={e => { const v = Math.max(0, Math.round(Number(e.target.value) || 0)); patchLine(ci, li, { total: v, unit_price: v }) }}
                          style={{ width:110, textAlign:'right', padding:'6px 8px', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text)', fontSize:13 }} />
                        <button type="button" className="btn btn-sm" title={l.removed ? tr('Put back','戻す','Voltar') : tr('Remove','外す','Tirar')} onClick={() => patchLine(ci, li, { removed: !l.removed })}>{l.removed ? '↺' : '✕'}</button>
                      </div>
                    ))}
                  </div>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:10 }}>
                    {[['excl', tr('Values before tax (+tax)','税抜（＋消費税）','Valores sem imposto (+imposto)')], ['incl', tr('Values include tax','税込','Valores com imposto incluso')]].map(([k, label]) => (
                      <button key={k} type="button" className={`tab-pill${p.taxMode === k ? ' active' : ''}`} onClick={() => patchPlan(ci, x => ({ ...x, taxMode: k }))}>{label}</button>
                    ))}
                  </div>
                  <div style={{ fontSize:13, marginTop:8, display:'grid', gridTemplateColumns:'1fr auto', gap:'2px 12px', maxWidth:320, marginLeft:'auto' }}>
                    <span style={{ color:'var(--text3)' }}>{tt.includesTax ? tr('Subtotal (tax incl.)','小計（税込）','Subtotal (com imposto)') : tr('Subtotal','小計','Subtotal')}</span><span style={{ textAlign:'right' }}>¥{(tt.includesTax ? tt.total : tt.subtotal).toLocaleString()}</span>
                    <span style={{ color:'var(--text3)' }}>{tt.includesTax ? tr('of which tax','うち消費税','dos quais imposto') : tr('Tax','消費税','Imposto')} ({p.taxRate}%)</span><span style={{ textAlign:'right' }}>¥{tt.tax.toLocaleString()}</span>
                    <b>{tr('Total','合計','Total')}</b><b style={{ textAlign:'right' }}>¥{tt.total.toLocaleString()}</b>
                    <span style={{ color:'var(--text3)' }}>{tr('Due','支払期限','Vencimento')}</span><span style={{ textAlign:'right' }}>{p.dueDate}</span>
                  </div>
                </div>
              )
            })}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, flexWrap:'wrap', marginTop:12 }}>
              <b>{tr('Total','合計','Total')} ¥{activePlans.reduce((s,p)=>s+planTotals(p).total,0).toLocaleString()}</b>
              <div style={{ display:'flex', gap:8 }}>
                <button className="btn" disabled={autoLoading} onClick={()=>setPreview(null)}>{tr('Cancel','キャンセル','Cancelar')}</button>
                {activePlans.length > 0 && <button className="btn btn-primary" disabled={autoLoading} onClick={confirmAutoBilling}>{autoLoading ? '…' : tr(`Create ${activePlans.length} draft(s)`, `下書き${activePlans.length}件を作成`, `Criar ${activePlans.length} rascunho(s)`)}</button>}
              </div>
            </div>
          </div>
        </div>
      )}

      {detail && (() => {
        const { f, items: its, view } = detail
        const shown = view || { subtotal: Number(f.subtotal||0), tax: Number(f.tax_amount||0), total: Number(f.total||0), taxIncluded: false }
        return (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={()=>setDetail(null)}>
            <div className="card" style={{ width:'min(620px,100%)', maxHeight:'92vh', overflowY:'auto' }} onClick={e=>e.stopPropagation()}>
              <div className="card-title">📄 {f.client_name} · {periodLabel(f.period_start, f.period_end) || f.issue_date}</div>
              <div style={{ fontSize:12, color:'var(--text3)', marginBottom:10 }}>{tr('Issued','発行','Emitida')} {shortDate(f.issue_date, lang)} · {tr('Due','期限','Vencimento')} {shortDate(f.due_date, lang)} · <span className={`badge ${statusBadge(f.status)}`}>{statusLabel(f.status, lang)}</span></div>
              {its === null && <div className="kp-skel-text">{tr('Loading…','読み込み中…','Carregando…')}</div>}
              {its && its.length === 0 && <div style={{ fontSize:13, color:'var(--text3)' }}>{tr('This invoice has no lines.','明細行がありません。','Esta fatura não tem linhas.')}</div>}
              {its && its.length > 0 && (
                <table style={{ width:'100%', fontSize:12 }}>
                  <thead><tr><th style={{textAlign:'left'}}>{tr('Service','内容','Serviço')}</th><th>{tr('Qty × price','数量×単価','Qtd × preço')}</th><th>{tr('Discount','割引','Desconto')}</th><th style={{textAlign:'right'}}>{tr('Value','金額','Valor')}</th></tr></thead>
                  <tbody>
                    {its.map((it, i) => (
                      <tr key={it.id || i}>
                        <td style={{ overflowWrap:'anywhere' }}>{it.description}</td>
                        <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>{it.quantity} × ¥{Number(it.unit_price||0).toLocaleString()}</td>
                        <td style={{ textAlign:'center' }}>{Number(it.discount_amount||0) > 0 ? `−¥${Number(it.discount_amount).toLocaleString()}` : '—'}</td>
                        <td style={{ textAlign:'right' }}>¥{Number(it.total||0).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div style={{ marginTop:10, fontSize:13 }}>
                {view?.fromQuote && <div style={{ fontSize:11, color:'var(--text3)', marginBottom:4 }}>{tr('Lines copied from the accepted quote','承認済み見積の明細','Linhas iguais ao orçamento aceito')}</div>}
                <div style={{ display:'flex', justifyContent:'space-between' }}><span>{shown.taxIncluded ? tr('Subtotal (tax incl.)','小計（税込）','Subtotal (com imposto)') : tr('Subtotal','小計','Subtotal')}</span><span>¥{(shown.taxIncluded ? shown.total : shown.subtotal).toLocaleString()}</span></div>
                <div style={{ display:'flex', justifyContent:'space-between' }}><span>{shown.taxIncluded ? tr('of which tax','うち消費税','dos quais imposto') : tr('Tax','消費税','Imposto')} ({f.tax_rate}%)</span><span>¥{shown.tax.toLocaleString()}</span></div>
                <div style={{ display:'flex', justifyContent:'space-between', fontWeight:700, fontSize:15 }}><span>{tr('Total','合計','Total')}</span><span>¥{shown.total.toLocaleString()}</span></div>
                {!view && its && its.length > 0 && Math.abs(its.reduce((s,it)=>s+Number(it.total||0),0) - Number(f.total||0)) > 1 && Math.abs(its.reduce((s,it)=>s+Number(it.total||0),0) - Number(f.subtotal||0)) > 1 && (
                  <div className="badge badge-amber" style={{ marginTop:6 }}>{tr(`Lines add up to ¥${its.reduce((s,it)=>s+Number(it.total||0),0).toLocaleString()} — check`, `明細合計 ¥${its.reduce((s,it)=>s+Number(it.total||0),0).toLocaleString()} — 要確認`, `As linhas somam ¥${its.reduce((s,it)=>s+Number(it.total||0),0).toLocaleString()} — conferir`)}</div>
                )}
              </div>
              <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12, flexWrap:'wrap' }}>
                {f.status!=='cancelled'&&<button className="btn" onClick={()=>openDates(f,'edit')}>📅 {tr('Dates','日付','Datas')}</button>}
                <button className="btn" onClick={()=>handlePrint(f)}>🖨️ {tr('Print','印刷','Imprimir')}</button>
                <button className="btn" onClick={()=>setDetail(null)}>{tr('Close','閉じる','Fechar')}</button>
              </div>
            </div>
          </div>
        )
      })()}

      {datesFor && (
        <InvoiceDatesDialog
          initial={datesFor.initial}
          title={datesFor.mode === 'send' ? tr('Check the dates and send','日付を確認して送付','Conferir as datas e enviar') : tr('Invoice dates','請求書の日付','Datas da fatura')}
          intro={`${datesFor.f.client_name || ''} · ¥${Number(datesFor.f.total||0).toLocaleString()}${datesFor.f.status !== 'draft' ? ' · ' + tr('The INV number follows the issue date.','請求書番号は発行日に連動します。','O número INV acompanha a data de emissão.') : ''}`}
          saveLabel={datesFor.mode === 'send' ? tr('Mark sent','送付済にする','Marcar enviada') : undefined}
          onSave={saveDates}
          onClose={() => setDatesFor(null)}
        />
      )}
    </div>
  )
}
