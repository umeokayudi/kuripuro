import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import { salesGet, salesPost } from '../lib/salesApi'
import { tokyoToday } from '../lib/dates'

const COPY = {
  en: { title:'Marketing & acquisition', channels:'Channels', campaigns:'Campaigns', spend:'Ad spend', leads:'Leads', won:'Won contracts', cpl:'Cost per lead', cac:'Cost per acquisition', newChannel:'New channel', channelName:'Channel name', type:'Channel type', platform:'Platform', add:'Save channel', newCampaign:'New campaign', campaignName:'Campaign name', objective:'Objective / audience', channel:'Channel', budget:'Budget (¥)', starts:'Start date', ends:'End date', saveCampaign:'Save campaign', recordSpend:'Record ad spend', amount:'Amount (¥)', date:'Date', details:'Note', saveSpend:'Record spend', noData:'No activity yet.', paid:'Paid ads', organic:'Organic social', referral:'Referral', website:'Website', event:'Event', outbound:'Outbound', other:'Other', status:'Status', active:'Active', paused:'Paused', completed:'Completed', channelPerf:'Channel performance', selectCampaign:'Select campaign', periodSpend:'Recorded spend', tips:'Use one channel/campaign on every lead so acquisition cost and conversion can be measured.', period:'Period', today:'Today', month:'This month', year:'This year', all:'All time', goals:'Marketing KPI targets', goalHint:'Set goals and compare them with tracked activity for the selected period.', target:'Target', savedHere:'Targets are saved in this browser.' },
  ja: { title:'マーケティング・集客', channels:'チャネル', campaigns:'キャンペーン', spend:'広告費', leads:'リード', won:'成約', cpl:'リード単価', cac:'顧客獲得単価', newChannel:'チャネル追加', channelName:'チャネル名', type:'種類', platform:'媒体', add:'保存', newCampaign:'キャンペーン追加', campaignName:'キャンペーン名', objective:'目的・対象', channel:'チャネル', budget:'予算 (¥)', starts:'開始日', ends:'終了日', saveCampaign:'保存', recordSpend:'広告費を記録', amount:'金額 (¥)', date:'日付', details:'メモ', saveSpend:'記録', noData:'活動はありません。', paid:'有料広告', organic:'SNS投稿', referral:'紹介', website:'ウェブサイト', event:'イベント', outbound:'営業活動', other:'その他', status:'状態', active:'実施中', paused:'停止', completed:'完了', channelPerf:'チャネル実績', selectCampaign:'キャンペーンを選択', periodSpend:'記録済み費用', tips:'各リードにチャネルとキャンペーンを設定すると、集客単価と成約率を測定できます。', period:'期間', today:'今日', month:'今月', year:'今年', all:'全期間', goals:'マーケティングKPI目標', goalHint:'目標を設定し、選択期間の実績と比較します。', target:'目標', savedHere:'目標はこのブラウザーに保存されます。' },
}
const yen = n => `¥${Math.round(Number(n || 0)).toLocaleString()}`
const TYPES = ['paid_ads', 'organic_social', 'referral', 'website', 'event', 'outbound', 'other']

export default function Marketing() {
  const { lang } = useLang()
  const t = COPY[lang === 'ja' ? 'ja' : 'en']
  const [data, setData] = useState(null)
  const [channel, setChannel] = useState({ name:'', channel_type:'paid_ads', platform:'' })
  const [campaign, setCampaign] = useState({ channel_id:'', name:'', objective:'', budget:'', starts_on:'', ends_on:'', status:'active' })
  const [spend, setSpend] = useState({ campaign_id:'', amount:'', spent_on:tokyoToday(), description:'' })
  const [error, setError] = useState('')
  const [period, setPeriod] = useState('month')
  const [goals, setGoals] = useState(() => {
    try { return JSON.parse(localStorage.getItem('kp_marketing_kpi_goals') || '{}') }
    catch { return {} }
  })

  useEffect(() => { localStorage.setItem('kp_marketing_kpi_goals', JSON.stringify(goals)) }, [goals])

  const load = useCallback(async () => {
    try {
      const result = await salesGet('/api/sales-data?action=dashboard', lang)
      setData(result.marketing || { channels:[], campaigns:[], spend:[] })
      setError('')
    } catch (e) { setError(e.message) }
  }, [lang])
  useEffect(() => { load() }, [load])

  const save = async (body, reset) => {
    try {
      await salesPost('/api/sales-data', body, lang)
      reset()
      await load()
      toast.success('Saved')
    } catch (e) { toast.error(e.message) }
  }

  const channels = data?.channels || []
  const campaigns = data?.campaigns || []
  const spendRows = data?.spend || []
  const today = tokyoToday()
  const inPeriod = value => {
    const date=String(value||'').slice(0,10)
    if(!date)return false
    if(period==='today')return date===today
    if(period==='month')return date.startsWith(today.slice(0,7))
    if(period==='year')return date.startsWith(today.slice(0,4))
    return true
  }
  const leads = data?.leads || []
  const spendInPeriod = spendRows.filter(row=>inPeriod(row.spent_on))
  const leadsInPeriod = leads.filter(row=>inPeriod(row.first_contact_date||row.created_at))
  const totalSpend = spendInPeriod.reduce((sum,row)=>sum+Number(row.amount||0),0)
  const totalLeads = leadsInPeriod.length
  const wonLeads = leads.filter(row=>row.stage==='won'&&inPeriod(row.updated_at||row.created_at))
  const totalWon = wonLeads.length
  const totalBudget = campaigns.reduce((sum,row)=>sum+Number(row.budget||0),0)
  const labelType = type => t[String(type || 'other').split('_')[0]] || t.other
  const periodOptions=[['today',t.today],['month',t.month],['year',t.year],['all',t.all]]
  const periodGoals=goals[period]||{}
  const goalValues={leads:Number(periodGoals.leads||0),won:Number(periodGoals.won||0),spend:Number(periodGoals.spend||0)}
  const changeGoal=(key,value)=>setGoals(current=>({...current,[period]:{...(current[period]||{}),[key]:value}}))

  return <div className="marketing-page">
    <div className="sales-kicker">KURIPURO · GROWTH</div><h1>{t.title}</h1>
    {error && <div className="card sales-setup-note">{error}<p>Configure the commercial server session and apply the sales migration before using marketing tools.</p></div>}
    {data && <>
      <div className="sales-metrics">
        {[[t.spend,yen(totalSpend)],[t.leads,totalLeads],[t.won,totalWon],[t.cpl,totalLeads?yen(totalSpend/totalLeads):'—'],[t.cac,totalWon?yen(totalSpend/totalWon):'—'],[t.budget||'Budget',yen(totalBudget)]].map(([label,value])=><div className="sales-metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
      <section className="card sales-goals-section">
        <div className="sales-section-head"><div><div className="card-title">{t.goals}</div><p className="sales-muted">{t.goalHint}</p></div><label className="sales-period-filter"><span>{t.period}</span><select value={period} onChange={e=>setPeriod(e.target.value)}>{periodOptions.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
        <div className="sales-muted sales-goals-note">{t.savedHere}</div>
        <div className="sales-goals-grid">{[['leads',t.leads,totalLeads],['won',t.won,totalWon],['spend',t.spend,totalSpend]].map(([key,label,actual])=>{
          const target=goalValues[key]
          const progress=target?Math.min(100,actual/target*100):0
          return <div className="sales-goal-card marketing-goal-card" key={key}><div className="sales-goal-meta"><span>{label}</span><b>{key==='spend'?yen(actual):actual}</b></div><div className="sales-goal-track"><i style={{width:`${progress}%`}} /></div><label><span>{t.target}</span><input type="number" min="0" step={key==='spend'?'1000':'1'} value={periodGoals[key]??''} onChange={e=>changeGoal(key,e.target.value)} /></label></div>
        })}</div>
      </section>
      <p className="sales-muted">{t.tips}</p>
      <div className="sales-admin-grid marketing-forms">
        <form className="card" onSubmit={e=>{e.preventDefault();save({action:'save-marketing-channel',...channel},()=>setChannel({name:'',channel_type:'paid_ads',platform:''}))}}>
          <div className="card-title">{t.newChannel}</div><label className="form-group"><span>{t.channelName}</span><input required value={channel.name} onChange={e=>setChannel(v=>({...v,name:e.target.value}))}/></label>
          <div className="sales-form-grid"><label className="form-group"><span>{t.type}</span><select value={channel.channel_type} onChange={e=>setChannel(v=>({...v,channel_type:e.target.value}))}>{TYPES.map(x=><option value={x} key={x}>{labelType(x)}</option>)}</select></label><label className="form-group"><span>{t.platform}</span><input value={channel.platform} onChange={e=>setChannel(v=>({...v,platform:e.target.value}))}/></label></div><button className="btn btn-primary">{t.add}</button>
        </form>
        <form className="card" onSubmit={e=>{e.preventDefault();save({action:'save-marketing-campaign',...campaign,budget:Number(campaign.budget||0)},()=>setCampaign({channel_id:'',name:'',objective:'',budget:'',starts_on:'',ends_on:'',status:'active'}))}}>
          <div className="card-title">{t.newCampaign}</div><div className="sales-form-grid">
            <label className="form-group"><span>{t.channel}</span><select required value={campaign.channel_id} onChange={e=>setCampaign(v=>({...v,channel_id:e.target.value}))}><option value="">—</option>{channels.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label>
            <label className="form-group"><span>{t.campaignName}</span><input required value={campaign.name} onChange={e=>setCampaign(v=>({...v,name:e.target.value}))}/></label>
            <label className="form-group"><span>{t.budget}</span><input type="number" min="0" value={campaign.budget} onChange={e=>setCampaign(v=>({...v,budget:e.target.value}))}/></label>
            <label className="form-group"><span>{t.status}</span><select value={campaign.status} onChange={e=>setCampaign(v=>({...v,status:e.target.value}))}><option value="active">{t.active}</option><option value="paused">{t.paused}</option><option value="completed">{t.completed}</option></select></label>
          </div><label className="form-group"><span>{t.objective}</span><textarea rows="2" value={campaign.objective} onChange={e=>setCampaign(v=>({...v,objective:e.target.value}))}/></label><div className="sales-form-grid"><label className="form-group"><span>{t.starts}</span><input type="date" value={campaign.starts_on} onChange={e=>setCampaign(v=>({...v,starts_on:e.target.value}))}/></label><label className="form-group"><span>{t.ends}</span><input type="date" value={campaign.ends_on} onChange={e=>setCampaign(v=>({...v,ends_on:e.target.value}))}/></label></div><button className="btn btn-primary">{t.saveCampaign}</button>
        </form>
        <form className="card" onSubmit={e=>{e.preventDefault();save({action:'record-marketing-spend',...spend,amount:Number(spend.amount||0)},()=>setSpend({campaign_id:'',amount:'',spent_on:tokyoToday(),description:''}))}}>
          <div className="card-title">{t.recordSpend}</div><label className="form-group"><span>{t.selectCampaign}</span><select required value={spend.campaign_id} onChange={e=>setSpend(v=>({...v,campaign_id:e.target.value}))}><option value="">—</option>{campaigns.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label><div className="sales-form-grid"><label className="form-group"><span>{t.amount}</span><input required type="number" min="0" value={spend.amount} onChange={e=>setSpend(v=>({...v,amount:e.target.value}))}/></label><label className="form-group"><span>{t.date}</span><input required type="date" value={spend.spent_on} onChange={e=>setSpend(v=>({...v,spent_on:e.target.value}))}/></label></div><label className="form-group"><span>{t.details}</span><input value={spend.description} onChange={e=>setSpend(v=>({...v,description:e.target.value}))}/></label><button className="btn btn-primary">{t.saveSpend}</button>
        </form>
      </div>
      <section className="card"><div className="card-title">{t.channelPerf}</div>{campaigns.map(row=>{
        const campaignLeads=leadsInPeriod.filter(lead=>lead.marketing_campaign_id===row.id)
        const campaignWon=leads.filter(lead=>lead.marketing_campaign_id===row.id&&lead.stage==='won'&&inPeriod(lead.updated_at||lead.created_at)).length
        const campaignSpend=spendInPeriod.filter(item=>item.campaign_id===row.id).reduce((sum,item)=>sum+Number(item.amount||0),0)
        return <div className="sales-row" key={row.id}><div><strong>{row.name}</strong><small>{channels.find(x=>x.id===row.channel_id)?.name} · {labelType(channels.find(x=>x.id===row.channel_id)?.channel_type)} · {row.status}</small></div><div className="marketing-campaign-kpis"><span><b>{campaignLeads.length}</b>{t.leads}</span><span><b>{campaignWon}</b>{t.won}</span><span><b>{yen(campaignSpend)}</b>{t.spend}</span><span><b>{campaignLeads.length?yen(campaignSpend/campaignLeads.length):'—'}</b>{t.cpl}</span><span><b>{campaignWon?yen(campaignSpend/campaignWon):'—'}</b>{t.cac}</span></div></div>
      })}{campaigns.length===0&&<div className="sales-muted">{t.noData}</div>}</section>
    </>}
  </div>
}
