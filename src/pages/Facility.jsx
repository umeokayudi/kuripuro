import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useLang, fill, pickLang } from '../hooks/useLang'
import {
  AREA_KINDS, ELEMENT_KINDS, areaForElement, careForElement, elementHistory, levelCount, levelLayout, levelOf,
  serviceOffers, statusMap, todoElementIds, withServiceLog,
} from '../lib/facilityModel'
import { listAllModels, listApprovedModels, listModels, listRecommendations, listServiceLog, logElementService, offerService } from '../lib/facilityApi'
import { loadStoreTimeline, placePhotosOf, sizeLabel } from '../lib/cleaningTimeline'
import { openClientSheet } from '../lib/clientSheet'
import { viewablePhotoUrl } from '../lib/photoUrl'
import { offerWhen } from '../components/facility/FacilityOffersBell'
import { WorldView } from '../components/facility/FacilityViewer'
import ItemSheet from '../components/facility/ItemSheet'
import FacilityItemPopup, { RecommendationCard } from '../components/facility/FacilityItemPopup'
import CleaningTimeline from '../components/CleaningTimeline'
import { rowsForElement } from '../components/facility/CareList'
import '../components/facility/facility.css'
import '../components/facility/world.css'
import '../components/deep-spot.css'
import { fetchDeepStatusForPlace } from '../lib/deepCoverageData'

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

const daysAgo = n => new Date(Date.now() - n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })

/**
 * Mundo Kuripuro (admin, /facility): tela cheia com cara de jogo, sem cabeçalho.
 * Cidade com todas as lojas → toca num prédio → entra na loja (Mapa | Itens | Histórico) → toca num item → fotos reais.
 * Missões (atrasado / esta semana) ficam do lado, com Ir, Oferecer e Feito. A edição da planta continua em /facility/edit.
 *
 * v1.0.90 · audience 'employee' e 'client' = o mesmo mundo só para ver, aberto por cima do portal (onClose fecha):
 * - employee (viewer { id, name }): lojas publicadas dos clientes onde ele trabalha; painel "Meu trabalho" com o que ele terminou.
 * - client (viewer { client_id, company_name }): só as lojas dele; painel "Cuidados" com Pedir orçamento (onRequestQuote) e recomendações (onDecideRec).
 */
export default function Facility({ audience = 'admin', viewer = null, onClose, onRequestQuote, onDecideRec }) {
  const isAdmin = audience === 'admin'
  const isClient = audience === 'client'
  const isEmployee = audience === 'employee'
  const { t: tr, lang } = useLang()
  const t = tr.facility
  const w = t.world || {}
  const { user } = useAuth()
  const navigate = useNavigate()
  const [urlParams, setUrlParams] = useSearchParams()
  // nos portais a loja aberta fica só na tela (não mexe no endereço do portal)
  const [localParams, setLocalParams] = useState(() => new URLSearchParams())
  const params = isAdmin ? urlParams : localParams
  const setParams = isAdmin ? setUrlParams : v => setLocalParams(new URLSearchParams(v))
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
  // v1.0.102 · everyone opens on the LIST view; the 3D is an option (a button), never the entry.
  const [listMode, setListMode] = useState(true)
  // The portal overlay must always be closable, even if the 3D view stops responding: Escape key too.
  useEffect(() => {
    if (!onClose) return undefined
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const [missionsOpen, setMissionsOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 760)
  const [missionTab, setMissionTab] = useState(isEmployee ? 'mine' : 'late')
  const [busy, setBusy] = useState('')
  const [popup, setPopup] = useState(null)
  const [myJobs, setMyJobs] = useState([])
  const [quoteFor, setQuoteFor] = useState(null)
  const [recBusy, setRecBusy] = useState('')
  // v1.0.96 · every place of the single location registry shows in the World, with today's jobs,
  // even without a 3D plan yet (those show as a plain building and open a simple sheet).
  const [places, setPlaces] = useState([])
  const [todayJobs, setTodayJobs] = useState([])
  const [placeOpen, setPlaceOpen] = useState(null)

  const storeId = params.get('model') || null
  const mapView = !storeId && params.get('view') === 'map'
  const [pendingSel, setPendingSel] = useState(null)

  const load = useCallback(async () => {
    if (isClient) {
      const cid = viewer?.client_id
      const [ms, ls, rs, { data: js }] = await Promise.all([
        cid ? listModels(cid).catch(() => []) : [],
        cid ? listServiceLog({ clientId: cid, limit: 3000 }) : [],
        cid ? listRecommendations({ clientId: cid }).catch(() => []) : [],
        supabase.from('jobs').select('id,title,scheduled_date,status,employee_name,client_id')
          .eq('client_id', cid).gte('scheduled_date', tokyoToday()).order('scheduled_date').limit(200),
      ])
      const loc = viewer?.location_name
      setModels(ms.filter(m => m.status === 'approved' && (!loc || !m.location_name || m.location_name === loc)))
      setLogs(ls)
      setRecs(rs || [])
      setClients(new Map([[cid, viewer?.company_name || '']]))
      setJobs((js || []).filter(j => !['cancelled', 'completed'].includes(j.status)))
      setLoaded(true)
      return
    }
    if (isEmployee) {
      // lojas = clientes com serviço meu nos últimos 6 meses ou nos próximos 2
      const { data: mine } = await supabase.from('jobs')
        .select('id,title,scheduled_date,status,employee_name,client_id,completed_at,photo_end_url')
        .eq('employee_id', viewer?.id).gte('scheduled_date', daysAgo(180)).order('scheduled_date', { ascending: false }).limit(1000)
      const clientIds = [...new Set((mine || []).map(j => j.client_id).filter(Boolean))]
      const [all, ls, rs, { data: cl }] = await Promise.all([
        clientIds.length ? listApprovedModels() : [],
        clientIds.length ? listServiceLog({ limit: 3000 }) : [],
        clientIds.length ? listRecommendations({}).catch(() => []) : [],
        clientIds.length ? supabase.from('clients').select('id,company_name').in('id', clientIds) : { data: [] },
      ])
      const ms = all.filter(m => clientIds.includes(m.client_id))
      const ids = new Set(ms.map(m => m.id))
      setModels(ms)
      setLogs(ls.filter(l => ids.has(l.model_id)))
      setRecs((rs || []).filter(r => ids.has(r.model_id)))
      setClients(new Map((cl || []).map(c => [c.id, c.company_name])))
      setMyJobs(mine || [])
      setJobs((mine || []).filter(j => j.scheduled_date >= tokyoToday() && !['cancelled', 'completed'].includes(j.status)).reverse())
      // Employee: only the places of my own route today, no money and nobody else's work.
      const mineToday = (mine || []).filter(j => j.scheduled_date === tokyoToday() && j.status !== 'cancelled')
      setTodayJobs(mineToday)
      setPlaces([...new Map(mineToday.map(j => [storeBase(j.title), { name: j.title.split(/\s+[-—–]\s+/)[0].trim(), client_id: j.client_id }])).values()])
      setLoaded(true)
      return
    }
    const [{ data: locs }, { data: scs }, { data: tj }] = await Promise.all([
      supabase.from('locations').select('*').eq('is_active', true),
      supabase.from('service_contracts').select('client_id,location_name,location_address,is_active').eq('is_active', true),
      supabase.from('jobs').select('id,title,scheduled_date,scheduled_time,status,employee_name,client_id').eq('scheduled_date', tokyoToday()).neq('status', 'cancelled'),
    ])
    const byName = new Map()
    for (const l of locs || []) byName.set(storeBase(l.name), { name: l.name, client_id: l.client_id, address: l.address, location_id: l.id })
    for (const c of scs || []) {
      const k = storeBase(c.location_name)
      if (!k) continue
      const cur = byName.get(k)
      if (!cur) byName.set(k, { name: c.location_name.split(/\s+[-—–]\s+/)[0].trim(), client_id: c.client_id, address: c.location_address })
      else if (!cur.client_id) cur.client_id = c.client_id
    }
    setPlaces([...byName.values()])
    setTodayJobs(tj || [])
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
  }, [isClient, isEmployee, viewer?.client_id, viewer?.id, viewer?.company_name, viewer?.location_name])
  useEffect(() => { load().catch(() => setLoaded(true)) }, [load])
  // portais: o que o funcionário acabou de terminar aparece sem precisar reabrir
  useEffect(() => {
    if (isAdmin) return undefined
    const again = () => { if (document.visibilityState !== 'hidden') load().catch(() => {}) }
    const timer = setInterval(again, 60000)
    window.addEventListener('kp:facility-updated', again)
    document.addEventListener('visibilitychange', again)
    return () => { clearInterval(timer); window.removeEventListener('kp:facility-updated', again); document.removeEventListener('visibilitychange', again) }
  }, [isAdmin, load])

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

  // funcionário: o que eu terminei (itens marcados + serviços concluídos nas lojas do mundo)
  const myWork = useMemo(() => {
    if (!isEmployee) return []
    const storeOf = clientId => models.find(m => m.client_id === clientId)
    const fromLogs = logs.filter(l => l.employee_id === viewer?.id).map(l => ({
      key: `l:${l.id}`, date: String(l.service_date || l.created_at || '').slice(0, 10), model_id: l.model_id, element_id: l.element_id,
      title: l.service ? `${l.element_name} · ${l.service}` : l.element_name, store: clients.get(l.client_id) || l.location_name || '', photo: l.photos?.[0] || null,
    }))
    const fromJobs = myJobs.filter(j => j.status === 'completed' && storeOf(j.client_id)).map(j => ({
      key: `j:${j.id}`, date: String(j.completed_at || j.scheduled_date || '').slice(0, 10), model_id: storeOf(j.client_id).id, element_id: null,
      title: j.title, store: clients.get(j.client_id) || '', photo: j.photo_end_url || null, job: true,
    }))
    return [...fromLogs, ...fromJobs].filter(x => x.date >= since30).sort((a, b) => b.date.localeCompare(a.date))
  }, [isEmployee, logs, myJobs, models, clients, viewer?.id, since30])
  const pendingRecs = isClient ? recs.filter(r => r.status === 'pending') : []
  const decideRec = async (rec, decision) => {
    if (!onDecideRec) return
    setRecBusy(rec.id)
    try { await onDecideRec(rec, decision); const rs = await listRecommendations({ clientId: viewer?.client_id }).catch(() => null); if (rs) setRecs(rs) } finally { setRecBusy('') }
  }
  const askQuote = (storeRow, extra = '') => setQuoteFor({
    location_name: storeRow?.model?.location_name || '',
    description: [storeRow?.name, extra].filter(Boolean).join(' — '),
  })

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
  }).concat(isClient ? [] : places
    // a place already drawn in 3D is not repeated
    .filter(pl => !models.some(m => storeBase(m.location_name || m.name) === storeBase(pl.name) || (!m.location_name && m.client_id === pl.client_id && storeBase(clients.get(m.client_id)) === storeBase(pl.name))))
    .map(pl => ({
      id: `place:${storeBase(pl.name)}`,
      place: pl,
      model: { id: null, client_id: pl.client_id, location_name: pl.name },
      client_name: clients.get(pl.client_id) || '',
      name: pl.name,
      sub: clients.get(pl.client_id) && clients.get(pl.client_id) !== pl.name ? clients.get(pl.client_id) : '',
      layout: null, full: null, levels: 1, elStatus: new Map(),
      status: 'none', late: 0, soon: 0, draft: false, placeOnly: true,
    })))
    .map(st => ({ ...st, today: todayJobs.filter(j => storeBase(j.title) === storeBase(st.model?.location_name || st.name) || (!st.model?.location_name && j.client_id === st.model?.client_id)) }))
    .filter(st => !isEmployee || st.today.length > 0 || !st.placeOnly)
    .sort((a, b) => (b.today.length > 0) - (a.today.length > 0) || a.name.localeCompare(b.name)), [models, logs, clients, late, soon, places, todayJobs, isClient, isEmployee])

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
    if (String(id).startsWith('place:')) { setPlaceOpen(stores.find(s => s.id === id) || null); return }
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

  const q = query.trim().toLowerCase()
  const found = q ? stores.filter(s => `${s.name} ${s.sub}`.toLowerCase().includes(q)).slice(0, 6) : []
  const shownMissions = missionTab === 'late' ? late : missionTab === 'soon' ? soon : []
  const popupStore = popup ? stores.find(s => s.id === popup.modelId) : null

  const view = (
    <div className={`kw-root${isAdmin ? '' : ' kw-overlay'}`} ref={rootRef}>
      {/* Always-on-top exit for the portals: works even if the 3D view is busy. */}
      {onClose && (
        <button type="button" onClick={onClose} aria-label={w.exit}
          style={{ position: 'fixed', top: 'calc(env(safe-area-inset-top, 0px) + 10px)', right: 10, zIndex: 10000, width: 40, height: 40, borderRadius: 20, border: 'none', background: 'rgba(15,23,42,0.85)', color: '#fff', fontSize: 18, fontWeight: 800, cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.3)' }}>✕</button>
      )}
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
          audience={audience}
          onAskQuote={isClient && onRequestQuote ? extra => askQuote(store, extra) : undefined}
        />
      ) : (
        <>
          {mapView && loaded && isAdmin && (
            <Suspense fallback={<div className="kw-loading">{w.loading}</div>}>
              <CityMap stores={stores} m={w.cityMap || {}} lang={lang} query={query} mobile={mobile} onOpenStore={id => enterStore(id)} />
            </Suspense>
          )}
          {listMode || mapView || !loaded ? null : (
            <Suspense fallback={<div className="kw-list">{stores.map(s => (
              <button key={s.id} type="button" className={`kw-list-card st-${s.draft ? 'draft' : s.status}`} onClick={() => enterStore(s.id)}>
                <strong>{s.name}</strong>{s.sub && <span>{s.sub}</span>}
              </button>
            ))}</div>}>
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
                    {s.placeOnly ? pickLang(lang, 'No 3D plan yet', '3D図面なし', 'Sem planta 3D ainda') : s.draft ? w.draft : s.late ? fill(w.lateN, { n: s.late }) : s.soon ? fill(w.weekN, { n: s.soon }) : w.allOk}
                    {s.today.length > 0 && <> · 🧹 {pickLang(lang, `${s.today.length} today`, `今日${s.today.length}件`, `${s.today.length} hoje`)}</>}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* HUD: canto de cima à esquerda */}
          <div className="kw-hud kw-hud-tl">
            {onClose
              ? <button type="button" className="kw-back" onClick={onClose}>‹ {w.exit}</button>
              : mobile && <button type="button" className="kw-icon-btn" onClick={openMenu} aria-label={w.menu}>☰</button>}
            <div className="kw-brand">
              <span className="kw-brand-logo" aria-hidden="true">🌏</span>
              <span><strong>{w.brand}</strong><small>{loaded ? fill(w.stores, { n: stores.length }) : pickLang(lang, 'loading…', '読み込み中…', 'carregando…')}</small></span>
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
            {isAdmin && <button type="button" className={`kw-pill kw-mapbtn${mapView ? ' on' : ''}`} onClick={() => setParams(mapView ? {} : { view: 'map' })}>
              {mapView ? `🌏 ${w.cityMap?.world3d}` : `🗺️ ${w.cityMap?.open}`}
            </button>}
          </div>

          {/* HUD: placar */}
          <div className="kw-hud kw-hud-tr">
            <button type="button" className="kw-stat late" onClick={() => { setMissionTab('late'); setMissionsOpen(true) }}><b>{late.length}</b><span>{w.late}</span></button>
            <button type="button" className="kw-stat soon" onClick={() => { setMissionTab('soon'); setMissionsOpen(true) }}><b>{soon.length}</b><span>{w.week}</span></button>
            {isEmployee
              ? <button type="button" className="kw-stat ok" onClick={() => { setMissionTab('mine'); setMissionsOpen(true) }}><b>{myWork.length}</b><span>{w.myDone30}</span></button>
              : <div className="kw-stat ok"><b>{done30}</b><span>{w.done30}</span></div>}
          </div>

          {/* Missões */}
          {!mapView && <aside className={`kw-missions${missionsOpen ? ' open' : ''}${mobile ? ' sheet' : ''}`}>
            <button type="button" className="kw-missions-head" onClick={() => setMissionsOpen(v => !v)} aria-expanded={missionsOpen}>
              <span>{isEmployee ? `✅ ${w.myWork}` : isClient ? `🧽 ${w.care}` : `🎯 ${w.missions}`}</span>
              <b className={late.length && !isEmployee ? 'late' : ''}>{isEmployee ? myWork.length : missions.length + pendingRecs.length}</b>
              <i aria-hidden="true">{missionsOpen ? '▾' : '▴'}</i>
            </button>
            {missionsOpen && (
              <>
                <div className="kw-seg">
                  {isEmployee && <button type="button" className={missionTab === 'mine' ? 'on' : ''} onClick={() => setMissionTab('mine')}>✅ {w.mine} · {myWork.length}</button>}
                  <button type="button" className={missionTab === 'late' ? 'on' : ''} onClick={() => setMissionTab('late')}>🔴 {w.late} · {late.length}</button>
                  <button type="button" className={missionTab === 'soon' ? 'on' : ''} onClick={() => setMissionTab('soon')}>🟡 {w.week} · {soon.length}</button>
                </div>
                <div className="kw-mission-list">
                  {pendingRecs.length > 0 && (
                    <div className="kw-recs fac-dark">
                      <div className="kw-recs-title">💡 {t.recommendedForYou}</div>
                      {pendingRecs.map(r => <RecommendationCard key={r.id} rec={r} t={t} onDecide={decideRec} busy={recBusy === r.id} showStatus={false} />)}
                    </div>
                  )}
                  {missionTab === 'mine' && myWork.length === 0 && <div className="kw-empty">{w.myWorkEmpty}</div>}
                  {missionTab === 'mine' && myWork.map(x => (
                    <button key={x.key} type="button" className="kw-mywork" onClick={() => enterStore(x.model_id, x.element_id)}>
                      <span className="kw-mywork-img">{x.photo ? <img src={viewablePhotoUrl(x.photo)} alt="" loading="lazy" /> : <span aria-hidden="true">{x.job ? '🧹' : '✅'}</span>}</span>
                      <span className="kw-mywork-text"><strong>{x.title}</strong><small>{x.store}</small></span>
                      <time>{x.date.slice(5).replace('-', '/')}</time>
                    </button>
                  ))}
                  {missionTab !== 'mine' && shownMissions.length === 0 && <div className="kw-empty">{w.missionsEmpty}</div>}
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
                          <button type="button" onClick={() => enterStore(r.model_id, r.element_id)}>▶ {isAdmin ? w.go : w.see}</button>
                          {isAdmin && <button type="button" disabled={r.offered || busy === r.key} onClick={() => offer(r)}>{r.offered ? `✓ ${w.offered}` : busy === r.key ? '…' : `📨 ${w.offer}`}</button>}
                          {isAdmin && <button type="button" className="primary" onClick={() => setPopup({ modelId: r.model_id, type: 'element', id: r.element_id, log: true })}>✅ {w.done}</button>}
                          {isClient && onRequestQuote && <button type="button" className="primary" onClick={() => askQuote(stores.find(s => s.id === r.model_id), `${r.element_name} · ${r.task_name}`)}>💴 {w.askQuote}</button>}
                        </div>
                      </article>
                    )
                  })}
                </div>
              </>
            )}
          </aside>}

          {!mapView && <div className="kw-hud kw-hud-bl">
            {isAdmin && <button type="button" className="kw-pill" onClick={() => navigate('/facility/edit')}>＋ {w.newStore}</button>}
            {isClient && onRequestQuote && <button type="button" className="kw-pill" onClick={() => askQuote(stores[0] || null)}>💴 {w.askQuote}</button>}
            <button type="button" className="kw-pill ghost" onClick={() => setListMode(v => !v)}>{listMode ? `🌏 ${w.openWorld}` : `☰ ${w.openList}`}</button>
          </div>}
          {loaded && !listMode && !mapView && stores.length > 0 && !mobile && <div className="kw-help">{w.help}</div>}
          {loaded && !mapView && stores.length === 0 && <div className="kw-empty-world">{isAdmin ? w.empty : isClient ? w.emptyClient : w.emptyEmployee}</div>}
        </>
      )}

      {placeOpen && (
        <div className="kw-place-sheet" role="dialog" aria-modal="true" onClick={() => setPlaceOpen(null)}
          style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(5,12,25,.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 12 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, maxHeight: '80%', overflowY: 'auto', background: '#0f2440', color: '#e8eefc', borderRadius: 18, padding: 18, border: '1px solid rgba(255,255,255,.12)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div><div style={{ fontSize: 18, fontWeight: 800 }}>{placeOpen.name}</div>{placeOpen.sub && <div style={{ fontSize: 13, opacity: .7 }}>{placeOpen.sub}</div>}</div>
              <button type="button" className="kw-back" onClick={() => setPlaceOpen(null)}>✕</button>
            </div>
            {placeOpen.place?.address && isAdmin && <div style={{ fontSize: 12, opacity: .7, marginTop: 6 }}>📍 {placeOpen.place.address}</div>}
            <div style={{ marginTop: 14, fontWeight: 700, fontSize: 13 }}>🧹 {pickLang(lang, "Today's jobs", '今日の作業', 'Jobs de hoje')} ({placeOpen.today.length})</div>
            {placeOpen.today.length === 0 && <div style={{ fontSize: 13, opacity: .7, marginTop: 6 }}>{pickLang(lang, 'Nothing today.', '今日はありません。', 'Nada hoje.')}</div>}
            {placeOpen.today.map(j => (
              <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, padding: '7px 0', borderTop: '1px solid rgba(255,255,255,.08)' }}>
                <span>{j.scheduled_time || '—'} · {j.title.split(/\s+[—–]\s+/).slice(1).join(' — ') || j.title}</span>
                <span style={{ opacity: .75 }}>{isEmployee ? '' : (j.employee_name || '—') + ' · '}{j.status === 'completed' ? '✅' : j.status === 'in_progress' ? '▶' : '○'}</span>
              </div>
            ))}
            <div style={{ fontSize: 12, opacity: .6, marginTop: 12 }}>{pickLang(lang, 'This place has no 3D plan yet.', 'この場所の3D図面はまだありません。', 'Este local ainda não tem planta 3D.')}</div>
            {isAdmin && <button type="button" className="kw-pill" style={{ marginTop: 10 }} onClick={() => navigate(placeOpen.model.client_id ? `/facility/edit?client=${placeOpen.model.client_id}` : '/facility/edit')}>＋ {w.newStore}</button>}
          </div>
        </div>
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
          onLogService={isAdmin ? (el, data) => onLogService(popupStore.model, el, data) : undefined}
          onClose={() => setPopup(null)}
          onSelectItem={item => setPopup({ modelId: popupStore.id, ...item })}
        />
      )}
      {quoteFor && (
        <QuoteSheet
          w={w}
          initial={quoteFor}
          onClose={() => setQuoteFor(null)}
          onSend={async form => { await onRequestQuote(form); setQuoteFor(null) }}
        />
      )}
    </div>
  )
  // portais: por cima de tudo (o cabeçalho e a barra de baixo do portal ficam escondidos)
  return isAdmin ? view : createPortal(view, document.body)
}

/** v1.0.90 · cliente pede orçamento sem sair do mundo (vai para client_requests como os outros pedidos). */
function QuoteSheet({ w, initial, onClose, onSend }) {
  const [text, setText] = useState(initial.description || '')
  const [date, setDate] = useState('')
  const [sending, setSending] = useState(false)
  return (
    <div className="kw-modal" role="dialog" aria-modal="true" onClick={onClose}>
      <form className="kw-quote" onClick={e => e.stopPropagation()} onSubmit={async e => {
        e.preventDefault()
        if (!text.trim() || sending) return
        setSending(true)
        try { await onSend({ kind: 'quote', category: '', location_name: initial.location_name || '', description: text.trim(), preferred_date: date }) } finally { setSending(false) }
      }}>
        <h3>💴 {w.askQuote}</h3>
        <p>{w.askQuoteHint}</p>
        <label><span>{w.askQuoteWhat}</span><textarea rows={4} value={text} onChange={e => setText(e.target.value)} autoFocus /></label>
        <label><span>{w.askQuoteDate}</span><input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <div className="kw-quote-btns">
          <button type="button" onClick={onClose}>{w.cancel}</button>
          <button type="submit" className="primary" disabled={!text.trim() || sending}>{sending ? '…' : w.send}</button>
        </div>
      </form>
    </div>
  )
}

/** Dentro de uma loja: Mapa (3D) | Itens (inventário) | Histórico (fotos reais), painel do item tocado. */
function StoreView({ store, t, w, lang, logs, recs, missions, nextJob, height, mobile, initialSel, busy, onBack, onOffer, onDone, onDetails, onEdit, onQuote, audience = 'admin', onAskQuote }) {
  const isAdmin = audience === 'admin'
  const [tab, setTab] = useState('map')
  const [mode, setMode] = useState('3d')
  const [level, setLevel] = useState(0)
  const [selId, setSelId] = useState(initialSel)
  const [filter, setFilter] = useState('all')
  const [view, setView] = useState('list')
  const [timeline, setTimeline] = useState(null)
  const [deep, setDeep] = useState(null)
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

  // v1.0.104 · Deep state of this restaurant (same data as Jobs → Deep & Spot).
  useEffect(() => {
    if (!isAdmin || tab !== 'items' || deep) return
    fetchDeepStatusForPlace(store.model?.location_name || '').then(d => setDeep(d || false), () => setDeep(false))
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
            {deep && (() => {
              const today = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 10)
              const next = deep.nextScheduled?.scheduled_date || deep.nextExpected
              return (
                <div className="kw-deepstate">
                  <span>✨ <b>Deep</b></span>
                  <span>{pickLang(lang, 'Last done', '前回完了', 'Último feito')}: <b>{deep.lastDone ? fmtDate(deep.lastDone.scheduled_date) : w.never}</b>{deep.lastDone?.employee_name ? ` · ${deep.lastDone.employee_name}` : ''}</span>
                  <span>{pickLang(lang, 'Next', '次回', 'Próximo')}: {next ? <b className={!deep.nextScheduled && next < today ? 'late' : ''}>{fmtDate(next)}</b> : '—'}{next && !deep.nextScheduled ? ` (${pickLang(lang, 'expected, not scheduled', '予定未作成', 'esperado, não agendado')})` : ''}</span>
                </div>
              )
            })()}
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
        {isAdmin && <>
          <button type="button" className="kw-chip-btn" onClick={() => openClientSheet({ id: store.model.client_id })} title={w.clientSheet}>📇 <span>{w.clientSheet}</span></button>
          <button type="button" className="kw-chip-btn" onClick={onQuote} title={w.quote}>💴 <span>{w.quote}</span></button>
          <button type="button" className="kw-chip-btn" onClick={onEdit} title={w.editPlan}>✏️ <span>{w.editPlan}</span></button>
        </>}
        {onAskQuote && <button type="button" className="kw-chip-btn gold" onClick={() => onAskQuote('')} title={w.askQuote}>💴 <span>{w.askQuote}</span></button>}
        <div className="kw-next">🗓 {nextJob ? fill(w.nextJob, { date: fmtDate(String(nextJob.scheduled_date).slice(0, 10)), who: nextJob.employee_name || '—' }) : w.noNextJob}</div>
      </div>
      {tab === 'map' && (
        <div className="kw-hud kw-hud-ml">
          <button type="button" className={`kw-round${mode === '3d' ? ' on' : ''}`} onClick={() => setMode('3d')} title={t.view3d}>🛰</button>
          <button type="button" className={`kw-round${mode === 'walk' ? ' on' : ''}`} onClick={() => setMode('walk')} title={t.walkInside}>🚶</button>
        </div>
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
            onOffer={isAdmin && selMission && busy !== selMission.key ? () => onOffer(selMission) : undefined}
            offered={!!selMission?.offered}
            onLog={isAdmin && rowsForElement(sel, sel.care || careForElement(sel, [])).length > 0 ? () => onDone(sel) : undefined}
            extraActions={onAskQuote ? <button type="button" className="primary" onClick={() => onAskQuote(selMission ? `${sel.name} · ${selMission.task_name}` : sel.name)}>💴 {w.askQuote}</button> : null}
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
