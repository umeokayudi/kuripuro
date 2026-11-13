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
import TeamChannel from '../components/TeamChannel'
import { pickLang } from '../hooks/useLang'
import BrandLoader from '../components/BrandLoader'
import { budgetPacing } from '../lib/salesKpi'
import '../cor-marketing.css'
import { tabFromUrl } from '../lib/push'

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
  pt: {
    kicker: 'KURIPURO · MARKETING', home: 'Início', campaigns: 'Campanhas', kpi: 'KPIs', more: 'Mais', logout: 'Sair', loading: 'Carregando…',
    month: 'Este mês', spend: 'Gasto com anúncios', leads: 'Leads', cpl: 'Custo por lead', won: 'Fechados', cac: 'Custo por cliente', budgets: 'Orçamento usado', noBudget: 'Nenhuma campanha ativa com orçamento.',
    byChannel: 'Leads por canal · este mês', noSource: n => `${n} lead${n === 1 ? '' : 's'} deste mês sem canal. Peça aos vendedores para escolher a origem de cada lead.`, none: 'Sem origem',
    recordSpend: 'Registrar gasto com anúncio', campaign: 'Campanha', amount: 'Valor (¥)', date: 'Data', impressions: 'Impressões', clicks: 'Cliques', conversions: 'Conversões da plataforma', note: 'Observação', save: 'Salvar',
    platformHint: 'Copie impressões, cliques e conversões do relatório da plataforma de anúncios para ver CPM, CPC e CTR.',
    newCampaign: 'Nova campanha', campaignName: 'Nome da campanha', channel: 'Canal', budget: 'Orçamento (¥)', status: 'Status', objective: 'Objetivo / público', starts: 'Início', ends: 'Fim',
    active: 'Ativa', paused: 'Pausada', completed: 'Concluída', newChannel: 'Novo canal', channels: 'Canais de mídia', channelName: 'Nome do canal', type: 'Tipo', platform: 'Plataforma',
    types: { paid_ads: 'Anúncio pago', organic_social: 'Rede social orgânica', referral: 'Indicação', website: 'Site', event: 'Evento', outbound: 'Prospecção ativa', other: 'Outro' },
    noCampaigns: 'Nenhuma campanha ainda.', leadsList: 'Leads por origem', search: 'Buscar', menuHint: { channels: 'De onde os leads vêm', leads: 'Todos os leads e a origem de cada um' },
    saved: 'Salvo', needSql: 'Peça ao admin para rodar o SQL de 2026-10-15 para o marketing poder salvar.', notifications: 'Notificações', stages: { approach: 'Abordagem', followup: 'Follow-up', quote: 'Orçamento', negotiation: 'Negociação', won: 'Fechado', lost: 'Perdido' },
  },
}
const TYPES = ['paid_ads', 'organic_social', 'referral', 'website', 'event', 'outbound', 'other']
const yen = n => `¥${Math.round(Number(n || 0)).toLocaleString()}`
const blankSpend = () => ({ campaign_id: '', amount: '', impressions: '', clicks: '', conversions: '', spent_on: tokyoToday(), description: '' })
const blankCampaign = () => ({ channel_id: '', name: '', objective: '', budget: '', starts_on: '', ends_on: '', status: 'active' })

// v1.0.255 · module tiles: same colour per module as the admin sidebar (--mod-* in cor.css)
const GLYPHS = {
  campaigns: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" /></>,
  kpi: <path d="M5 20V11M11 20V5M17 20v-6M3 20h18" />,
  channels: <><path d="M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4" /><circle cx="12" cy="12" r="1.6" /></>,
  leads: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 4.6a3.2 3.2 0 0 1 0 6.3M18 14.4c1.8.8 3 2.7 3 5.6" /></>,
  team: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z" />,
  yen: <path d="M6 4l6 8 6-8M12 12v8M7.5 13h9M7.5 16.5h9" />,
  won: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
}
function MkGlyph({ name }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{GLYPHS[name]}</svg>
}
function MkIcon({ name, mod, small = false }) {
  return <span className={`mk-tile${small ? ' is-small' : ''}`} style={{ '--tile': `var(--mod-${mod})` }} aria-hidden="true"><MkGlyph name={name} /></span>
}

export default function MarketingPortal() {
  const { user, logout } = useAuth()
  const { lang } = useLang()
  const t = COPY[lang] || COPY.en
  const [tab, setTab] = useState(() => tabFromUrl(['team']) || 'home')
  const [sheet, setSheet] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [spend, setSpend] = useState(blankSpend)
  const [campaign, setCampaign] = useState(blankCampaign)
  const [channel, setChannel] = useState({ name: '', channel_type: 'paid_ads', platform: 'google_ads' })
  const [search, setSearch] = useState('')
  const [onlyNoSource, setOnlyNoSource] = useState(false)

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

  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const budgets = campaigns.filter(c => c.status === 'active' && Number(c.budget) > 0)
  const q = search.trim().toLowerCase()
  const listedLeads = leads.filter(r => (!onlyNoSource || !r.marketing_channel_id) && (!q || [r.company_name, r.site_name, channelName(r.marketing_channel_id), r.region].some(v => String(v || '').toLowerCase().includes(q))))
  const noSourceAll = leads.filter(r => !r.marketing_channel_id).length
  const go = key => { setTab(key); window.scrollTo(0, 0) }

  // v1.0.255 · "Pra hoje": only signals the portal already computes from real data
  // (unread notifications, this month's leads without a channel, budget over / ahead of time).
  // Nothing new is invented: when none of them fires, the list says the day is clear.
  const today4 = useMemo(() => {
    const items = []
    const unread = data?.notifications?.length || 0
    if (unread) items.push({ id: 'bell', tone: 'amber', icon: 'bell', title: L(`${unread} unread notification${unread === 1 ? '' : 's'}`, `未読のお知らせ ${unread}件`, `${unread} aviso${unread === 1 ? '' : 's'} sem ler`), sub: data.notifications[0]?.title || '', status: L('To read', '未読', 'Ler'), onClick: () => setSheet('bell') })
    for (const row of budgetPacing(data, today).filter(r => r.status === 'active')) {
      if (row.used > row.budget) items.push({ id: `over-${row.id}`, tone: 'red', icon: 'yen', title: L(`${row.name} is over budget`, `${row.name} 予算超過`, `${row.name} passou do orçamento`), sub: `${yen(row.used)} / ${yen(row.budget)}`, status: L('Over', '超過', 'Estourou'), onClick: () => go('campaigns') })
      else if (row.overPace) items.push({ id: `pace-${row.id}`, tone: 'amber', icon: 'yen', title: L(`${row.name}: spending ahead of time`, `${row.name}：予定より早く消化中`, `${row.name}: gastando antes do previsto`), sub: L(`${row.usedRate}% of budget · ${row.elapsed}% of period`, `予算${row.usedRate}% · 期間${row.elapsed}%`, `${row.usedRate}% do orçamento · ${row.elapsed}% do período`), status: L('Check', '確認', 'Conferir'), onClick: () => go('campaigns') })
    }
    if (month.noSource) items.push({ id: 'nosource', tone: 'amber', icon: 'leads', title: L(`${month.noSource} lead${month.noSource === 1 ? '' : 's'} this month without a channel`, `今月の流入元なしリード ${month.noSource}件`, `${month.noSource} lead${month.noSource === 1 ? '' : 's'} do mês sem canal`), sub: L('Ask sellers to pick the source on each lead.', '営業に流入元の選択を依頼してください。', 'Peça aos vendedores para escolher a origem.'), status: L('Pending', '未設定', 'Pendente'), onClick: () => { setOnlyNoSource(true); go('leads') } })
    return items
  }, [data, today, month]) // eslint-disable-line react-hooks/exhaustive-deps

  const tabs = [
    { key: 'home', label: t.home, icon: 'home' },
    { key: 'campaigns', label: t.campaigns, icon: 'campaigns' },
    { key: 'kpi', label: t.kpi, icon: 'kpi' },
    { key: 'more', label: t.more, icon: 'more' },
  ]
  const MOD = { campaigns: 'marketing', channels: 'marketing', leads: 'sales-funnel', team: 'team-channel', kpi: 'reports', spend: 'cashflow' }
  const menuItems = [
    { key: 'channels', icon: <MkIcon name="channels" mod={MOD.channels} />, label: t.channels, hint: t.menuHint.channels },
    { key: 'leads', icon: <MkIcon name="leads" mod={MOD.leads} />, label: t.leadsList, hint: t.menuHint.leads },
    // v1.0.221 · team channels (Geral + Marketing, or what the admin added)
    { key: 'team', icon: <MkIcon name="team" mod={MOD.team} />, label: L('Team channels', 'チームチャンネル', 'Canais da Equipe'), hint: L('Talk with your area and the office', 'エリアと事務所との会話', 'Conversa com a sua área e o escritório') },
  ]
  const statusTone = { active: 'green', paused: 'amber', completed: 'gray' }

  const CampaignRow = ({ row }) => {
    const ch = channels.find(c => c.id === row.channel_id)
    const over = Number(row.budget) > 0 && row.spend > row.budget
    return <div className="mk-campaign">
      <div className="mk-campaign-head">
        <MkIcon name="campaigns" mod={MOD.campaigns} />
        <div className="mk-campaign-name"><strong>{row.name}</strong><small>{[ch?.name, ch && t.types[ch.channel_type], [row.starts_on, row.ends_on].filter(Boolean).join(' → ')].filter(Boolean).join(' · ')}</small></div>
        <span className={`mk-chip is-${statusTone[row.status] || 'gray'}`}>{t[row.status] || row.status}</span>
      </div>
      <div className="mk-kpis">
        <span><b>{yen(row.spend)}</b>{t.spend}</span>
        <span><b>{row.leads}</b>{t.leads}</span>
        <span><b>{row.leads ? yen(row.cost_per_lead) : '—'}</b>{t.cpl}</span>
        <span><b>{row.conversions ? yen(row.customer_acquisition_cost) : '—'}</b>{t.cac}</span>
      </div>
      {Number(row.budget) > 0 && <div className="mk-budget"><div className="mk-bar-top"><small>{t.budgets}</small><small className={over ? 'is-red' : ''}>{yen(row.spend)} / {yen(row.budget)}</small></div><div className={`mk-track${over ? ' is-over' : ''}`}><i style={{ width: `${Math.min(100, row.spend / row.budget * 100)}%` }} /></div></div>}
    </div>
  }

  const shortcuts = [
    { key: 'campaigns', name: 'campaigns', label: t.campaigns, sub: L(`${campaigns.filter(c => c.status === 'active').length} active`, `実施中 ${campaigns.filter(c => c.status === 'active').length}`, `${campaigns.filter(c => c.status === 'active').length} ativa${campaigns.filter(c => c.status === 'active').length === 1 ? '' : 's'}`) },
    { key: 'kpi', name: 'kpi', label: t.kpi, sub: L('Cost, leads, return', '費用・リード・ROI', 'Custo, leads, retorno') },
    { key: 'channels', name: 'channels', label: t.channels, sub: L(`${channels.length} channel${channels.length === 1 ? '' : 's'}`, `${channels.length}チャネル`, `${channels.length} cana${channels.length === 1 ? 'l' : 'is'}`) },
    { key: 'leads', name: 'leads', label: t.leadsList, sub: L(`${leads.length} lead${leads.length === 1 ? '' : 's'}`, `${leads.length}件`, `${leads.length} lead${leads.length === 1 ? '' : 's'}`) },
    { key: 'team', name: 'team', label: L('Marketing channel', 'マーケティングチャンネル', 'Canal Marketing'), sub: L('Team channels', 'チームチャンネル', 'Canais da Equipe') },
  ]

  return (
    <FieldAppShell kicker={t.kicker} userName={user.name} lang={lang} bellCount={data?.notifications?.length || 0} onBell={() => setSheet('bell')}
      menuItems={menuItems} onLogout={logout} logoutLabel={t.logout} tabs={tabs} tab={tab} onTab={key => { if (key !== 'leads') setOnlyNoSource(false); go(key) }}
      onPlus={() => { setSpend(blankSpend()); setSheet('spend') }} plusLabel={t.recordSpend}>
      {tab === 'team' && <div className="fa-stack mk-root"><TeamChannel me={{ role: 'salesperson', id: user.id, name: user.name }} lang={lang} L={L} focus="marketing" /></div>}
      {tab !== 'team' && (loading && !data ? <div className="mk-root"><BrandLoader /></div> : !data ? null : <>
        {tab === 'home' && <div className="mk-root mk-home">
          <section className="mk-card mk-today">
            <div className="mk-card-head"><h2>{L('For today', '今日やること', 'Pra hoje')}</h2>{today4.length > 0 && <span className="mk-count">{today4.length}</span>}</div>
            {today4.length === 0 ? <div className="mk-clear"><span className="mk-dot is-green" aria-hidden="true">✓</span><div><strong>{L('All clear', 'すべて完了', 'Tudo em dia')}</strong><small>{L('No pending item in marketing right now.', '現在マーケティングの未処理はありません。', 'Nenhuma pendência do marketing agora.')}</small></div></div>
              : <div className="mk-list">{today4.map(it => <button type="button" key={it.id} className={`mk-row is-${it.tone}`} onClick={it.onClick}>
                <span className={`mk-row-icon is-${it.tone}`} aria-hidden="true"><MkGlyph name={it.icon} /></span>
                <span className="mk-row-text"><strong>{it.title}</strong>{it.sub && <small>{it.sub}</small>}</span>
                <span className={`mk-chip is-${it.tone}`}>{it.status}</span>
              </button>)}</div>}
          </section>

          <button type="button" className="mk-cta" onClick={() => { setSpend(blankSpend()); setSheet('spend') }}>
            <span className="mk-cta-icon" aria-hidden="true">¥</span><span><strong>{t.recordSpend}</strong><small>{yen(month.spend)} · {t.month}</small></span><span className="mk-cta-go" aria-hidden="true">›</span>
          </button>

          <section className="mk-month">
            <div className="mk-section-title">{t.month}</div>
            <div className="mk-stats">
              <div className="mk-stat"><MkIcon name="yen" mod={MOD.spend} /><strong>{yen(month.spend)}</strong><span>{t.spend}</span></div>
              <div className="mk-stat"><MkIcon name="leads" mod={MOD.leads} /><strong>{month.leads}</strong><span>{t.leads}</span><small>{t.cpl}: {month.leads && month.spend ? yen(month.spend / month.leads) : '—'}</small></div>
              <div className="mk-stat"><MkIcon name="won" mod="employees" /><strong>{month.won}</strong><span>{t.won}</span></div>
              <div className="mk-stat"><MkIcon name="kpi" mod={MOD.kpi} /><strong>{month.won && month.spend ? yen(month.spend / month.won) : '—'}</strong><span>{t.cac}</span></div>
            </div>
          </section>

          <section className="mk-card">
            <div className="mk-card-head"><h2>{t.byChannel}</h2></div>
            {month.rows.map(r => <div className="mk-bar" key={r.id || 'none'}><div className="mk-bar-top"><strong>{r.name}</strong><span>{r.n}</span></div><div className={`mk-track${r.id ? '' : ' is-none'}`}><i style={{ width: `${r.n / month.max * 100}%` }} /></div></div>)}
            {month.rows.length === 0 && <p className="mk-muted">{L('No lead this month yet.', '今月のリードはまだありません。', 'Nenhum lead neste mês ainda.')}</p>}
          </section>

          <section className="mk-card">
            <div className="mk-card-head"><h2>{t.budgets}</h2></div>
            {budgets.map(r => <div className="mk-bar" key={r.id}><div className="mk-bar-top"><strong>{r.name}</strong><span className={r.spend > r.budget ? 'is-red' : ''}>{yen(r.spend)} / {yen(r.budget)}</span></div><div className={`mk-track${r.spend > r.budget ? ' is-over' : ''}`}><i style={{ width: `${Math.min(100, r.spend / r.budget * 100)}%` }} /></div></div>)}
            {budgets.length === 0 && <p className="mk-muted">{t.noBudget}</p>}
          </section>

          <section className="mk-card mk-shortcuts-card">
            <div className="mk-card-head"><h2>{L('Marketing area', 'マーケティング', 'Área do Marketing')}</h2></div>
            <div className="mk-shortcuts">{shortcuts.map(s => <button type="button" key={s.key} className="mk-shortcut" onClick={() => go(s.key)}><MkIcon name={s.name} mod={MOD[s.key]} /><span><strong>{s.label}</strong><small>{s.sub}</small></span><span className="mk-chev" aria-hidden="true">›</span></button>)}</div>
          </section>
        </div>}

        {tab === 'campaigns' && <div className="mk-root mk-screen">
          <div className="mk-screen-head"><MkIcon name="campaigns" mod={MOD.campaigns} /><h2>{t.campaigns}</h2><button type="button" className="mk-btn" onClick={() => { setCampaign(blankCampaign()); setSheet('campaign') }}>+ {t.newCampaign}</button></div>
          <section className="mk-card mk-list-card">{campaigns.map(row => <CampaignRow key={row.id} row={row} />)}{campaigns.length === 0 && <p className="mk-muted">{t.noCampaigns}</p>}</section>
        </div>}

        {tab === 'channels' && <div className="mk-root mk-screen">
          <div className="mk-screen-head"><MkIcon name="channels" mod={MOD.channels} /><h2>{t.channels}</h2><button type="button" className="mk-btn" onClick={() => setSheet('channel')}>+ {t.newChannel}</button></div>
          <section className="mk-card mk-list-card">{channels.map(ch => { const n = leads.filter(l => l.marketing_channel_id === ch.id).length; return <div className="mk-line" key={ch.id}><MkIcon name="channels" mod={MOD.channels} small /><div className="mk-line-text"><strong>{ch.name}</strong><small>{[t.types[ch.channel_type], platformLabel(normalizePlatform(ch.platform), lang)].filter(Boolean).join(' · ')}</small></div><span className="mk-chip is-blue">{n} {t.leads}</span></div> })}
            {channels.length === 0 && <p className="mk-muted">{L('No channel yet. Create one to start measuring.', 'チャネルはまだありません。作成すると計測が始まります。', 'Nenhum canal ainda. Crie um para começar a medir.')}</p>}</section>
        </div>}

        {tab === 'leads' && <div className="mk-root mk-screen">
          <div className="mk-screen-head"><MkIcon name="leads" mod={MOD.leads} /><h2>{t.leadsList}</h2></div>
          <div className="mk-filters">
            <input className="mk-search" type="search" placeholder={t.search} value={search} onChange={e => setSearch(e.target.value)} />
            <div className="mk-pills"><button type="button" className={!onlyNoSource ? 'is-active' : ''} onClick={() => setOnlyNoSource(false)}>{L('All', 'すべて', 'Todos')} <span>{leads.length}</span></button><button type="button" className={onlyNoSource ? 'is-active' : ''} onClick={() => setOnlyNoSource(true)}>{t.none} <span>{noSourceAll}</span></button></div>
          </div>
          <section className="mk-card mk-list-card">{listedLeads.slice(0, 300).map(r => <div className="mk-line" key={r.id}><span className={`sp-stage-dot is-${r.stage}`} aria-hidden="true" /><div className="mk-line-text"><strong>{r.site_name || r.company_name}</strong><small>{[r.site_name ? r.company_name : '', sellerName(r.salesperson_id), r.first_contact_date].filter(Boolean).join(' · ')}</small></div><span className="mk-line-tags"><span className={`mk-chip is-${r.marketing_channel_id ? 'blue' : 'amber'}`}>{channelName(r.marketing_channel_id)}</span><span className={`mk-chip is-${r.stage === 'won' ? 'green' : r.stage === 'lost' ? 'red' : 'gray'}`}>{t.stages[r.stage] || r.stage}</span></span></div>)}
            {listedLeads.length === 0 && <p className="mk-muted">{L('No lead found.', 'リードはありません。', 'Nenhum lead encontrado.')}</p>}</section>
        </div>}

        {tab === 'kpi' && <div className="mk-root mk-screen mk-kpi"><MarketingKpiPanel data={data} lang={lang} today={today} busy={busy} onSaveGoal={(m, goal) => save({ action: 'save-marketing-goal', period_month: m, goal })} /></div>}
      </>)}

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
