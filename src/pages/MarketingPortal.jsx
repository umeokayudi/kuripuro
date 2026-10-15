import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../hooks/useAuth'
import { useLang } from '../hooks/useLang'
import { salesGet, salesPost } from '../lib/salesApi'
import { tokyoToday } from '../lib/dates'
import { MEDIA_PLATFORMS, normalizePlatform, platformLabel } from '../lib/salesInsights'
import FieldAppShell, { Sheet } from '../components/FieldAppShell'
import MarketingKpiPanel from '../components/MarketingKpiPanel'
import SalesInbox from '../components/SalesInbox'

// Marketing login (salespeople.team = 'marketing'): same frame as the seller
// portal. Home answers "how much did we spend, how many leads did it bring, what
// did each one cost"; the + button records ad spend.

const COPY = {
  en: {
    kicker: 'KURIPURO · MARKETING', home: 'Home', campaigns: 'Campaigns', kpi: 'KPIs', more: 'More', logout: 'Log out', loading: 'Loading…',
    month: 'This month', spend: 'Ad spend', leads: 'Leads', cpl: 'Cost per lead', won: 'Won', cac: 'Cost per client', budgets: 'Budget used', noBudget: 'No active campaign with a budget.',
    byChannel: 'Leads by channel · this month', noSource: n => `${n} lead${n === 1 ? '' : 's'} this month without a channel. Ask sellers to pick the source on each lead.`, none: 'No source',
    recordSpend: 'Record ad spend', campaign: 'Campaign', amount: 'Amount (¥)', date: 'Date', impressions: 'Impressions', clicks: 'Clicks', conversions: 'Platform conversions', note: 'Note', save: 'Save',
    platformHint: 'Copy impressions, clicks and conversions from the ad platform report to get CPM, CPC and CTR.',
    newCampaign: 'New campaign', campaignName: 'Campaign name', channel: 'Channel', budget: 'Budget (¥)', status: 'Status', objective: 'Objective / audience', starts: 'Start', ends: 'End',
    active: 'Active', paused: 'Paused', completed: 'Completed', newChannel: 'New channel', channels: 'Channels', channelName: 'Channel name', type: 'Type', platform: 'Platform',
    types: { paid_ads: 'Paid ads', organic_social: 'Organic social', referral: 'Referral', website: 'Website', event: 'Event', outbound: 'Outbound', other: 'Other' },
    noCampaigns: 'No campaigns yet.', leadsList: 'Leads by source', search: 'Search', menuHint: { channels: 'Where leads come from', leads: 'Every lead and its source' },
    saved: 'Saved', needSql: 'Ask the admin to run the 2026-10-15 SQL so marketing can save.', notifications: 'Notifications', stages: { approach: 'Approach', followup: 'Follow-up', quote: 'Quote', negotiation: 'Negotiation', won: 'Won', lost: 'Lost' },
  },
  ja: {
    kicker: 'KURIPURO · マーケティング', home: 'ホーム', campaigns: 'キャンペーン', kpi: 'KPI', more: 'その他', logout: 'ログアウト', loading: '読み込み中…',
    month: '今月', spend: '広告費', leads: 'リード', cpl: 'リード単価', won: '成約', cac: '顧客獲得単価', budgets: '予算消化', noBudget: '予算のある実施中キャンペーンはありません。',
    byChannel: 'チャネル別リード・今月', noSource: n => `今月のリード${n}件に流入元がありません。営業に流入元の選択を依頼してください。`, none: '流入元なし',
    recordSpend: '広告費を記録', campaign: 'キャンペーン', amount: '金額 (¥)', date: '日付', impressions: '表示回数', clicks: 'クリック数', conversions: '媒体コンバージョン', note: 'メモ', save: '保存',
    platformHint: '広告管理画面の表示回数・クリック・CVを入力するとCPM・CPC・CTRが計算されます。',
    newCampaign: 'キャンペーン追加', campaignName: 'キャンペーン名', channel: 'チャネル', budget: '予算 (¥)', status: '状態', objective: '目的・対象', starts: '開始', ends: '終了',
    active: '実施中', paused: '停止', completed: '完了', newChannel: 'チャネル追加', channels: 'チャネル', channelName: 'チャネル名', type: '種類', platform: '媒体',
    types: { paid_ads: '有料広告', organic_social: 'SNS投稿', referral: '紹介', website: 'ウェブサイト', event: 'イベント', outbound: '営業活動', other: 'その他' },
    noCampaigns: 'キャンペーンはありません。', leadsList: '流入元別リード', search: '検索', menuHint: { channels: 'リードの流入元', leads: '全リードと流入元' },
    saved: '保存しました', needSql: 'マーケティングで保存するには、管理者が2026-10-15のSQLを実行する必要があります。', notifications: 'お知らせ', stages: { approach: 'アプローチ', followup: 'フォロー中', quote: '見積', negotiation: '交渉中', won: '成約', lost: '失注' },
  },
}
const TYPES = ['paid_ads', 'organic_social', 'referral', 'website', 'event', 'outbound', 'other']
const yen = n => `¥${Math.round(Number(n || 0)).toLocaleString()}`
const blankSpend = () => ({ campaign_id: '', amount: '', impressions: '', clicks: '', conversions: '', spent_on: tokyoToday(), description: '' })
const blankCampaign = () => ({ channel_id: '', name: '', objective: '', budget: '', starts_on: '', ends_on: '', status: 'active' })

export default function MarketingPortal() {
  const { user, logout } = useAuth()
  const { lang } = useLang()
  const t = COPY[lang === 'ja' ? 'ja' : 'en']
  const [tab, setTab] = useState('home')
  const [sheet, setSheet] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [spend, setSpend] = useState(blankSpend)
  const [campaign, setCampaign] = useState(blankCampaign)
  const [channel, setChannel] = useState({ name: '', channel_type: 'paid_ads', platform: 'google_ads' })
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    try {
      const result = await salesGet('/api/sales-data', lang)
      setData({ channels: [], campaigns: [], spend: [], ...(result.marketing || {}), marketing: result.marketing || {}, leads: result.leads || [], contracts: result.contracts || [], today: result.today, notifications: result.notifications || [], salespeople: result.salespeople || [] })
    } catch (e) { toast.error(e.message) }
    finally { setLoading(false) }
  }, [lang])
  useEffect(() => { load() }, [load])

  const save = async (body, done) => {
    setBusy(true)
    try { await salesPost('/api/sales-data', body, lang); done?.(); await load(); toast.success(t.saved) }
    catch (e) { toast.error(/403|Somente/.test(e.message) ? t.needSql : e.message) }
    finally { setBusy(false) }
  }

  const today = data?.today || tokyoToday()
  const thisMonth = today.slice(0, 7)
  const channels = data?.channels || []
  const campaigns = data?.campaigns || []
  const leads = data?.leads || []
  const spendRows = data?.spend || []
  const sellerName = id => data?.salespeople?.find(p => p.id === id)?.full_name || ''
  const channelName = id => channels.find(c => c.id === id)?.name || t.none

  const month = useMemo(() => {
    const monthSpend = spendRows.filter(r => String(r.spent_on || '').startsWith(thisMonth)).reduce((s, r) => s + Number(r.amount || 0), 0)
    const monthLeads = leads.filter(r => String(r.first_contact_date || r.created_at || '').startsWith(thisMonth))
    const monthWon = leads.filter(r => r.stage === 'won' && String(r.closed_at || r.updated_at || '').startsWith(thisMonth)).length
    const byChannel = new Map()
    for (const lead of monthLeads) byChannel.set(lead.marketing_channel_id || '', (byChannel.get(lead.marketing_channel_id || '') || 0) + 1)
    const rows = [...byChannel.entries()].map(([id, n]) => ({ id, name: id ? channelName(id) : t.none, n })).sort((a, b) => b.n - a.n)
    return { spend: monthSpend, leads: monthLeads.length, won: monthWon, rows, max: Math.max(1, ...rows.map(r => r.n)), noSource: byChannel.get('') || 0 }
  }, [spendRows, leads, thisMonth, channels]) // eslint-disable-line react-hooks/exhaustive-deps

  const budgets = campaigns.filter(c => c.status === 'active' && Number(c.budget) > 0)
  const q = search.trim().toLowerCase()
  const listedLeads = leads.filter(r => !q || [r.company_name, r.site_name, channelName(r.marketing_channel_id), r.region].some(v => String(v || '').toLowerCase().includes(q)))

  const tabs = [
    { key: 'home', label: t.home, icon: '⌂' },
    { key: 'campaigns', label: t.campaigns, icon: '◎' },
    { key: 'kpi', label: t.kpi, icon: '📈' },
    { key: 'more', label: t.more, icon: '☰' },
  ]
  const menuItems = [
    { key: 'channels', icon: '📡', label: t.channels, hint: t.menuHint.channels },
    { key: 'leads', icon: '👥', label: t.leadsList, hint: t.menuHint.leads },
  ]

  const CampaignRow = ({ row }) => {
    const ch = channels.find(c => c.id === row.channel_id)
    return <div className="mk-campaign">
      <div className="mk-campaign-head"><div><strong>{row.name}</strong><small>{[ch?.name, ch && t.types[ch.channel_type]].filter(Boolean).join(' · ')}</small></div><span className={`fa-pill is-${row.status === 'active' ? 'active' : row.status}`}>{t[row.status] || row.status}</span></div>
      <div className="mk-kpis">
        <span><b>{yen(row.spend)}</b>{t.spend}</span>
        <span><b>{row.leads}</b>{t.leads}</span>
        <span><b>{row.leads ? yen(row.cost_per_lead) : '—'}</b>{t.cpl}</span>
        <span><b>{row.conversions ? yen(row.customer_acquisition_cost) : '—'}</b>{t.cac}</span>
      </div>
      {Number(row.budget) > 0 && <div className={`mk-track${row.spend > row.budget ? ' is-over' : ''}`}><i style={{ width: `${Math.min(100, row.spend / row.budget * 100)}%` }} /></div>}
    </div>
  }

  return (
    <FieldAppShell kicker={t.kicker} userName={user.name} lang={lang} bellCount={data?.notifications?.length || 0} onBell={() => setSheet('bell')}
      menuItems={menuItems} onLogout={logout} logoutLabel={t.logout} tabs={tabs} tab={tab} onTab={key => { setTab(key); window.scrollTo(0, 0) }}
      onPlus={() => { setSpend(blankSpend()); setSheet('spend') }} plusLabel={t.recordSpend}>
      {loading && !data ? <div className="fa-card fa-muted">{t.loading}</div> : !data ? null : <>
        {tab === 'home' && <div className="fa-stack">
          <button type="button" className="sp-cta is-main" onClick={() => { setSpend(blankSpend()); setSheet('spend') }}>
            <span className="sp-cta-icon" aria-hidden="true">¥</span><span><strong>{t.recordSpend}</strong><small>{yen(month.spend)} · {t.month}</small></span>
          </button>
          <div className="fa-section-title">{t.month}</div>
          <div className="fa-tiles">
            <div className="fa-tile is-blue"><strong>{yen(month.spend)}</strong><span>{t.spend}</span></div>
            <div className="fa-tile is-purple"><strong>{month.leads}</strong><span>{t.leads}</span><small>{t.cpl}: {month.leads ? yen(month.spend / month.leads) : '—'}</small></div>
            <div className="fa-tile is-green"><strong>{month.won}</strong><span>{t.won}</span></div>
            <div className="fa-tile is-amber"><strong>{month.won ? yen(month.spend / month.won) : '—'}</strong><span>{t.cac}</span></div>
          </div>
          <section className="fa-card">
            <div className="fa-card-head"><h2>{t.byChannel}</h2></div>
            {month.rows.map(r => <div className="mk-bar" key={r.id || 'none'}><div className="mk-bar-top"><strong>{r.name}</strong><span>{r.n}</span></div><div className="mk-track"><i style={{ width: `${r.n / month.max * 100}%`, background: r.id ? undefined : '#a0aabb' }} /></div></div>)}
            {month.rows.length === 0 && <p className="fa-muted">—</p>}
            {month.noSource > 0 && <p className="sp-hint">{t.noSource(month.noSource)}</p>}
          </section>
          <section className="fa-card">
            <div className="fa-card-head"><h2>{t.budgets}</h2></div>
            {budgets.map(r => <div className="mk-bar" key={r.id}><div className="mk-bar-top"><strong>{r.name}</strong><span>{yen(r.spend)} / {yen(r.budget)}</span></div><div className={`mk-track${r.spend > r.budget ? ' is-over' : ''}`}><i style={{ width: `${Math.min(100, r.spend / r.budget * 100)}%` }} /></div></div>)}
            {budgets.length === 0 && <p className="fa-muted">{t.noBudget}</p>}
          </section>
        </div>}

        {tab === 'campaigns' && <div className="fa-stack">
          <div className="fa-screen-head"><h2>{t.campaigns}</h2><button type="button" className="fa-btn fa-btn-primary fa-btn-sm" onClick={() => { setCampaign(blankCampaign()); setSheet('campaign') }}>+ {t.newCampaign}</button></div>
          <section className="fa-card is-list">{campaigns.map(row => <CampaignRow key={row.id} row={row} />)}{campaigns.length === 0 && <p className="fa-muted">{t.noCampaigns}</p>}</section>
        </div>}

        {tab === 'channels' && <div className="fa-stack">
          <div className="fa-screen-head"><h2>{t.channels}</h2><button type="button" className="fa-btn fa-btn-primary fa-btn-sm" onClick={() => setSheet('channel')}>+ {t.newChannel}</button></div>
          <section className="fa-card is-list">{channels.map(ch => { const n = leads.filter(l => l.marketing_channel_id === ch.id).length; return <div className="sp-history-row" key={ch.id}><div><strong>{ch.name}</strong><small>{[t.types[ch.channel_type], platformLabel(normalizePlatform(ch.platform), lang)].filter(Boolean).join(' · ')}</small></div><span className="fa-pill">{n} {t.leads}</span></div> })}</section>
        </div>}

        {tab === 'leads' && <div className="fa-stack">
          <div className="fa-screen-head"><h2>{t.leadsList}</h2></div>
          <input className="fa-search" type="search" placeholder={t.search} value={search} onChange={e => setSearch(e.target.value)} />
          <section className="fa-card is-list">{listedLeads.slice(0, 300).map(r => <div className="sp-lead-row" key={r.id}><span className={`sp-stage-dot is-${r.stage}`} aria-hidden="true" /><div className="sp-lead-text" style={{ flex: 1 }}><strong>{r.site_name || r.company_name}</strong><small>{[channelName(r.marketing_channel_id), t.stages[r.stage] || r.stage, sellerName(r.salesperson_id), r.first_contact_date].filter(Boolean).join(' · ')}</small></div></div>)}</section>
        </div>}

        {tab === 'kpi' && <div className="fa-stack sp-wide"><MarketingKpiPanel data={data} lang={lang} today={today} busy={busy} onSaveGoal={(m, goal) => save({ action: 'save-marketing-goal', period_month: m, goal })} /></div>}
      </>}

      {sheet === 'spend' && <Sheet title={t.recordSpend} onClose={() => !busy && setSheet('')}>
        <form className="sp-form" onSubmit={e => { e.preventDefault(); save({ action: 'record-marketing-spend', ...spend, amount: Number(spend.amount || 0) }, () => { setSpend(blankSpend()); setSheet('') }) }}>
          <label className="form-group"><span>{t.campaign} *</span><select required value={spend.campaign_id} onChange={e => setSpend(v => ({ ...v, campaign_id: e.target.value }))}><option value="">—</option>{campaigns.filter(c => c.status !== 'completed').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <div className="sp-two"><label className="form-group"><span>{t.amount} *</span><input required type="number" min="0" inputMode="numeric" value={spend.amount} onChange={e => setSpend(v => ({ ...v, amount: e.target.value }))} /></label><label className="form-group"><span>{t.date}</span><input required type="date" value={spend.spent_on} onChange={e => setSpend(v => ({ ...v, spent_on: e.target.value }))} /></label></div>
          <details className="sp-details"><summary>{t.impressions} · {t.clicks} · {t.conversions}</summary>
            {['impressions', 'clicks', 'conversions'].map(key => <label className="form-group" key={key}><span>{t[key]}</span><input type="number" min="0" inputMode="numeric" value={spend[key]} onChange={e => setSpend(v => ({ ...v, [key]: e.target.value }))} /></label>)}
            <p className="sp-hint">{t.platformHint}</p>
          </details>
          <label className="form-group"><span>{t.note}</span><input value={spend.description} onChange={e => setSpend(v => ({ ...v, description: e.target.value }))} /></label>
          <button className="fa-btn fa-btn-primary fa-btn-block fa-btn-lg" disabled={busy}>{t.save}</button>
        </form>
      </Sheet>}

      {sheet === 'campaign' && <Sheet title={t.newCampaign} onClose={() => !busy && setSheet('')}>
        <form className="sp-form" onSubmit={e => { e.preventDefault(); save({ action: 'save-marketing-campaign', ...campaign, budget: Number(campaign.budget || 0) }, () => setSheet('')) }}>
          <label className="form-group"><span>{t.campaignName} *</span><input required value={campaign.name} onChange={e => setCampaign(v => ({ ...v, name: e.target.value }))} /></label>
          <div className="sp-two"><label className="form-group"><span>{t.channel} *</span><select required value={campaign.channel_id} onChange={e => setCampaign(v => ({ ...v, channel_id: e.target.value }))}><option value="">—</option>{channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="form-group"><span>{t.budget}</span><input type="number" min="0" inputMode="numeric" value={campaign.budget} onChange={e => setCampaign(v => ({ ...v, budget: e.target.value }))} /></label></div>
          <div className="sp-two"><label className="form-group"><span>{t.starts}</span><input type="date" value={campaign.starts_on} onChange={e => setCampaign(v => ({ ...v, starts_on: e.target.value }))} /></label><label className="form-group"><span>{t.ends}</span><input type="date" value={campaign.ends_on} onChange={e => setCampaign(v => ({ ...v, ends_on: e.target.value }))} /></label></div>
          <label className="form-group"><span>{t.objective}</span><textarea rows="2" value={campaign.objective} onChange={e => setCampaign(v => ({ ...v, objective: e.target.value }))} /></label>
          <div className="form-group"><span>{t.status}</span><div className="sp-chip-row">{['active', 'paused', 'completed'].map(s => <button type="button" key={s} className={`fa-chip${campaign.status === s ? ' is-active' : ''}`} onClick={() => setCampaign(v => ({ ...v, status: s }))}>{t[s]}</button>)}</div></div>
          <button className="fa-btn fa-btn-primary fa-btn-block fa-btn-lg" disabled={busy}>{t.save}</button>
        </form>
      </Sheet>}

      {sheet === 'channel' && <Sheet title={t.newChannel} onClose={() => !busy && setSheet('')}>
        <form className="sp-form" onSubmit={e => { e.preventDefault(); save({ action: 'save-marketing-channel', ...channel }, () => { setChannel({ name: '', channel_type: 'paid_ads', platform: 'google_ads' }); setSheet('') }) }}>
          <label className="form-group"><span>{t.platform}</span><select value={normalizePlatform(channel.platform) || 'other'} onChange={e => setChannel(v => ({ ...v, platform: e.target.value, name: v.name || platformLabel(e.target.value, lang) }))}>{MEDIA_PLATFORMS.map(x => <option value={x} key={x}>{platformLabel(x, lang)}</option>)}</select></label>
          <label className="form-group"><span>{t.channelName} *</span><input required value={channel.name} onChange={e => setChannel(v => ({ ...v, name: e.target.value }))} /></label>
          <label className="form-group"><span>{t.type}</span><select value={channel.channel_type} onChange={e => setChannel(v => ({ ...v, channel_type: e.target.value }))}>{TYPES.map(x => <option value={x} key={x}>{t.types[x]}</option>)}</select></label>
          <button className="fa-btn fa-btn-primary fa-btn-block fa-btn-lg" disabled={busy}>{t.save}</button>
        </form>
      </Sheet>}

      {sheet === 'bell' && <Sheet title={t.notifications} onClose={() => setSheet('')}>
        <SalesInbox lang={lang} notifications={data?.notifications || []} onChanged={load} />
      </Sheet>}
    </FieldAppShell>
  )
}
