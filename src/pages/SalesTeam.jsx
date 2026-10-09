import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import { salesGet, salesPost } from '../lib/salesApi'

const TXT = {
  en: { title:'Sales performance', create:'Create seller login', name:'Name', email:'Email', password:'Temporary password (10+ characters)', phone:'Phone', add:'Create access', team:'Team', approaches:'Approaches', leads:'Leads', quotes:'Quotes', average:'Avg. quote', conversion:'Approach→won', contracts:'Active contracts', newContracts:'New contracts', commission:'Commission', followups:'Follow-ups', due:'Due', pipeline:'Pipeline', assign:'Assign seller', none:'Unassigned', review:'Contract approvals', approve:'Approve', changes:'Request changes', reject:'Reject', note:'Review note', openPdf:'Signed PDF', active:'Active', inactive:'Inactive', commissionRule:'Commission default', percent:'Percent', fixed:'Fixed', value:'Value', saveRule:'Save rule', reports:'Field reports', travel:'Travel', hours:'Hours', noRows:'No records yet.', loading:'Loading…', goals:'KPI targets', goalsHint:'Set goals for each seller. Progress uses real records in the selected period.', period:'Period', today:'Today', month:'This month', year:'This year', all:'All time', target:'Target', progress:'Progress', savedHere:'Targets are saved in this browser.', revenue:'Monthly contract value' },
  ja: { title:'営業実績', create:'営業アカウントを作成', name:'氏名', email:'メール', password:'仮パスワード (10文字以上)', phone:'電話', add:'アクセスを作成', team:'営業チーム', approaches:'営業活動', leads:'リード', quotes:'見積', average:'見積平均', conversion:'成約率', contracts:'有効契約', newContracts:'新規契約', commission:'コミッション', followups:'フォローアップ', due:'期限', pipeline:'営業案件', assign:'営業担当を割り当て', none:'未割当', review:'契約承認', approve:'承認', changes:'修正を依頼', reject:'却下', note:'確認コメント', openPdf:'署名済みPDF', active:'有効', inactive:'無効', commissionRule:'基本コミッション', percent:'割合', fixed:'固定', value:'金額', saveRule:'保存', reports:'活動報告', travel:'交通費', hours:'時間', noRows:'記録はありません。', loading:'読み込み中…', goals:'KPI目標', goalsHint:'営業担当ごとの目標を設定します。選択した期間の実績を表示します。', period:'期間', today:'今日', month:'今月', year:'今年', all:'全期間', target:'目標', progress:'進捗', savedHere:'目標はこのブラウザーに保存されます。', revenue:'月間契約額' },
}
const yen = n => `¥${Math.round(Number(n || 0)).toLocaleString()}`
const japanToday = () => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Tokyo' }).format(new Date())
export default function SalesTeam() {
  const { lang } = useLang()
  const t = TXT[lang === 'ja' ? 'ja' : 'en']
  const [data, setData] = useState(null)
  const [selectedId, setSelectedId] = useState('')
  const [form, setForm] = useState({ full_name:'', email:'', password:'', phone:'' })
  const [reviewNote, setReviewNote] = useState({})
  const [rules, setRules] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [period, setPeriod] = useState('month')
  const [goals, setGoals] = useState(() => {
    try { return JSON.parse(localStorage.getItem('kp_sales_kpi_goals') || '{}') }
    catch { return {} }
  })

  useEffect(() => { localStorage.setItem('kp_sales_kpi_goals', JSON.stringify(goals)) }, [goals])

  const load = useCallback(async () => {
    try { setData(await salesGet('/api/sales-data?action=dashboard', lang)); setError('') }
    catch (e) { setError(e.message) }
  }, [lang])
  useEffect(() => { load() }, [load])

  const act = async body => {
    setBusy(true)
    try { await salesPost('/api/sales-data', body, lang); toast.success('Saved'); await load() }
    catch (e) { toast.error(e.message) }
    finally { setBusy(false) }
  }

  const createSeller = async e => {
    e.preventDefault()
    await act({ action:'create-salesperson', ...form })
    setForm({ full_name:'', email:'', password:'', phone:'' })
  }

  const review = async (row, status) => act({ action:'review-contract', id:row.id, status, admin_note:reviewNote[row.id] || '' })

  const getPdf = async row => {
    try {
      const response = await fetch(`/api/sales-files?path=${encodeURIComponent(row.signed_pdf_object_path)}&submission_id=${encodeURIComponent(row.id)}`, { credentials:'same-origin' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      window.open(result.url, '_blank', 'noopener,noreferrer')
    } catch (e) { toast.error(e.message) }
  }

  const metrics = data?.metrics || []
  const sellers = data?.salespeople || []
  const leads = data?.leads || []
  const seller = sellers.find(x => x.id === selectedId)
  const contracts = (data?.contracts || []).filter(x => x.status === 'pending_review' || x.status === 'changes_requested')
  const reports = (data?.reports || []).filter(x => !selectedId || x.salesperson_id === selectedId)
  const today = japanToday()
  const inPeriod = value => {
    const date = String(value || '').slice(0, 10)
    if (!date) return false
    if (period === 'today') return date === today
    if (period === 'month') return date.startsWith(today.slice(0, 7))
    if (period === 'year') return date.startsWith(today.slice(0, 4))
    return true
  }
  const metricsFor = salespersonId => {
    const sellerLeads = leads.filter(x => x.salesperson_id === salespersonId && inPeriod(x.first_contact_date || x.created_at))
    const sellerApproaches = (data?.approaches || []).filter(x => x.salesperson_id === salespersonId && inPeriod(x.work_date))
    const sellerQuotes = (data?.quotes || []).filter(x => x.salesperson_id === salespersonId && inPeriod(x.created_at))
    const sellerContracts = (data?.contracts || []).filter(x => x.salesperson_id === salespersonId && inPeriod(x.created_at))
    const activeContracts = sellerContracts.filter(x => ['active','approved'].includes(x.status))
    const wins = leads.filter(x => x.salesperson_id === salespersonId && x.stage === 'won' && inPeriod(x.updated_at || x.first_contact_date || x.created_at)).length
    return {
      approaches:sellerApproaches.length, leads:sellerLeads.length, quotes:sellerQuotes.length,
      quoteAverage:sellerQuotes.length ? sellerQuotes.reduce((sum,x)=>sum+Number(x.total||0),0)/sellerQuotes.length : 0,
      wins, conversion:sellerApproaches.length ? wins/sellerApproaches.length*100 : 0,
      activeContracts:activeContracts.length,
      revenue:activeContracts.reduce((sum,x)=>sum+Number(x.client_monthly_total||0),0),
    }
  }
  const periodOptions = [['today',t.today],['month',t.month],['year',t.year],['all',t.all]]
  const setGoal = (personId, key, value) => setGoals(current => ({ ...current, [period]: { ...(current[period] || {}), [personId]: { ...(current[period]?.[personId] || {}), [key]:value } } }))

  return <div className="sales-admin-page">
    <div className="sales-admin-heading"><div><div className="sales-kicker">KURIPURO · SALES MANAGEMENT</div><h1>{t.title}</h1></div></div>
    {error && <div className="card sales-setup-note"><strong>Sales API setup required</strong><p>{error}</p><small>Configure the server keys and review the sales migration before using this workspace.</small></div>}
    {!data && !error && <div className="card">{t.loading}</div>}
    {data && <>
      <section className="card sales-goals-section">
        <div className="sales-section-head"><div><div className="card-title">{t.goals}</div><p className="sales-muted">{t.goalsHint}</p></div><label className="sales-period-filter"><span>{t.period}</span><select value={period} onChange={e=>setPeriod(e.target.value)}>{periodOptions.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
        <div className="sales-muted sales-goals-note">{t.savedHere}</div>
        <div className="sales-goals-grid">{sellers.map(person=>{
          const actual=metricsFor(person.id)
          const personGoals=goals[period]?.[person.id]||{}
          const kpis=[['approaches',t.approaches,actual.approaches],['quotes',t.quotes,actual.quotes],['contracts',t.newContracts,actual.activeContracts],['revenue',t.revenue,actual.revenue]]
          return <article className="sales-goal-card" key={person.id}>
            <div className="sales-goal-person"><strong>{person.full_name}</strong><span>{actual.leads} {t.leads} · {actual.conversion.toFixed(1)}% {t.conversion}</span></div>
            {kpis.map(([key,label,value])=>{
              const goal=Number(personGoals[key]||0)
              const percent=goal?Math.min(100,value/goal*100):0
              return <div className="sales-goal-row" key={key}>
                <div className="sales-goal-meta"><span>{label}</span><b>{key==='revenue'?yen(value):value}</b></div>
                <div className="sales-goal-track"><i style={{width:`${percent}%`}} /></div>
                <label><span>{t.target}</span><input type="number" min="0" step={key==='revenue'?'1000':'1'} value={personGoals[key]??''} onChange={e=>setGoal(person.id,key,e.target.value)} /></label>
              </div>
            })}
          </article>
        })}</div>
      </section>
      <div className="sales-metrics sales-admin-top-metrics">
        {[[t.leads, leads.filter(x=>inPeriod(x.first_contact_date||x.created_at)).length], [t.approaches, (data.approaches || []).filter(x=>inPeriod(x.work_date)).length], [t.quotes, (data.quotes || []).filter(x=>inPeriod(x.created_at)).length], [t.newContracts, (data.contracts || []).filter(x=>inPeriod(x.created_at)&&['active','approved'].includes(x.status)).length], [t.followups, leads.filter(x=>x.next_followup_date && x.next_followup_date <= today && !['won','lost'].includes(x.stage)).length]].map(([label,value])=><div className="sales-metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
      <div className="sales-admin-grid">
        <form className="card" onSubmit={createSeller}><div className="card-title">{t.create}</div><div className="sales-form-grid">
          {['full_name','email','password','phone'].map(key=><label className="form-group" key={key}><span>{t[key]}</span><input type={key==='password'?'password':key==='email'?'email':'text'} autoComplete="off" value={form[key]} onChange={e=>setForm(v=>({...v,[key]:e.target.value}))}/></label>)}
        </div><button className="btn btn-primary" disabled={busy}>{t.add}</button></form>
        <section className="card"><div className="card-title">{t.team}</div>{sellers.map(person=>{
          const m = metrics.find(x=>x.salesperson_id===person.id) || {}
          const pm = metricsFor(person.id)
          const rule = data.commissionRules?.find(x=>x.salesperson_id===person.id)
          const value = rules[person.id] || { commission_type:rule?.commission_type || 'percent', commission_value:rule?.commission_value ?? 0, percent_basis:rule?.percent_basis || 'base_monthly' }
          return <div className={`sales-manager-person${selectedId===person.id?' selected':''}`} key={person.id}>
            <button className="sales-manager-person-select" onClick={()=>setSelectedId(person.id)}><strong>{person.full_name}</strong><small>{person.email} · {person.is_active?t.active:t.inactive}</small></button>
            <div className="sales-manager-mini-metrics">{[[t.approaches,pm.approaches],[t.leads,pm.leads],[t.quotes,pm.quotes],[t.average,yen(pm.quoteAverage)],[t.conversion,`${Number(pm.conversion||0).toFixed(1)}%`],[t.newContracts,pm.activeContracts],[t.commission,yen(m.commission_pending)]].map(([label,num])=><span key={label}><b>{num}</b>{label}</span>)}</div>
            <div className="sales-rule-row"><span>{t.commissionRule}</span><select value={value.commission_type} onChange={e=>setRules(v=>({...v,[person.id]:{...value,commission_type:e.target.value}}))}><option value="percent">{t.percent}</option><option value="fixed">{t.fixed}</option></select><input aria-label={t.value} type="number" min="0" step="0.1" value={value.commission_value} onChange={e=>setRules(v=>({...v,[person.id]:{...value,commission_value:e.target.value}}))}/><button className="btn btn-sm" disabled={busy} onClick={()=>act({action:'set-commission-rule',salesperson_id:person.id,...value})}>{t.saveRule}</button></div>
            <button className="btn btn-sm" onClick={()=>act({action:'set-salesperson-active',salesperson_id:person.id,is_active:!person.is_active})}>{person.is_active?t.inactive:t.active}</button>
          </div>
        })}</section>
      </div>

      <section className="card"><div className="sales-section-head"><div><div className="card-title">{t.pipeline}</div><p className="sales-muted">Leads, assignments, and due dates</p></div><select aria-label={t.assign} value={selectedId} onChange={e=>setSelectedId(e.target.value)}><option value="">{t.none}</option>{sellers.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
        {leads.filter(row=>!selectedId || row.salesperson_id===selectedId).map(row=><div className="sales-row" key={row.id}><div><strong>{row.site_name||row.company_name}</strong><small>{row.contact_name} · {row.stage} · {row.next_followup_date||'—'}</small></div><select value={row.salesperson_id||''} onChange={e=>act({action:'assign-lead',lead_id:row.id,salesperson_id:e.target.value||null})}><option value="">{t.none}</option>{sellers.map(p=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>)}
      </section>

      <section className="card"><div className="card-title">{t.review}</div>{contracts.length===0&&<p className="sales-muted">{t.noRows}</p>}{contracts.map(row=><div className="sales-review-card" key={row.id}>
        <div className="sales-review-header"><div><strong>{row.company_name} · {row.site_name}</strong><small>{sellers.find(p=>p.id===row.salesperson_id)?.full_name} · {row.status}</small></div><button className="btn btn-sm" onClick={()=>getPdf(row)}>{t.openPdf}</button></div>
        <div className="sales-manager-mini-metrics">{[[t['monthlyBase']||'Base price',yen(row.base_monthly_amount)],[t.commission,yen(row.commission_amount)],[t.totalClient||'Client total',yen(row.client_monthly_total)],[t.average,row.billing_type]].map(([label,value])=><span key={label}><b>{value}</b>{label}</span>)}</div>
        <textarea rows="2" placeholder={t.note} value={reviewNote[row.id]||''} onChange={e=>setReviewNote(v=>({...v,[row.id]:e.target.value}))}/>
        <div className="sales-action-row"><button className="btn btn-primary" onClick={()=>review(row,'approved')} disabled={busy}>{t.approve}</button><button className="btn" onClick={()=>review(row,'changes_requested')} disabled={busy}>{t.changes}</button><button className="btn btn-danger" onClick={()=>review(row,'rejected')} disabled={busy}>{t.reject}</button></div>
      </div>)}</section>
      <section className="card"><div className="card-title">{t.reports}{seller?` · ${seller.full_name}`:''}</div>{reports.slice(0,80).map(row=><div className="sales-row" key={row.id}><div><strong>{row.work_date} · {row.salesperson_id===selectedId?seller?.full_name:sellers.find(p=>p.id===row.salesperson_id)?.full_name}</strong><small>{row.hours_worked} {t.hours} · {t.travel} {yen(row.travel_cost)} · {row.areas}</small><p>{row.summary}</p></div></div>)}{reports.length===0&&<p className="sales-muted">{t.noRows}</p>}</section>
    </>}
  </div>
}
