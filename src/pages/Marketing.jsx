import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import { salesGet, salesPost } from '../lib/salesApi'
import { tokyoToday } from '../lib/dates'

const COPY = {
  en: { title:'Marketing & acquisition', channels:'Channels', campaigns:'Campaigns', spend:'Ad spend', leads:'Leads', won:'Won contracts', cpl:'Cost per lead', cac:'Cost per acquisition', newChannel:'New channel', channelName:'Channel name', type:'Channel type', platform:'Platform', add:'Save channel', newCampaign:'New campaign', campaignName:'Campaign name', objective:'Objective / audience', channel:'Channel', budget:'Budget (¥)', starts:'Start date', ends:'End date', saveCampaign:'Save campaign', recordSpend:'Record ad spend', amount:'Amount (¥)', date:'Date', details:'Note', saveSpend:'Record spend', noData:'No activity yet.', paid:'Paid ads', organic:'Organic social', referral:'Referral', website:'Website', event:'Event', outbound:'Outbound', other:'Other', status:'Status', active:'Active', paused:'Paused', completed:'Completed', channelPerf:'Channel performance', selectCampaign:'Select campaign', periodSpend:'Recorded spend', tips:'Use one channel/campaign on every lead so acquisition cost and conversion can be measured.' },
  ja: { title:'マーケティング・集客', channels:'チャネル', campaigns:'キャンペーン', spend:'広告費', leads:'リード', won:'成約', cpl:'リード単価', cac:'顧客獲得単価', newChannel:'チャネル追加', channelName:'チャネル名', type:'種類', platform:'媒体', add:'保存', newCampaign:'キャンペーン追加', campaignName:'キャンペーン名', objective:'目的・対象', channel:'チャネル', budget:'予算 (¥)', starts:'開始日', ends:'終了日', saveCampaign:'保存', recordSpend:'広告費を記録', amount:'金額 (¥)', date:'日付', details:'メモ', saveSpend:'記録', noData:'活動はありません。', paid:'有料広告', organic:'SNS投稿', referral:'紹介', website:'ウェブサイト', event:'イベント', outbound:'営業活動', other:'その他', status:'状態', active:'実施中', paused:'停止', completed:'完了', channelPerf:'チャネル実績', selectCampaign:'キャンペーンを選択', periodSpend:'記録済み費用', tips:'各リードにチャネルとキャンペーンを設定すると、集客単価と成約率を測定できます。' },
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
  const totalSpend = spendRows.reduce((sum,row)=>sum+Number(row.amount||0),0)
  const totalLeads = campaigns.reduce((sum,row)=>sum+Number(row.leads||0),0)
  const totalWon = campaigns.reduce((sum,row)=>sum+Number(row.conversions||0),0)
  const totalBudget = campaigns.reduce((sum,row)=>sum+Number(row.budget||0),0)
  const labelType = type => t[String(type || 'other').split('_')[0]] || t.other

  return <div className="marketing-page">
    <div className="sales-kicker">KURIPURO · GROWTH</div><h1>{t.title}</h1>
    {error && <div className="card sales-setup-note">{error}<p>Configure the commercial server session and apply the sales migration before using marketing tools.</p></div>}
    {data && <>
      <div className="sales-metrics">
        {[[t.spend,yen(totalSpend)],[t.leads,totalLeads],[t.won,totalWon],[t.cpl,totalLeads?yen(totalSpend/totalLeads):'—'],[t.cac,totalWon?yen(totalSpend/totalWon):'—'],[t.budget||'Budget',yen(totalBudget)]].map(([label,value])=><div className="sales-metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
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
      <section className="card"><div className="card-title">{t.channelPerf}</div>{campaigns.map(row=><div className="sales-row" key={row.id}><div><strong>{row.name}</strong><small>{channels.find(x=>x.id===row.channel_id)?.name} · {labelType(channels.find(x=>x.id===row.channel_id)?.channel_type)} · {row.status}</small></div><div className="marketing-campaign-kpis"><span><b>{row.leads}</b>{t.leads}</span><span><b>{row.conversions}</b>{t.won}</span><span><b>{yen(row.spend)}</b>{t.spend}</span><span><b>{yen(row.cost_per_lead)}</b>{t.cpl}</span><span><b>{row.conversions?yen(row.customer_acquisition_cost):'—'}</b>{t.cac}</span></div></div>)}{campaigns.length===0&&<div className="sales-muted">{t.noData}</div>}</section>
    </>}
  </div>
}
