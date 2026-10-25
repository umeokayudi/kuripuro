import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useLang, fill, pickLang } from '../hooks/useLang'
import {
  AREA_KINDS, ELEMENT_KINDS, areaForElement, careForElement, elementHistory, levelCount, levelLayout, levelOf,
  serviceOffers, statusMap, todoElementIds, withServiceLog,
} from '../lib/facilityModel'
import { listAllModels, listRecommendations, listServiceLog, logElementService, offerService } from '../lib/facilityApi'
import { loadStoreTimeline, placePhotosOf, sizeLabel } from '../lib/cleaningTimeline'
import { openClientSheet } from '../lib/clientSheet'
import { viewablePhotoUrl } from '../lib/photoUrl'
import { offerWhen } from '../components/facility/FacilityOffersBell'
import { WorldView } from '../components/facility/FacilityViewer'
import ItemSheet from '../components/facility/ItemSheet'
import WhereIs, { WherePlaceForm } from '../components/facility/WhereIs'
import { saveWherePlace } from '../lib/wherePlace'
import FacilityItemPopup from '../components/facility/FacilityItemPopup'
import CleaningTimeline from '../components/CleaningTimeline'
import { rowsForElement } from '../components/facility/CareList'
import '../components/facility/facility.css'
import '../components/facility/world.css'

// three.js só é baixado quando a tela abre
const CityWorld = lazy(() => import('../components/facility/CityWorld'))
const CityMap = lazy(() => import('../components/facility/CityMap'))

const tokyoToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
const storeBase = name => String(name || '').split(/\s+[-—–]\s+/)[0].trim().toLowerCase()
const RANK = { overdue: 0, due: 1, none: 2, ok: 3 }
const WEEK = 7

function useBoxSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [ref])
  return size
}

const openMenu = () => window.dispatchEvent(new Event('kp:open-menu'))

/**
 * Mundo Kuripuro (admin, /facility): tela cheia com cara de jogo, sem cabeçalho.
 * Cidade com todas as lojas → toca num prédio → entra na loja (Mapa | Itens | Histórico) → toca num item → fotos reais.
 * Missões (atrasado / esta semana) ficam do lado, com Ir, Oferecer e Feito. A edição da planta continua em /facility/edit.
 */
export default function Facility() {
  const { t: tr, lang } = useLang()
  const t = tr.facility
  const w = t.world || {}
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const rootRef = useRef(null)
  const { h: rootH, w: rootW } = useBoxSize(rootRef)
  const mobile = rootW > 0 && rootW < 760

  const [models, setModels] = useState([])
  const [logs, setLogs] = useState([])
  const [recs, setRecs] = useState([])
  const [clients, setClients] = useState(new Map())
  const [jobs, setJobs] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [focus, setFocus] = useState(null)
  const [query, setQuery] = useState('')
  const [listMode, setListMode] = useState(false)
  const [missionsOpen, setMissionsOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 760)
  const [missionTab, setMissionTab] = useState('late')
  const [busy, setBusy] = useState('')
  const [popup, setPopup] = useState(null)

  const storeId = params.get('model') || null
  const mapView = !storeId && params.get('view') === 'map'
  const [pendingSel, setPendingSel] = useState(null)

  const load = useCallback(async () => {
    const [ms, ls, rs, { data: cl }, { data: js }] = await Promise.all([
      listAllModels(),
      listServiceLog({ limit: 3000 }),
      listRecommendations({}).catch(() => []),
      supabase.from('clients').select('id,company_name'),
      supabase.from('jobs').select('id,title,scheduled_date,status,employee_name,client_id')
        .gte('scheduled_date', tokyoToday()).order('scheduled_date').limit(600),
    ])
    setModels(ms)
    setLogs(ls)
    setRecs(rs || [])
    setClients(new Map((cl || []).map(c => [c.id, c.company_name])))
    setJobs((js || []).filter(j => !['cancelled', 'completed'].includes(j.status)))
    setLoaded(true)
  }, [])
  useEffect(() => { load().catch(() => setLoaded(true)) }, [load])

  // ---- missões (todas as lojas aprovadas) ----
  const offeredKeys = useMemo(() => new Set(recs.filter(r => r.status === 'pending').map(r => `${r.model_id}:${r.element_id}:${String(r.service || '').toLowerCase()}`)), [recs])
  const missions = useMemo(() => serviceOffers(models, logs, { horizon: WEEK }).map(r => ({
    ...r,
    client_name: clients.get(r.client_id) || '',
    offered: offeredKeys.has(`${r.model_id}:${r.element_id}:${r.task_name.toLowerCase()}`),
  })), [models, logs, clients, offeredKeys])
  const late = missions.filter(m => m.status === 'overdue')
  const soon = missions.filter(m => m.status !== 'overdue')
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const done30 = logs.filter(l => String(l.service_date || '') >= since30).length

  // ---- lojas para a cidade ----
  const stores = useMemo(() => models.map(m => {
    const own = logs.filter(l => l.model_id === m.id)
    const full = withServiceLog(m.layout, own)
    const elStatus = statusMap(full)
    const lateN = late.filter(x => x.model_id === m.id).length
    const soonN = soon.filter(x => x.model_id === m.id).length
    const worst = [...elStatus.values()].sort((a, b) => RANK[a] - RANK[b])[0]
    return {
      id: m.id,
      model: m,
      client_name: clients.get(m.client_id) || '',
      name: clients.get(m.client_id) || m.name || m.location_name || '—',
      sub: m.location_name && m.location_name !== clients.get(m.client_id) ? m.location_name : '',
      layout: levelLayout(full, 0),
      full,
      levels: levelCount(full),
      elStatus,
      status: lateN ? 'overdue' : soonN ? 'due' : worst === 'ok' ? 'ok' : worst || 'none',
      late: lateN,
      soon: soonN,
      draft: m.status !== 'approved',
    }
  }).sort((a, b) => a.name.localeCompare(b.name)), [models, logs, clients, late, soon])

  const store = stores.find(s => s.id === storeId) || null
  // links antigos (Clientes → 🏢 3D): ?client= abre a loja desse cliente ou o editor para criar a primeira
  const wantClient = params.get('client')
  useEffect(() => {
    if (!loaded || !wantClient) return
    const own = stores.find(s => s.model.client_id === wantClient)
    if (own) setParams({ model: own.id }, { replace: true })
    else navigate(`/facility/edit?client=${wantClient}`, { replace: true })
  }, [loaded, wantClient]) // eslint-disable-line react-hooks/exhaustive-deps
  const enterStore = (id, sel = null) => {
    setPendingSel(sel)
    setParams(mapView ? { model: id, from: 'map' } : { model: id })
  }
  const leaveStore = () => {
    if (params.get('from') === 'map') { setParams({ view: 'map' }); return }
    setParams({})
    setFocus(store ? { id: store.id, enter: false, t: Date.now() } : null)
  }

  const offer = async (r) => {
    setBusy(r.key)
    try {
      await offerService({
        model: { id: r.model_id, client_id: r.client_id, location_name: r.location },
        element: { id: r.element_id, name: r.element_name },
        task: { name: r.task_name },
        reason: offerWhen(r, t),
        priority: r.status === 'overdue' ? 'high' : 'medium',
      })
      toast.success(t.offered)
      const rs = await listRecommendations({}).catch(() => null)
      if (rs) setRecs(rs)
    } catch (e) {
      toast.error(e.message)
    }
    setBusy('')
  }

  const onLogService = async (model, el, { notes, files, service, date }) => {
    try {
      await logElementService({ model, element: el, job: null, employee: { id: null, name: user?.name || 'Admin' }, notes, files, service, date })
      toast.success(`✅ ${el.name}${service ? ` · ${service}` : ''}`)
      setPopup(null)
      const [ls, rs] = await Promise.all([listServiceLog({ limit: 3000 }), listRecommendations({}).catch(() => null)])
      setLogs(ls)
      if (rs) setRecs(rs)
    } catch (e) {
      toast.error(e.message)
      throw e
    }
  }

  const onSaveWhere = async (model, data) => {
    try {
      const saved = await saveWherePlace({ model, lang, ...data })
      setModels(ms => ms.map(m => (m.id === saved.id ? saved : m)))
      toast.success(`✅ ${t.whereIs?.saved || 'Saved'}`)
    } catch (e) {
      toast.error(e.message)
      throw e
    }
  }

  const q = query.trim().toLowerCase()
  const found = q ? stores.filter(s => `${s.name} ${s.sub}`.toLowerCase().includes(q)).slice(0, 6) : []
  const shownMissions = missionTab === 'late' ? late : soon
  const popupStore = popup ? stores.find(s => s.id === popup.modelId) : null

  return (
    <div className="kw-root" ref={rootRef}>
      {store ? (
        <StoreView
          key={store.id}
          store={store}
          t={t}
          w={w}
          lang={lang}
          logs={logs.filter(l => l.model_id === store.id)}
          recs={recs.filter(r => r.model_id === store.id)}
          missions={missions.filter(m => m.model_id === store.id)}
          nextJob={jobs.find(j => j.client_id === store.model.client_id && (!store.model.location_name || storeBase(j.title).startsWith(storeBase(store.model.location_name)) || storeBase(j.title).startsWith(storeBase(store.name))))}
          height={rootH}
          mobile={mobile}
          initialSel={pendingSel}
          busy={busy}
          onBack={leaveStore}
          onOffer={offer}
          onDone={(el) => setPopup({ modelId: store.id, type: 'element', id: el.id, log: true })}
          onDetails={(item) => setPopup({ modelId: store.id, ...item })}
          onEdit={() => navigate(`/facility/edit?model=${store.id}`)}
          onQuote={() => navigate('/mitsumori')}
          onSaveWhere={data => onSaveWhere(store.model, data)}
        />
      ) : (
        <>
          {mapView && loaded && (
            <Suspense fallback={<div className="kw-loading">{w.loading}</div>}>
              <CityMap stores={stores} m={w.cityMap || {}} lang={lang} query={query} mobile={mobile} onOpenStore={id => enterStore(id)} />
            </Suspense>
          )}
          {listMode || mapView || !loaded ? null : (
            <Suspense fallback={<div className="kw-loading">{w.loading}</div>}>
              <CityWorld
                stores={stores}
                height={rootH || 600}
                focusId={focus}
                onPick={id => enterStore(id)}
                onFail={() => setListMode(true)}
                labels={{ draft: w.draft }}
                rightInset={!mobile && missionsOpen ? 360 : 0}
              />
            </Suspense>
          )}
          {!loaded && <div className="kw-loading">{w.loading}</div>}
          {listMode && !mapView && loaded && (
            <div className="kw-list">
              {stores.map(s => (
                <button key={s.id} type="button" className={`kw-list-card st-${s.draft ? 'draft' : s.status}`} onClick={() => enterStore(s.id)}>
                  <strong>{s.name}</strong>
                  {s.sub && <span>{s.sub}</span>}
                  <span className="kw-list-meta">
                    {s.draft ? w.draft : s.late ? fill(w.lateN, { n: s.late }) : s.soon ? fill(w.weekN, { n: s.soon }) : w.allOk}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* HUD: canto de cima à esquerda */}
          <div className="kw-hud kw-hud-tl">
            {mobile && <button type="button" className="kw-icon-btn" onClick={openMenu} aria-label={w.menu}>☰</button>}
            <div className="kw-brand">
              <span className="kw-brand-logo" aria-hidden="true">🌏</span>
              <span><strong>{w.brand}</strong><small>{fill(w.stores, { n: stores.length })}</small></span>
            </div>
            <div className="kw-search">
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder={mapView ? w.cityMap?.search : w.search} aria-label={w.search} />
              {found.length > 0 && !mapView && (
                <div className="kw-search-results">
                  {found.map(s => (
                    <button key={s.id} type="button" onClick={() => { setQuery(''); if (listMode) enterStore(s.id); else setFocus({ id: s.id, enter: true, t: Date.now() }) }}>
                      <i className={`kw-dot st-${s.draft ? 'draft' : s.status}`} />{s.name}{s.sub ? <small> · {s.sub}</small> : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className={`kw-pill kw-mapbtn${mapView ? ' on' : ''}`} onClick={() => setParams(mapView ? {} : { view: 'map' })}>
              {mapView ? `🌏 ${w.cityMap?.world3d}` : `🗺️ ${w.cityMap?.open}`}
            </button>
          </div>

          {/* HUD: placar */}
          <div className="kw-hud kw-hud-tr">
            <button type="button" className="kw-stat late" onClick={() => { setMissionTab('late'); setMissionsOpen(true) }}><b>{late.length}</b><span>{w.late}</span></button>
            <button type="button" className="kw-stat soon" onClick={() => { setMissionTab('soon'); setMissionsOpen(true) }}><b>{soon.length}</b><span>{w.week}</span></button>
            <div className="kw-stat ok"><b>{done30}</b><span>{w.done30}</span></div>
          </div>

          {/* Missões */}
          {!mapView && <aside className={`kw-missions${missionsOpen ? ' open' : ''}${mobile ? ' sheet' : ''}`}>
            <button type="button" className="kw-missions-head" onClick={() => setMissionsOpen(v => !v)} aria-expanded={missionsOpen}>
              <span>🎯 {w.missions}</span>
              <b className={late.length ? 'late' : ''}>{missions.length}</b>
              <i aria-hidden="true">{missionsOpen ? '▾' : '▴'}</i>
            </button>
            {missionsOpen && (
              <>
                <div className="kw-seg">
                  <button type="button" className={missionTab === 'late' ? 'on' : ''} onClick={() => setMissionTab('late')}>🔴 {w.late} · {late.length}</button>
                  <button type="button" className={missionTab === 'soon' ? 'on' : ''} onClick={() => setMissionTab('soon')}>🟡 {w.week} · {soon.length}</button>
                </div>
                <div className="kw-mission-list">
                  {shownMissions.length === 0 && <div className="kw-empty">{w.missionsEmpty}</div>}
                  {shownMissions.map(r => {
                    const k = ELEMENT_KINDS[r.element_kind] || ELEMENT_KINDS.other
                    return (
                      <article key={r.key} className={`kw-mission st-${r.status}`}>
                        <div className="kw-mission-top">
                          <span className="kw-mission-icon" aria-hidden="true">{k.icon}</span>
                          <div>
                            <strong>{r.task_name}</strong>
                            <span>{r.client_name || r.location} · {r.element_name}</span>
                            <em>🕒 {offerWhen(r, t)}</em>
                          </div>
                        </div>
                        <div className="kw-mission-actions">
                          <button type="button" onClick={() => enterStore(r.model_id, r.element_id)}>▶ {w.go}</button>
                          <button type="button" disabled={r.offered || busy === r.key} onClick={() => offer(r)}>{r.offered ? `✓ ${w.offered}` : busy === r.key ? '…' : `📨 ${w.offer}`}</button>
                          <button type="button" className="primary" onClick={() => setPopup({ modelId: r.model_id, type: 'element', id: r.element_id, log: true })}>✅ {w.done}</button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </>
            )}
          </aside>}

          {!mapView && <div className="kw-hud kw-hud-bl">
            <button type="button" className="kw-pill" onClick={() => navigate('/facility/edit')}>＋ {w.newStore}</button>
            <button type="button" className="kw-pill ghost" onClick={() => setListMode(v => !v)}>{listMode ? `🌏 ${w.openWorld}` : `☰ ${w.openList}`}</button>
          </div>}
          {loaded && !listMode && !mapView && stores.length > 0 && !mobile && <div className="kw-help">{w.help}</div>}
          {loaded && !mapView && stores.length === 0 && <div className="kw-empty-world">{w.empty}</div>}
        </>
      )}

      {popup && popupStore && (
        <FacilityItemPopup
          layout={popupStore.full}
          item={popup}
          t={t}
          lang={lang}
          recs={recs.filter(r => r.model_id === popupStore.id)}
          logs={logs.filter(l => l.model_id === popupStore.id)}
          todo={todoElementIds(recs.filter(r => r.model_id === popupStore.id))}
          onLogService={(el, data) => onLogService(popupStore.model, el, data)}
          onClose={() => setPopup(null)}
          onSelectItem={item => setPopup({ modelId: popupStore.id, ...item })}
        />
      )}
    </div>
  )
}

/** Dentro de uma loja: Mapa (3D) | Itens (inventário) | Histórico (fotos reais), painel do item tocado. */
function StoreView({ store, t, w, lang, logs, recs, missions, nextJob, height, mobile, initialSel, busy, onBack, onOffer, onDone, onDetails, onEdit, onQuote, onSaveWhere }) {
  const [tab, setTab] = useState('map')
  const [mode, setMode] = useState('3d')
  const [level, setLevel] = useState(0)
  const [selId, setSelId] = useState(initialSel)
  const [filter, setFilter] = useState('all')
  const [view, setView] = useState('list')
  const [timeline, setTimeline] = useState(null)
  const [whereForm, setWhereForm] = useState(null)
  const layout = store.full
  const floors = store.levels
  const shown = Math.min(level, floors - 1)
  const floorLayout = useMemo(() => levelLayout(layout, shown), [layout, shown])
  const status = store.elStatus
  const todo = useMemo(() => todoElementIds(recs), [recs])
  const alerts = useMemo(() => new Set(recs.filter(r => r.status === 'pending' && r.element_id).map(r => r.element_id)), [recs])
  const sel = selId ? layout.elements.find(e => e.id === selId) : null

  useEffect(() => { if (sel && levelOf(sel) !== shown) setLevel(levelOf(sel)) }, [selId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab !== 'history' || timeline) return
    loadStoreTimeline({ clientId: store.model.client_id, locationName: store.model.location_name, model: store.model, logs })
      .then(setTimeline).catch(() => setTimeline([]))
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  const select = (item) => {
    if (!item) { setSelId(null); return }
    if (item.type === 'area') { onDetails(item); return }
    setSelId(item.id)
  }

  const items = layout.elements
    .map(el => ({ el, st: status.get(el.id) || null }))
    .filter(x => filter === 'all' || todo.has(x.el.id) || x.st === 'overdue' || x.st === 'due')
    .sort((a, b) => (RANK[a.st] ?? 5) - (RANK[b.st] ?? 5) || a.el.name.localeCompare(b.el.name))
  const attentionN = layout.elements.filter(el => todo.has(el.id) || ['overdue', 'due'].includes(status.get(el.id))).length

  const selMission = sel ? missions.find(m => m.element_id === sel.id) : null
  const lastLogPhoto = el => elementHistory(el.id, logs).find(l => l.photos?.length)?.photos?.[0]
  const fmtDate = d => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-US', { day: '2-digit', month: 'short' }) : '')

  const stageH = Math.max(320, height)

  return (
    <div className={`kw-store${sel && tab !== 'history' ? ' has-sel' : ''}`}>
      <div className="kw-stage">
        {tab === 'map' && (
          <WorldView layout={floorLayout} mode={mode} selectedId={sel?.id || null} onSelect={select} status={status} todo={todo} alerts={alerts} height={stageH} t={t} />
        )}
        {tab === 'items' && (
          <div className="kw-panel-page">
            <div className="kw-seg kw-seg-inline">
              <button type="button" className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>{w.all} · {layout.elements.length}</button>
              <button type="button" className={filter === 'att' ? 'on' : ''} onClick={() => setFilter('att')}>⚠️ {w.attention} · {attentionN}</button>
              <button type="button" className="kw-view" onClick={() => setView(v => (v === 'list' ? 'cards' : 'list'))} title={view === 'list' ? w.viewCards : w.viewList}>{view === 'list' ? '▦' : '☰'}</button>
            </div>
            {view === 'list' ? (
              <div className="kw-itemlist">
                <div className="kw-itemlist-head">
                  <span>{w.item}</span><span>{w.lastClean}</span><span>{w.firstClean}</span><span>{w.cleanings}</span>
                </div>
                {items.map(({ el, st }) => {
                  const k = ELEMENT_KINDS[el.kind] || ELEMENT_KINDS.other
                  const hist = elementHistory(el.id, logs)
                  const lastL = hist[0]
                  const firstL = hist[hist.length - 1]
                  const area = areaForElement(layout, el)
                  return (
                    <button key={el.id} type="button" className={`kw-itemrow st-${st || 'none'}${sel?.id === el.id ? ' on' : ''}`} onClick={() => select({ type: 'element', id: el.id })}>
                      <span className="kw-itemrow-name">
                        <i className={`kw-dot st-${st || 'none'}`} />
                        <b aria-hidden="true">{k.icon}</b>
                        <span><strong>{el.name}</strong><small>{area ? area.name : ''}</small></span>
                      </span>
                      <span className="kw-itemrow-when">{lastL ? <><strong>{fmtDate(String(lastL.service_date).slice(0, 10))}</strong><small>{lastL.employee_name || ''}</small></> : <small>{w.never}</small>}</span>
                      <span className="kw-itemrow-when">{firstL && hist.length > 1 ? <><strong>{fmtDate(String(firstL.service_date).slice(0, 10))}</strong><small>{firstL.employee_name || ''}</small></> : <small>—</small>}</span>
                      <span className="kw-itemrow-n">{hist.length || ''}</span>
                    </button>
                  )
                })}
              </div>
            ) : (
            <div className="kw-inventory">
              {items.map(({ el, st }) => {
                const k = ELEMENT_KINDS[el.kind] || ELEMENT_KINDS.other
                const photo = el.photos?.[0] || lastLogPhoto(el)
                const area = areaForElement(layout, el)
                const last = (el.care || careForElement(el, [])).map(c => c.last).filter(Boolean).sort().pop()
                return (
                  <button key={el.id} type="button" className={`kw-slot st-${st || 'none'}${sel?.id === el.id ? ' on' : ''}${todo.has(el.id) ? ' todo' : ''}`} onClick={() => select({ type: 'element', id: el.id })}>
                    <span className="kw-slot-img">
                      {photo ? <img src={viewablePhotoUrl(photo)} alt="" loading="lazy" /> : <span aria-hidden="true">{k.icon}</span>}
                      {st && <i className={`kw-dot st-${st}`} />}
                    </span>
                    <strong>{el.name}</strong>
                    <small>{area ? `${(AREA_KINDS[area.kind] || AREA_KINDS.other).icon} ${area.name}` : pickLang(lang, k.en, k.ja, k.pt)}</small>
                    <small className="kw-slot-when">{last ? fill(w.lastDone, { date: fmtDate(last) }) : (el.care || careForElement(el, [])).length ? w.never : ''}</small>
                  </button>
                )
              })}
            </div>
            )}
          </div>
        )}
        {tab === 'history' && (
          <div className="kw-panel-page">
            {timeline === null ? <div className="kw-empty">{w.loading}</div> : (
              <CleaningTimeline
                dark
                entries={timeline}
                placePhotos={placePhotosOf(store.model, timeline)}
                size={sizeLabel(layout)}
                title={store.name}
              />
            )}
            {timeline && timeline.length === 0 && <div className="kw-empty">{w.storeHistoryEmpty}</div>}
          </div>
        )}
      </div>

      {/* HUD de cima */}
      <div className="kw-hud kw-hud-tl">
        <button type="button" className="kw-back" onClick={onBack}>‹ {w.back}</button>
        <div className="kw-brand kw-store-name">
          <span><strong>{store.name}</strong><small>{[store.sub, sizeLabel(layout), floors > 1 ? fill(w.floors, { n: floors }) : ''].filter(Boolean).join(' · ')}</small></span>
        </div>
        {floors > 1 && tab === 'map' && (
          <div className="kw-floors">
            {Array.from({ length: floors }, (_, i) => (
              <button key={i} type="button" className={shown === i ? 'on' : ''} onClick={() => { setLevel(i); setSelId(null) }}>{i === 0 ? t.groundFloor : `${i + 1}F`}</button>
            ))}
          </div>
        )}
      </div>
      <div className="kw-hud kw-hud-tr kw-actions">
        <button type="button" className="kw-chip-btn" onClick={() => openClientSheet({ id: store.model.client_id })} title={w.clientSheet}>📇 <span>{w.clientSheet}</span></button>
        <button type="button" className="kw-chip-btn" onClick={onQuote} title={w.quote}>💴 <span>{w.quote}</span></button>
        <button type="button" className="kw-chip-btn" onClick={onEdit} title={w.editPlan}>✏️ <span>{w.editPlan}</span></button>
        <div className="kw-next">🗓 {nextJob ? fill(w.nextJob, { date: fmtDate(String(nextJob.scheduled_date).slice(0, 10)), who: nextJob.employee_name || '—' }) : w.noNextJob}</div>
      </div>
      {tab === 'map' && (
        <div className="kw-hud kw-hud-ml">
          <button type="button" className={`kw-round${mode === '3d' ? ' on' : ''}`} onClick={() => setMode('3d')} title={t.view3d}>🛰</button>
          <button type="button" className={`kw-round${mode === 'walk' ? ' on' : ''}`} onClick={() => setMode('walk')} title={t.walkInside}>🚶</button>
        </div>
      )}

      {/* onde fica: luz, materiais de limpeza, disjuntor (foto real) */}
      {tab === 'map' && mode !== 'walk' && (
        <WhereIs
          className="kw-where"
          layout={floorLayout}
          wi={t.whereIs}
          defaultOpen={!mobile}
          onOpen={el => setSelId(el.id)}
          onAdd={onSaveWhere ? kind => setWhereForm({ kind }) : undefined}
          onAddPhoto={onSaveWhere ? el => setWhereForm({ el }) : undefined}
        />
      )}
      {whereForm && (
        <WherePlaceForm
          kind={whereForm.kind}
          el={whereForm.el}
          layout={floorLayout}
          wi={t.whereIs}
          onSave={data => onSaveWhere({ ...data, level: shown })}
          onClose={() => setWhereForm(null)}
        />
      )}

      {/* painel do item: fotos reais + o que fazer */}
      {sel && tab !== 'history' && (
        <div className={`kw-inspect${mobile ? ' sheet' : ''}`}>
          <ItemSheet
            key={sel.id}
            el={sel}
            layout={layout}
            t={t}
            status={status}
            logs={logs}
            onDetails={() => onDetails({ type: 'element', id: sel.id })}
            onClose={() => setSelId(null)}
            onOffer={selMission && busy !== selMission.key ? () => onOffer(selMission) : undefined}
            offered={!!selMission?.offered}
            onLog={rowsForElement(sel, sel.care || careForElement(sel, [])).length > 0 ? () => onDone(sel) : undefined}
            extraActions={onSaveWhere && <button type="button" onClick={() => setWhereForm({ el: sel })}>📷 {t.whereIs?.photoBtn}</button>}
          />
        </div>
      )}

      {/* abas de baixo */}
      <nav className="kw-tabs" aria-label={store.name}>
        <button type="button" className={tab === 'map' ? 'on' : ''} onClick={() => setTab('map')}>🗺 <span>{w.map}</span></button>
        <button type="button" className={tab === 'items' ? 'on' : ''} onClick={() => setTab('items')}>🧰 <span>{w.items}</span>{attentionN > 0 && <b>{attentionN}</b>}</button>
        <button type="button" className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>🕘 <span>{w.history}</span></button>
      </nav>
      {tab === 'map' && !sel && !mobile && <div className="kw-help">{w.helpStore}</div>}
    </div>
  )
}
