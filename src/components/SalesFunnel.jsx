import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { salesPost } from '../lib/salesApi'
import { FollowupChip, followupCopy } from './SalesFollowupParts'
import { followupStatus } from '../lib/salesFollowup'
import ClientPage from './ClientPage'
import { PHASES, funnelCopy, initials, phaseOf, shortDay, yen } from '../lib/salesPhases'
import { pickLang } from '../hooks/useLang'
import { openClientSheet } from '../lib/clientSheet'

// Sales funnel board: one column per phase, from first contact to active client.
// Shared by the admin page (/sales-funnel) and the seller portal (Leads tab).
// Clicking a card opens the client page with every step, document and contact.

// Which lead.stage a card gets when dropped on a column. Approved / Contract /
// Active come from the quote and contract themselves, so they are not drop targets
// (except an admin closing a deal by hand).
const DROP_STAGE = { lead: 'approach', contact: 'followup', proposal: 'quote', negotiation: 'negotiation' }

export function buildDeals(data, today) {
  const touch = new Map(), visits = new Map(), quotes = new Map(), contracts = new Map()
  const push = (map, key, row) => { if (!key) return; if (!map.has(key)) map.set(key, []); map.get(key).push(row) }
  for (const row of data?.touchpoints || []) push(touch, row.lead_id, row)
  for (const row of data?.approaches || []) push(visits, row.lead_id, row)
  for (const row of data?.quotes || []) push(quotes, row.lead_id, row)
  for (const row of data?.contracts || []) push(contracts, row.lead_id, row)
  const sellers = new Map((data?.salespeople || []).map(p => [p.id, p.full_name]))
  return (data?.leads || []).map(lead => {
    const q = (quotes.get(lead.id) || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    const subs = (contracts.get(lead.id) || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    const t = touch.get(lead.id) || [], v = (visits.get(lead.id) || []).slice().sort((a, b) => String(b.work_date).localeCompare(String(a.work_date)))
    const accepted = q.find(row => row.status === 'accepted')
    const activeSub = subs.find(r => ['active', 'approved'].includes(r.status))
    const value = Number(activeSub?.client_monthly_total || accepted?.total || q[0]?.total || lead.expected_monthly || 0)
    const last = [lead.last_contact_date, ...t.map(r => r.happened_at), ...v.map(r => r.work_date)].map(x => String(x || '').slice(0, 10)).filter(Boolean).sort().pop() || String(lead.first_contact_date || lead.created_at || '').slice(0, 10)
    return {
      lead, quotes: q, accepted, submissions: subs, value, touchpoints: t, visits: v,
      phase: phaseOf(lead, q, subs, v, t.length),
      contactsCount: t.length + v.length, last,
      seller: sellers.get(lead.salesperson_id) || (lead.salesperson_id && lead.salesperson_id === data?.user?.id ? data.user.name || data.user.full_name : '') || '', info: today ? followupStatus(lead, today, data?.touchpoints || []) : null,
    }
  })
}

// Phones get one phase at a time (tap a phase, read its clients top to bottom, move a card
// with "Move to") instead of a board that scrolls sideways.
function useIsPhone() {
  const query = '(max-width: 700px)'
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return undefined
    const on = () => setPhone(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return Boolean(phone)
}

// Desktop list: phases as groups that open and close (most advanced first), one row per client,
// stage changed from the row's menu instead of dragging across a wide board.
function GroupedList({ deals, phases, t, lang, f, isAdmin, activeId, setActive, canDrop, moveTo, closed, setClosed, onAddLead, onShowAll }) {
  const L = (en, ja, pt) => pickLang(lang, en, ja, pt)
  const order = [...phases.filter(p => p !== 'lost').reverse(), ...phases.filter(p => p === 'lost')]
  const groups = order.map(p => ({ p, rows: deals.filter(d => d.phase === p).sort((a, b) => String(b.last).localeCompare(String(a.last))) })).filter(g => g.rows.length)
  const toggle = p => setClosed(cur => { const next = new Set(cur); next.has(p) ? next.delete(p) : next.add(p); return next })
  const next = d => d.phase === 'approved' ? <span className="fn-badge is-approved">✓ {t.quoteApproved}</span>
    : d.phase === 'contract' ? <span className="fn-badge is-contract">{t.contractStatus[d.submissions[0]?.status] || '—'}</span>
    : d.info && !['active', 'lost'].includes(d.phase) && ['overdue', 'today'].includes(d.info.status) ? <FollowupChip info={d.info} f={f} />
    : d.info?.next ? <span className="fn-muted">{shortDay(d.info.next)}</span> : <span className="fn-muted">—</span>
  if (!groups.length) return <div className="fn-list"><div className="fn-list-empty"><p className="fn-empty">{t.empty}</p>
    {onShowAll && <button type="button" className="fn-col-add is-list" onClick={onShowAll}>{t.showAll}</button>}
    {onAddLead && <button type="button" className="fn-col-add is-list" onClick={onAddLead}>+ {t.addLead}</button>}</div></div>
  return <div className="fn-glist">
    <div className={`fn-grow fn-ghead${isAdmin ? ' has-seller' : ''}`}>
      <span>{L('Client', '顧客', 'Cliente')}</span>
      {isAdmin && <span>{L('Seller', '担当', 'Vendedor')}</span>}
      <span className="is-num">{L('Value', '金額', 'Valor')}</span>
      <span>{L('Next step', '次のアクション', 'Próximo passo')}</span>
      <span>{t.lastContact}</span>
      <span>{L('Stage', '段階', 'Fase')}</span>
    </div>
    {groups.map(({ p, rows }) => {
      const open = !closed.has(p)
      const sum = rows.reduce((s, d) => s + d.value, 0)
      return <section key={p} className={`fn-group is-${p}`}>
        <button type="button" className="fn-group-head" aria-expanded={open} onClick={() => toggle(p)}>
          <span className="fn-caret">{open ? '▾' : '▸'}</span>
          <span className="fn-num">{p === 'lost' ? '×' : PHASES.indexOf(p) + 1}</span>
          <strong>{t.phases[p]}</strong>
          <small>{t.clients(rows.length)}{sum ? ` · ${yen(sum)}` : ''}</small>
        </button>
        {open && rows.map(d => {
          const targets = phases.filter(x => x !== d.phase && canDrop(x))
          const isClient = isAdmin && ['approved', 'contract', 'active'].includes(d.phase)
          return <div key={d.lead.id} role="button" tabIndex={0} className={`fn-grow${isAdmin ? ' has-seller' : ''}${activeId === d.lead.id ? ' is-open' : ''}`}
            onClick={() => setActive(d.lead.id)} onKeyDown={e => { if (e.key === 'Enter') setActive(d.lead.id) }}>
            <span className="fn-gname">
              <span className="fn-avatar" aria-hidden="true">{initials(d.lead.site_name || d.lead.company_name)}</span>
              <span className="fn-card-text"><strong>{d.lead.site_name || d.lead.company_name}</strong><small>{[d.lead.site_name ? d.lead.company_name : null, d.lead.contact_name].filter(Boolean).join(' · ') || '—'}</small></span>
              {isClient && <button type="button" className="fn-sheet" title={L('Client sheet', '顧客カード', 'Ficha do cliente')} onClick={e => { e.stopPropagation(); openClientSheet({ name: d.lead.company_name }) }}>📇</button>}
            </span>
            {isAdmin && <span className="fn-cell">{d.seller || '—'}</span>}
            <span className="fn-cell is-num">{d.value ? <b>{yen(d.value)}</b> : '—'}</span>
            <span className="fn-cell">{next(d)}</span>
            <span className="fn-cell">{shortDay(d.last)}</span>
            <span className="fn-cell" onClick={e => e.stopPropagation()}>
              {targets.length ? <select className="fn-stage" value="" aria-label={t.moveTo} onChange={e => moveTo(d, e.target.value)}>
                <option value="">{t.phases[d.phase]}</option>
                {targets.map(x => <option key={x} value={x}>→ {t.phases[x]}</option>)}
              </select> : <span className={`fn-badge is-${d.phase}`}>{t.phases[d.phase]}</span>}
            </span>
          </div>
        })}
      </section>
    })}
    {onAddLead && <button type="button" className="fn-col-add is-list" onClick={onAddLead}>+ {t.addLead}</button>}
  </div>
}

export default function SalesFunnel({ data, lang, today, isAdmin = false, onChanged, onAddLead, onEditLead, onLogVisit, openLeadId, onOpenLead }) {
  const t = funnelCopy(lang)
  const f = followupCopy(lang)
  const [search, setSearch] = useState('')
  const [seller, setSeller] = useState('')
  const [showLost, setShowLost] = useState(false)
  const [view, setViewState] = useState(() => { const auto = window.matchMedia?.('(max-width: 700px)').matches ? 'board' : 'list'; try { return localStorage.getItem('kp_funnel_view') || auto } catch { return auto } })
  const setView = v => { setViewState(v); try { localStorage.setItem('kp_funnel_view', v) } catch { /* private mode */ } }
  const [closed, setClosed] = useState(() => new Set())
  const [openId, setOpenId] = useState('')
  const [dragId, setDragId] = useState('')
  const [dropPhase, setDropPhase] = useState('')
  const [focus, setFocus] = useState('')
  const [listPhase, setListPhase] = useState('')
  const phone = useIsPhone()
  const deals = useMemo(() => buildDeals(data, today), [data, today])
  const activeId = openLeadId ?? openId
  const setActive = id => (onOpenLead ? onOpenLead(id) : setOpenId(id))

  const q = search.trim().toLowerCase()
  const visible = deals.filter(d => (!seller || d.lead.salesperson_id === seller) && (!q || [d.lead.company_name, d.lead.site_name, d.lead.contact_name, d.lead.address, d.seller].some(v => String(v || '').toLowerCase().includes(q))))
  const phases = PHASES.filter(p => p !== 'lost' || showLost)
  const byPhase = Object.fromEntries(PHASES.map(p => [p, visible.filter(d => d.phase === p).sort((a, b) => String(b.last).localeCompare(String(a.last)))]))
  const total = visible.filter(d => d.phase !== 'lost').length || 1
  const open = deals.find(d => d.lead.id === activeId)
  // List: every client (or only the stage picked above), newest contact first.
  const listRows = visible.filter(d => (showLost || d.phase !== 'lost') && (!listPhase || d.phase === listPhase))
  // Phone: the phase on screen (the first one with clients until the seller picks one).
  const focused = phases.includes(focus) ? focus : (phases.find(p => byPhase[p].length) || 'lead')

  const canDrop = phase => Boolean(DROP_STAGE[phase]) || (isAdmin && (phase === 'approved' || phase === 'lost'))
  const moveTo = async (deal, phase) => {
    if (!deal || deal.phase === phase || !canDrop(phase)) return
    const stage = DROP_STAGE[phase] || (phase === 'approved' ? 'won' : 'lost')
    try {
      await salesPost('/api/sales-data', { action: 'save-lead', id: deal.lead.id, lead: { stage, company_name: deal.lead.company_name } }, lang)
      toast.success(t.moved(t.phases[phase]))
      await onChanged?.()
    } catch (e) { toast.error(e.message) }
  }
  const sellers = (data?.salespeople || []).filter(p => p.is_active !== false)

  return <div className="fn-root">
    <div className="fn-toolbar">
      <input className="fn-search" type="search" placeholder={t.search} value={search} onChange={e => setSearch(e.target.value)} />
      {isAdmin && sellers.length > 0 && <select className="fn-select" value={seller} onChange={e => setSeller(e.target.value)}><option value="">{t.allSellers}</option>{sellers.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>}
      <div className="fn-seg" role="tablist">{['board', 'list'].map(v => <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'is-active' : ''} onClick={() => setView(v)}>{t[v]}</button>)}</div>
      <label className="fn-check"><input type="checkbox" checked={showLost} onChange={e => setShowLost(e.target.checked)} />{t.showLost}</label>
    </div>

    <div className="fn-kpis is-fit" style={{ '--fn-n': phases.length }}>
      {phases.map((p, i) => <button type="button" key={p} aria-pressed={view === 'list' ? listPhase === p : phone && focused === p} className={`fn-kpi is-${p}${(view === 'list' ? listPhase === p : phone && focused === p) ? ' is-focus' : ''}`} onClick={() => { if (view === 'list') return setListPhase(cur => cur === p ? '' : p); setFocus(p); if (!phone) setTimeout(() => document.getElementById(`fn-col-${p}`)?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' }), 30) }}>
        <span className="fn-num">{p === 'lost' ? '×' : i + 1}</span>
        <span className="fn-kpi-text"><strong>{t.phases[p]}</strong><small>{t.clients(byPhase[p].length)}</small></span>
        <span className="fn-kpi-foot"><b>{yen(byPhase[p].reduce((s, d) => s + d.value, 0))}</b><em>{p === 'lost' ? '' : `${Math.round(byPhase[p].length / total * 100)}%`}</em></span>
      </button>)}
    </div>

    {view === 'board' ? <>
      <div className={`fn-board${phone ? ' is-phone' : ''}`}>
        {(phone ? [focused] : phases).map(p => ({ p, i: phases.indexOf(p) })).map(({ p, i }) => <section key={p} id={`fn-col-${p}`} className={`fn-col is-${p}${dropPhase === p ? ' is-drop' : ''}${dragId && !canDrop(p) ? ' is-locked' : ''}`}
          onDragOver={e => { if (dragId && canDrop(p)) { e.preventDefault(); setDropPhase(p) } }} onDragLeave={() => setDropPhase('')}
          onDrop={e => { e.preventDefault(); setDropPhase(''); moveTo(deals.find(d => d.lead.id === dragId), p); setDragId('') }}>
          <header className="fn-col-head"><span className="fn-num">{p === 'lost' ? '×' : i + 1}</span><strong>{t.phases[p]}</strong><b>{byPhase[p].length}</b></header>
          <div className="fn-col-body">
            {byPhase[p].map(d => <div key={d.lead.id} className="fn-card-wrap"><button type="button" className={`fn-card${activeId === d.lead.id ? ' is-open' : ''}`} draggable onDragStart={() => setDragId(d.lead.id)} onDragEnd={() => { setDragId(''); setDropPhase('') }} onClick={() => setActive(d.lead.id)}>
              <span className="fn-card-top"><span className="fn-avatar" aria-hidden="true">{initials(d.lead.site_name || d.lead.company_name)}</span><span className="fn-card-text"><strong>{d.lead.site_name || d.lead.company_name}</strong><small>{[d.lead.region, isAdmin ? d.seller : d.lead.contact_name].filter(Boolean).join(' · ')}</small></span></span>
              <span className="fn-card-foot"><span>{t.contacts(d.contactsCount)}</span>{d.value > 0 && <b>{yen(d.value)}</b>}<span>{shortDay(d.last)}</span></span>
              {d.phase === 'approved' ? <span className="fn-badge is-approved">✓ {t.quoteApproved}</span> : d.phase === 'contract' ? <span className="fn-badge is-contract">{t.contractStatus[d.submissions[0]?.status] || ''}</span> : d.info && !['active', 'lost'].includes(d.phase) && ['overdue', 'today'].includes(d.info.status) && <FollowupChip info={d.info} f={f} />}
            </button>
              {phone && phases.some(x => x !== d.phase && canDrop(x)) && <div className="fn-move">
                <select aria-label={t.moveTo} value="" onChange={e => moveTo(d, e.target.value)}>
                  <option value="">{t.moveTo} ›</option>
                  {phases.filter(x => x !== d.phase && canDrop(x)).map(x => <option key={x} value={x}>{t.phases[x]}</option>)}
                </select>
              </div>}
            </div>)}
            {byPhase[p].length === 0 && <p className="fn-empty">{t.empty}</p>}
          </div>
          {p === 'lead' && onAddLead && <button type="button" className="fn-col-add" onClick={onAddLead}>+ {t.addLead}</button>}
        </section>)}
      </div>
      <p className="fn-hint">{phone ? t.moveHint : t.dragHint}</p>
    </> : !phone ? <GroupedList deals={listRows} phases={phases} t={t} lang={lang} f={f} isAdmin={isAdmin} activeId={activeId} setActive={setActive}
      canDrop={canDrop} moveTo={moveTo} closed={closed} setClosed={setClosed} onAddLead={onAddLead} onShowAll={listPhase ? () => setListPhase('') : null} /> : <div className="fn-list">
      {listRows.length === 0 && <div className="fn-list-empty">
        <p className="fn-empty">{listPhase ? `${t.phases[listPhase]} · ${t.empty}` : t.empty}</p>
        {listPhase && <button type="button" className="fn-col-add is-list" onClick={() => setListPhase('')}>{t.showAll}</button>}
        {onAddLead && <button type="button" className="fn-col-add is-list" onClick={onAddLead}>+ {t.addLead}</button>}
      </div>}
      {listRows.sort((a, b) => String(b.last).localeCompare(String(a.last))).map(d => <button type="button" key={d.lead.id} className="fn-list-row" onClick={() => setActive(d.lead.id)}>
        <span className="fn-avatar" aria-hidden="true">{initials(d.lead.site_name || d.lead.company_name)}</span>
        <span className="fn-card-text"><strong>{d.lead.site_name || d.lead.company_name}</strong><small>{[d.seller || d.lead.contact_name, `${t.lastContact} ${shortDay(d.last)}`].filter(Boolean).join(' · ')}</small></span>
        <span className={`fn-badge is-${d.phase}`}>{t.phases[d.phase]}</span>
        <b className="fn-list-value">{d.value ? yen(d.value) : '—'}</b>
      </button>)}
    </div>}

    {open && !onOpenLead && <ClientPage deal={open} lang={lang} today={today} isAdmin={isAdmin} data={data} onClose={() => setActive('')} onChanged={onChanged} onEdit={onEditLead} onLogVisit={onLogVisit} />}
  </div>
}
