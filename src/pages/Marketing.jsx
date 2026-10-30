import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useLang } from '../hooks/useLang'
import EmptyHint from '../components/EmptyHint'
import { useAuth } from '../hooks/useAuth'
import { salesGet, salesPost } from '../lib/salesApi'
import { tokyoToday } from '../lib/dates'
import MarketingKpiPanel from '../components/MarketingKpiPanel'

const COPY = {
  en: { title:'Marketing & acquisition', channels:'Channels', campaigns:'Campaigns', spend:'Ad spend', leads:'Leads', won:'Won contracts', cpl:'Cost per lead', cac:'Cost per acquisition', newChannel:'New channel', channelName:'Channel name', type:'Channel type', platform:'Platform', add:'Save channel', newCampaign:'New campaign', campaignName:'Campaign name', objective:'Objective / audience', channel:'Channel', budget:'Budget (¥)', starts:'Start date', ends:'End date', saveCampaign:'Save campaign', recordSpend:'Record ad spend', amount:'Amount (¥)', date:'Date', details:'Note', saveSpend:'Record spend', noData:'No campaigns yet', emptyHow:'1) Create a channel (e.g. Instagram, flyers, referral). 2) Create a campaign in that channel. 3) Record what you spend. When sellers mark a lead with this campaign, leads, contracts and cost per client appear here.', paid:'Paid ads', organic:'Organic social', referral:'Referral', website:'Website', event:'Event', outbound:'Outbound', other:'Other', status:'Status', active:'Active', paused:'Paused', completed:'Completed', channelPerf:'Campaigns', selectCampaign:'Select campaign', periodSpend:'Recorded spend', tips:'Use one channel/campaign on every lead so acquisition cost and conversion can be measured.', period:'Period', today:'Today', month:'This month', year:'This year', all:'All time', goals:'Marketing KPI targets', goalHint:'Set goals and compare them with tracked activity for the selected period.', target:'Target', savedHere:'Targets are saved in this browser.', impressions:'Impressions', clicks:'Clicks', conversions:'Platform conversions', platformHint:'Copy impressions, clicks and conversions from the ad platform report (TikTok, Meta, Google…) to get CPM, CPC and CTR.' },
  ja: { title:'マーケティング・集客', channels:'チャネル', campaigns:'キャンペーン', spend:'広告費', leads:'リード', won:'成約', cpl:'リード単価', cac:'顧客獲得単価', newChannel:'チャネル追加', channelName:'チャネル名', type:'種類', platform:'媒体', add:'保存', newCampaign:'キャンペーン追加', campaignName:'キャンペーン名', objective:'目的・対象', channel:'チャネル', budget:'予算 (¥)', starts:'開始日', ends:'終了日', saveCampaign:'保存', recordSpend:'広告費を記録', amount:'金額 (¥)', date:'日付', details:'メモ', saveSpend:'記録', noData:'キャンペーンはまだありません', emptyHow:'1) チャネルを作成（例：Instagram、チラシ、紹介）。2) そのチャネルでキャンペーンを作成。3) 使った費用を記録。営業がリードにこのキャンペーンを設定すると、リード数・成約・顧客獲得単価がここに表示されます。', paid:'有料広告', organic:'SNS投稿', referral:'紹介', website:'ウェブサイト', event:'イベント', outbound:'営業活動', other:'その他', status:'状態', active:'実施中', paused:'停止', completed:'完了', channelPerf:'キャンペーン', selectCampaign:'キャンペーンを選択', periodSpend:'記録済み費用', tips:'各リードにチャネルとキャンペーンを設定すると、集客単価と成約率を測定できます。', period:'期間', today:'今日', month:'今月', year:'今年', all:'全期間', goals:'マーケティングKPI目標', goalHint:'目標を設定し、選択期間の実績と比較します。', target:'目標', savedHere:'目標はこのブラウザーに保存されます。', impressions:'表示回数', clicks:'クリック数', conversions:'媒体コンバージョン', platformHint:'広告管理画面（TikTok・Meta・Googleなど）の表示回数・クリック・CVを入力するとCPM・CPC・CTRが計算されます。' },
  pt: { title:'Marketing e captação', channels:'Canais', campaigns:'Campanhas', spend:'Gasto com anúncios', leads:'Leads', won:'Contratos fechados', cpl:'Custo por lead', cac:'Custo por aquisição', newChannel:'Novo canal', channelName:'Nome do canal', type:'Tipo de canal', platform:'Plataforma', add:'Salvar canal', newCampaign:'Nova campanha', campaignName:'Nome da campanha', objective:'Objetivo / público', channel:'Canal', budget:'Orçamento (¥)', starts:'Data de início', ends:'Data de término', saveCampaign:'Salvar campanha', recordSpend:'Registrar gasto com anúncios', amount:'Valor (¥)', date:'Data', details:'Observação', saveSpend:'Registrar gasto', noData:'Nenhuma campanha ainda', emptyHow:'1) Crie um canal (ex.: Instagram, panfleto, indicação). 2) Crie uma campanha nesse canal. 3) Registre o que gastou. Quando os vendedores marcarem um lead com essa campanha, aparecem aqui leads, contratos e custo por cliente.', paid:'Anúncios pagos', organic:'Redes sociais (orgânico)', referral:'Indicação', website:'Site', event:'Evento', outbound:'Prospecção ativa', other:'Outro', status:'Status', active:'Ativa', paused:'Pausada', completed:'Concluída', channelPerf:'Campanhas', selectCampaign:'Selecionar campanha', periodSpend:'Gasto registrado', tips:'Defina um canal/campanha em cada lead para medir o custo de captação e a conversão.', period:'Período', today:'Hoje', month:'Este mês', year:'Este ano', all:'Todo o período', goals:'Metas de KPI de marketing', goalHint:'Defina metas e compare com a atividade registrada no período selecionado.', target:'Meta', savedHere:'As metas ficam salvas neste navegador.', impressions:'Impressões', clicks:'Cliques', conversions:'Conversões da plataforma', platformHint:'Copie impressões, cliques e conversões do relatório da plataforma de anúncios (TikTok, Meta, Google…) para calcular CPM, CPC e CTR.' },
}
const yen = n => `¥${Math.round(Number(n || 0)).toLocaleString()}`
import { MEDIA_PLATFORMS, normalizePlatform, platformLabel } from '../lib/salesInsights'
import SalesInbox from '../components/SalesInbox'
const TYPES = ['paid_ads', 'organic_social', 'referral', 'website', 'event', 'outbound', 'other']

export default function Marketing() {
  const { lang, tr } = useLang()
  const { logout } = useAuth()
  const t = COPY[lang === 'ja' ? 'ja' : lang === 'pt' ? 'pt' : 'en']
  const [data, setData] = useState(null)
  const [channel, setChannel] = useState({ name:'', channel_type:'paid_ads', platform:'google_ads' })
  const [campaign, setCampaign] = useState({ channel_id:'', name:'', objective:'', budget:'', starts_on:'', ends_on:'', status:'active' })
  const [spend, setSpend] = useState({ campaign_id:'', amount:'', impressions:'', clicks:'', conversions:'', spent_on:tokyoToday(), description:'' })
  const [error, setError] = useState('')
  const [period, setPeriod] = useState('month')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const result = await salesGet('/api/sales-data', lang)
      setData({ channels:[], campaigns:[], spend:[], ...(result.marketing || {}), marketing: result.marketing || {}, leads: result.leads || [], contracts: result.contracts || [], today: result.today, notifications: result.notifications || [], salespeople: result.salespeople || [] })
      setError('')
    } catch (e) { setError(e.message) }
  }, [lang])
  useEffect(() => { load() }, [load])

  const save = async (body, reset) => {
    try {
      await salesPost('/api/sales-data', body, lang)
      reset()
      await load()
      toast.success(tr('Saved', '保存しました', 'Salvo'))
    } catch (e) { toast.error(e.message) }
  }

  const saveGoal = async (month, goal) => {
    setBusy(true)
    try { await salesPost('/api/sales-data', { action:'save-marketing-goal', period_month:month, goal }, lang); await load(); toast.success(tr('Saved', '保存しました', 'Salvo')) }
    catch (e) { toast.error(e.message) }
    finally { setBusy(false) }
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
  const labelType = type => t[String(type || 'other').split('_')[0]] || t.other
  const periodOptions=[['today',t.today],['month',t.month],['year',t.year],['all',t.all]]

  return <div className="marketing-page">
    <div className="sales-kicker">KURIPURO · GROWTH</div><h1>{t.title}</h1>
    {error && <div className="card sales-setup-note"><p>{error}</p><button type="button" className="btn btn-sm" onClick={logout}>{tr('Sign in again', 'もう一度ログイン', 'Entrar novamente')}</button></div>}
    {data && <>
      <SalesInbox lang={lang} notifications={data.notifications || []} sellers={data.salespeople || []} onChanged={load} canSend />
      <MarketingKpiPanel data={data} lang={lang} today={data.today || today} busy={busy} onSaveGoal={saveGoal} />
      <p className="sales-muted">{t.tips}</p>
      <div className="sales-admin-grid marketing-forms">
        <form className="card" onSubmit={e=>{e.preventDefault();save({action:'save-marketing-channel',...channel},()=>setChannel({name:'',channel_type:'paid_ads',platform:'google_ads'}))}}>
          <div className="card-title">{t.newChannel}</div><label className="form-group"><span>{t.channelName}</span><input required value={channel.name} onChange={e=>setChannel(v=>({...v,name:e.target.value}))}/></label>
          <div className="sales-form-grid"><label className="form-group"><span>{t.type}</span><select value={channel.channel_type} onChange={e=>setChannel(v=>({...v,channel_type:e.target.value}))}>{TYPES.map(x=><option value={x} key={x}>{labelType(x)}</option>)}</select></label><label className="form-group"><span>{t.platform}</span><select value={normalizePlatform(channel.platform) || 'other'} onChange={e=>setChannel(v=>({...v,platform:e.target.value,name:v.name||platformLabel(e.target.value, lang)}))}>{MEDIA_PLATFORMS.map(x=><option value={x} key={x}>{platformLabel(x, lang)}</option>)}</select></label></div><button className="btn btn-primary">{t.add}</button>
        </form>
        <form className="card" onSubmit={e=>{e.preventDefault();save({action:'save-marketing-campaign',...campaign,budget:Number(campaign.budget||0)},()=>setCampaign({channel_id:'',name:'',objective:'',budget:'',starts_on:'',ends_on:'',status:'active'}))}}>
          <div className="card-title">{t.newCampaign}</div><div className="sales-form-grid">
            <label className="form-group"><span>{t.channel}</span><select required value={campaign.channel_id} onChange={e=>setCampaign(v=>({...v,channel_id:e.target.value}))}><option value="">—</option>{channels.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label>
            <label className="form-group"><span>{t.campaignName}</span><input required value={campaign.name} onChange={e=>setCampaign(v=>({...v,name:e.target.value}))}/></label>
            <label className="form-group"><span>{t.budget}</span><input type="number" min="0" value={campaign.budget} onChange={e=>setCampaign(v=>({...v,budget:e.target.value}))}/></label>
            <label className="form-group"><span>{t.status}</span><select value={campaign.status} onChange={e=>setCampaign(v=>({...v,status:e.target.value}))}><option value="active">{t.active}</option><option value="paused">{t.paused}</option><option value="completed">{t.completed}</option></select></label>
          </div><label className="form-group"><span>{t.objective}</span><textarea rows="2" value={campaign.objective} onChange={e=>setCampaign(v=>({...v,objective:e.target.value}))}/></label><div className="sales-form-grid"><label className="form-group"><span>{t.starts}</span><input type="date" value={campaign.starts_on} onChange={e=>setCampaign(v=>({...v,starts_on:e.target.value}))}/></label><label className="form-group"><span>{t.ends}</span><input type="date" value={campaign.ends_on} onChange={e=>setCampaign(v=>({...v,ends_on:e.target.value}))}/></label></div><button className="btn btn-primary">{t.saveCampaign}</button>
        </form>
        <form className="card" onSubmit={e=>{e.preventDefault();save({action:'record-marketing-spend',...spend,amount:Number(spend.amount||0)},()=>setSpend({campaign_id:'',amount:'',impressions:'',clicks:'',conversions:'',spent_on:tokyoToday(),description:''}))}}>
          <div className="card-title">{t.recordSpend}</div><label className="form-group"><span>{t.selectCampaign}</span><select required value={spend.campaign_id} onChange={e=>setSpend(v=>({...v,campaign_id:e.target.value}))}><option value="">—</option>{campaigns.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}</select></label><div className="sales-form-grid"><label className="form-group"><span>{t.amount}</span><input required type="number" min="0" value={spend.amount} onChange={e=>setSpend(v=>({...v,amount:e.target.value}))}/></label><label className="form-group"><span>{t.date}</span><input required type="date" value={spend.spent_on} onChange={e=>setSpend(v=>({...v,spent_on:e.target.value}))}/></label></div><div className="sales-form-grid sales-form-grid-3">{['impressions','clicks','conversions'].map(key=><label className="form-group" key={key}><span>{t[key]}</span><input type="number" min="0" step="1" value={spend[key]} onChange={e=>setSpend(v=>({...v,[key]:e.target.value}))}/></label>)}</div><p className="sales-muted">{t.platformHint}</p><label className="form-group"><span>{t.details}</span><input value={spend.description} onChange={e=>setSpend(v=>({...v,description:e.target.value}))}/></label><button className="btn btn-primary">{t.saveSpend}</button>
        </form>
      </div>
      <section className="card"><div className="sales-section-head"><div className="card-title">{t.channelPerf}</div><label className="sales-period-filter"><span>{t.period}</span><select value={period} onChange={e=>setPeriod(e.target.value)}>{periodOptions.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>{campaigns.map(row=>{
        const campaignLeads=leadsInPeriod.filter(lead=>lead.marketing_campaign_id===row.id)
        const campaignWon=leads.filter(lead=>lead.marketing_campaign_id===row.id&&lead.stage==='won'&&inPeriod(lead.updated_at||lead.created_at)).length
        const campaignSpend=spendInPeriod.filter(item=>item.campaign_id===row.id).reduce((sum,item)=>sum+Number(item.amount||0),0)
        return <div className="sales-row" key={row.id}><div><strong>{row.name}</strong><small>{channels.find(x=>x.id===row.channel_id)?.name} · {labelType(channels.find(x=>x.id===row.channel_id)?.channel_type)} · {row.status}</small></div><div className="marketing-campaign-kpis"><span><b>{campaignLeads.length}</b>{t.leads}</span><span><b>{campaignWon}</b>{t.won}</span><span><b>{yen(campaignSpend)}</b>{t.spend}</span><span><b>{campaignLeads.length?yen(campaignSpend/campaignLeads.length):'—'}</b>{t.cpl}</span><span><b>{campaignWon?yen(campaignSpend/campaignWon):'—'}</b>{t.cac}</span></div></div>
      })}{campaigns.length===0&&<EmptyHint icon="📣" title={t.noData}>{t.emptyHow}</EmptyHint>}</section>
    </>}
  </div>
}
