import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { apiFetch, apiPost } from '../lib/apiFetch'
import { uploadJobPhoto } from '../lib/uploadPhoto'
import { viewablePhotoUrl } from '../lib/photoUrl'
import { useLang, fill, localeOf } from '../hooks/useLang'
import { FACILITY_SETUP_SQL } from '../lib/facilitySetupSql'
import { SUPABASE_SQL_URL } from '../lib/portalSetupSql'
import {
  AREA_KINDS,
  ELEMENT_KINDS,
  emptyLayout,
  kindLabel,
  newId,
  normalizeLayout,
  perimeterWalls,
  restaurantTemplate,
  mergeLayoutAdditions,
  areaSquareMeters,
  PRIORITY_ORDER,
  withServiceLog,
  statusMap,
  todoElementIds,
  elementTasks,
  careSchedule,
  levelCount,
  levelLayout,
  levelOf,
  mergeLevel,
} from '../lib/facilityModel'
import {
  PALETTE,
  PLAN_PRESETS,
  OPTIONAL_ROOMS,
  generatePlan,
  fillRoom,
  placeItem,
  nudge,
  rotate90,
  snapToWall,
  centerInArea,
  duplicateItem,
  STORE_TEMPLATES,
  UPPER_FLOORS,
  buildTemplate,
  addUpperFloor,
  removeUpperFloors,
  fillLevel,
} from '../lib/facilityBuilder'
import {
  checkFacilitySchema,
  createModel,
  decideRecommendation,
  deleteModel,
  deleteRecommendation,
  generateRecommendations,
  listModels,
  listRecommendations,
  listServiceLog,
  deleteServiceLog,
  saveModel,
  offerService,
  logElementService,
  listAllModels,
} from '../lib/facilityApi'
import FacilityScene from '../components/facility/FacilityScene'
import { StatusLegend, ViewModeChips, WorldView } from '../components/facility/FacilityViewer'
import FacilityItemPopup, { RecommendationCard } from '../components/facility/FacilityItemPopup'
import CareList from '../components/facility/CareList'

const COLLECTION = { area: 'areas', element: 'elements', wall: 'walls' }

function NumField({ label, value, onChange, step = 0.1, min }) {
  return (
    <div className="form-group" style={{ marginBottom: 8 }}>
      <label>{label}</label>
      <input
        type="number"
        step={step}
        min={min}
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
      />
    </div>
  )
}

/** Miniatura da planta (cômodos coloridos + paredes) para escolher o modelo pronto. */
function PlanThumb({ layout: full }) {
  const layout = levelLayout(full, 0)
  const floors = levelCount(full)
  const W = layout.width
  const D = layout.depth
  const s = 140 / Math.max(W, D * 1.4)
  return (
    <svg viewBox={`-2 -2 ${W * s + 4} ${D * s + 4}`} aria-hidden="true">
      {layout.areas.map(a => (
        <rect key={a.id} x={a.x * s} y={a.y * s} width={a.w * s} height={a.d * s} fill={(AREA_KINDS[a.kind] || AREA_KINDS.other).color} fillOpacity="0.55" />
      ))}
      {layout.walls.map(w => <line key={w.id} x1={w.x1 * s} y1={w.y1 * s} x2={w.x2 * s} y2={w.y2 * s} stroke="#f8fafc" strokeWidth="1.6" />)}
      {layout.areas.map(a => (
        <text key={`t${a.id}`} x={(a.x + a.w / 2) * s} y={(a.y + a.d / 2) * s + 4} fontSize="11" textAnchor="middle">{(AREA_KINDS[a.kind] || AREA_KINDS.other).icon}</text>
      ))}
      {layout.elements.filter(e => e.kind === 'stairs').map(e => <rect key={e.id} x={e.x * s} y={e.y * s} width={e.w * s} height={e.d * s} fill="#f5c76a" />)}
      {floors > 1 && <text x={W * s - 3} y={12} fontSize="11" fontWeight="700" textAnchor="end" fill="#f5c76a">{floors}F</text>}
    </svg>
  )
}

const SIZES = [
  { key: 'sizeSmall', w: 8, d: 6 },
  { key: 'sizeMedium', w: 12, d: 8 },
  { key: 'sizeLarge', w: 18, d: 12 },
]

/** Editor das limpezas e manutenções de um equipamento (nome, tipo, a cada X dias, última vez). */
function TaskEditor({ el, care, t, onChange }) {
  const tasks = elementTasks(el)
  const set = (next) => onChange(next)
  const patch = (id, p) => set(tasks.map(x => (x.id === id ? { ...x, ...p } : x)))
  const add = (type) => set([...tasks, { id: newId('task'), type, name: type === 'maintenance' ? t.newMaintenanceName : (ELEMENT_KINDS[el.kind]?.service || t.newCleaningName), interval_days: type === 'maintenance' ? 180 : 30, last_done: null }])
  const lastFromLog = id => care?.find(c => c.id === id)?.last || null
  return (
    <div className="fac-details" style={{ padding: '8px 10px' }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>🧽🔧 {t.careTitle}</div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>{t.careHint}</div>
      {tasks.map(task => {
        const logged = lastFromLog(task.id)
        return (
          <div key={task.id} className={`fac-task-edit ${task.type}`}>
            <div className="fac-task-row">
              <select value={task.type} onChange={e => patch(task.id, { type: e.target.value })} aria-label={t.kind}>
                <option value="cleaning">🧽 {t.cleaning}</option>
                <option value="maintenance">🔧 {t.maintenance}</option>
              </select>
              <button type="button" className="btn btn-sm" onClick={() => set(tasks.filter(x => x.id !== task.id))} title={t.remove} aria-label={t.remove}>✕</button>
            </div>
            <label className="fac-task-field">
              <span>{t.taskName}</span>
              <input value={task.name} onChange={e => patch(task.id, { name: e.target.value })} placeholder={t.taskName} />
            </label>
            <div className="fac-task-row">
              <label className="fac-task-field small">
                <span>{t.everyDays}</span>
                <input type="number" min={1} step={1} value={task.interval_days ?? ''} onChange={e => patch(task.id, { interval_days: e.target.value === '' ? null : parseInt(e.target.value, 10) })} />
              </label>
              <label className="fac-task-field">
                <span>{t.lastDone}</span>
                <input type="date" value={(logged && logged > (task.last_done || '') ? logged : task.last_done) || ''} onChange={e => patch(task.id, { last_done: e.target.value || null })} />
              </label>
            </div>
          </div>
        )
      })}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" className="btn btn-sm" onClick={() => add('cleaning')}>{t.addCleaning}</button>
        <button type="button" className="btn btn-sm" onClick={() => add('maintenance')}>{t.addMaintenance}</button>
      </div>
    </div>
  )
}

/** Aba "Smart Facility" da área Clientes: fotos → modelo inicial (IA) → edição → aprovação. */
export default function FacilityStudio({ clients, initialClientId }) {
  const { lang, t: tr } = useLang()
  const t = tr.facility
  const [schemaOk, setSchemaOk] = useState(null)
  const [setupBusy, setSetupBusy] = useState(false)
  const [clientId, setClientId] = useState(initialClientId || '')
  const [locations, setLocations] = useState([])
  const [, setModels] = useState([])
  const [current, setCurrent] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [selected, setSelected] = useState(null)
  const [preview, setPreview] = useState(null)
  const [mode, setMode] = useState('3d')
  const [rotation] = useState(-30)
  const [caption, setCaption] = useState('')
  const [buildLog, setBuildLog] = useState([])
  const [hints, setHints] = useState('')
  const [busy, setBusy] = useState('')
  const [recs, setRecs] = useState([])
  const [logs, setLogs] = useState([])
  const [newLocation, setNewLocation] = useState('')
  const [addAreaKind, setAddAreaKind] = useState('kitchen')
  const [addElKind, setAddElKind] = useState('range_hood')
  const [buildTab, setBuildTab] = useState('quick')
  const [plan, setPlan] = useState({ width: 12, depth: 8, preset: 'side', rooms: { entrance: true, restroom: true, washing: true, storage: true }, fill: true, upper: null })
  const [palTab, setPalTab] = useState('kitchen')
  const [putIn, setPutIn] = useState('')
  const [dueAll, setDueAll] = useState(null)
  const [level, setLevel] = useState(0)
  const [upperKind, setUpperKind] = useState('dining')

  // tocou num item de outro andar (lista, agenda, aviso): a tela vai para o andar dele
  useEffect(() => {
    const it = selected && current?.layout[COLLECTION[selected.type]]?.find(x => x.id === selected.id)
    if (it && levelOf(it) !== level) setLevel(levelOf(it))
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps
  const [allModels, setAllModels] = useState(null)
  const [storeQuery, setStoreQuery] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [params, setParams] = useSearchParams()
  const pendingOpenRef = useRef(null)

  useEffect(() => { if (initialClientId) setClientId(initialClientId) }, [initialClientId])

  const verifySchema = useCallback(async () => {
    setSchemaOk(await checkFacilitySchema())
  }, [])
  useEffect(() => { verifySchema() }, [verifySchema])

  const loadClient = useCallback(async (id) => {
    if (!id) { setModels([]); setLocations([]); return }
    const [{ data: cts }, list] = await Promise.all([
      supabase.from('service_contracts').select('location_name').eq('client_id', id).eq('is_active', true),
      listModels(id).catch(() => []),
    ])
    setLocations([...new Set((cts || []).map(c => c.location_name).filter(Boolean))].sort())
    setModels(list)
  }, [])

  useEffect(() => {
    if (!schemaOk) return
    setCurrent(null)
    loadClient(clientId).then(() => {
      // veio do painel "serviços para oferecer": abre a loja depois de trocar de cliente
      const m = pendingOpenRef.current
      if (m && m.client_id === clientId) { pendingOpenRef.current = null; openModel(m) }
    })
  }, [clientId, schemaOk, loadClient]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadRecs = useCallback(async (modelId) => {
    try { setRecs(await listRecommendations({ modelId })) } catch { setRecs([]) }
    setLogs(await listServiceLog({ modelId }))
  }, [])

  const openModel = (m) => {
    setCurrent(m)
    setDirty(false)
    setSelected(null)
    loadRecs(m.id)
    if (params.get('model') !== m.id) setParams({ model: m.id })
  }
  // abre qualquer loja (troca de cliente antes, se precisar)
  const openAny = (m) => {
    if (m.client_id === clientId) openModel(m)
    else { pendingOpenRef.current = m; setClientId(m.client_id) }
  }
  const closeModel = () => {
    setCurrent(null)
    loadClient(clientId)
    if (params.get('model')) setParams({})
  }

  // link direto (?model=) e botão voltar do navegador
  const wantedModel = params.get('model')
  useEffect(() => {
    if (!schemaOk) return
    if (!wantedModel && current) {
      if (dirty && !confirm('Discard unsaved changes?')) { setParams({ model: current.id }); return }
      setCurrent(null)
    } else if (wantedModel && current?.id !== wantedModel && allModels) {
      const m = allModels.find(x => x.id === wantedModel)
      if (m) openAny(m)
    }
  }, [wantedModel, allModels, schemaOk]) // eslint-disable-line react-hooks/exhaustive-deps

  const runAutoSetup = async () => {
    setSetupBusy(true)
    try {
      const resp = await apiFetch('/api/setup-portal-schema', { method: 'POST' })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) toast.error(data.error || 'Setup failed')
      else toast.success(data.message || 'OK')
    } catch (e) {
      toast.error(e.message)
    }
    setSetupBusy(false)
    verifySchema()
  }

  const copySql = async () => {
    try {
      await navigator.clipboard.writeText(FACILITY_SETUP_SQL)
      toast.success('SQL ✓')
      window.open(SUPABASE_SQL_URL, '_blank')
    } catch {
      toast.error('Copy failed')
    }
  }

  // tela inicial: todas as lojas (cartões) + "serviços para oferecer" (aprovadas, atrasado ou vence em até 21 dias)
  useEffect(() => {
    if (!schemaOk || current) return
    let off = false
    Promise.all([listAllModels(), listServiceLog({ limit: 3000 })]).then(([ms, ls]) => {
      if (off) return
      const rows = []
      const counts = {}
      for (const m of ms) {
        if (m.status !== 'approved') continue
        const live = withServiceLog(m.layout, ls.filter(l => l.model_id === m.id))
        for (const r of careSchedule(live)) {
          if (r.status === 'overdue' || (r.status === 'due') || (r.daysLeft != null && r.daysLeft <= 21)) {
            rows.push({ ...r, model: m })
            counts[m.id] = counts[m.id] || { late: 0, soon: 0 }
            counts[m.id][r.status === 'overdue' ? 'late' : 'soon'] += 1
          }
        }
      }
      rows.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
      setDueAll(rows)
      setAllModels(ms.map(m => ({ ...m, due: counts[m.id] || null })))
    }).catch(() => { setDueAll([]); setAllModels([]) })
    return () => { off = true }
  }, [schemaOk, current])

  const client = clients.find(c => c.id === clientId)

  const newModel = async () => {
    if (!clientId) return
    const loc = newLocation || null
    try {
      const m = await createModel({
        clientId,
        locationName: loc,
        name: loc || client?.company_name || 'Store',
        layout: emptyLayout(),
      })
      setModels(ms => [...ms, m])
      openModel(m)
    } catch (e) {
      toast.error(e.message)
    }
  }

  // ---- edição ----
  const updateModel = (patch) => {
    setCurrent(m => ({ ...m, ...patch }))
    setDirty(true)
  }
  const updateLayout = (fn) => {
    setCurrent(m => ({ ...m, layout: fn(m.layout) }))
    setDirty(true)
  }
  const changeItem = (type, id, patch) => {
    const key = COLLECTION[type]
    updateLayout(l => ({ ...l, [key]: l[key].map(it => (it.id === id ? { ...it, ...patch } : it)) }))
  }
  // andar que está na tela: as ferramentas de montar só enxergam (e mexem) nele
  const onFloor = () => levelLayout(current.layout, level)
  const updateFloor = (fn) => updateLayout(l => mergeLevel(l, level, fn(levelLayout(l, level))))
  const tagLevel = level ? { level } : {}

  const persist = async (model = current, { quiet = false } = {}) => {
    setBusy('save')
    try {
      const saved = await saveModel(model)
      setCurrent(saved)
      setModels(ms => ms.map(m => (m.id === saved.id ? saved : m)))
      setDirty(false)
      if (!quiet) toast.success(t.saved)
      return saved
    } catch (e) {
      toast.error(e.message)
      return null
    } finally {
      setBusy('')
    }
  }

  const center = () => {
    const sel = selected?.type === 'area' ? current.layout.areas.find(a => a.id === selected.id && levelOf(a) === level) : null
    if (sel) return { x: sel.x + sel.w / 2, y: sel.y + sel.d / 2, areaId: sel.id }
    return { x: current.layout.width / 2, y: current.layout.depth / 2, areaId: null }
  }

  const addArea = () => {
    const id = newId('area')
    const { width, depth } = current.layout
    const w = Math.min(3, width)
    const d = Math.min(3, depth)
    updateLayout(l => ({
      ...l,
      areas: [...l.areas, { id, name: kindLabel(addAreaKind, lang, AREA_KINDS), kind: addAreaKind, x: (width - w) / 2, y: (depth - d) / 2, w, d, notes: '', ...tagLevel }],
    }))
    setSelected({ type: 'area', id })
    setMode('2d')
  }

  const addElement = () => {
    const id = newId('el')
    const c = center()
    const k = ELEMENT_KINDS[addElKind]
    updateLayout(l => normalizeLayout({
      ...l,
      elements: [...l.elements, {
        id, name: kindLabel(addElKind, lang), kind: addElKind, areaId: c.areaId,
        x: c.x - 0.4, y: c.y - 0.3, w: 0.8, d: 0.6, h: k.h, ...tagLevel,
      }],
    }))
    setSelected({ type: 'element', id })
  }

  const addWall = () => {
    const id = newId('wall')
    const { width, depth } = current.layout
    updateLayout(l => ({ ...l, walls: [...l.walls, { id, x1: width * 0.3, y1: depth / 2, x2: width * 0.7, y2: depth / 2, h: 2.4, ...tagLevel }] }))
    setSelected({ type: 'wall', id })
    setMode('2d')
  }

  const addOuterWalls = () => {
    updateFloor(l => ({ ...l, walls: [...l.walls, ...perimeterWalls(l.width, l.depth)] }))
  }

  // ---- montagem fácil ----
  const templateThumbs = useMemo(() => Object.fromEntries(STORE_TEMPLATES.map(tpl => [tpl.id, buildTemplate(tpl, { lang, fill: false })])), [lang])
  const previews = useMemo(() => Object.fromEntries(PLAN_PRESETS.map(p => [p, generatePlan({ width: plan.width, depth: plan.depth, preset: p, rooms: plan.rooms, lang })])), [plan.width, plan.depth, plan.rooms, lang])

  const buildPlan = () => {
    if (hasContent && !confirm(t.replaceConfirm)) return
    let l = generatePlan({ width: plan.width, depth: plan.depth, preset: plan.preset, rooms: plan.rooms, lang })
    if (plan.upper) l = addUpperFloor(l, plan.upper, { lang, fill: plan.fill })
    if (plan.fill) l = fillLevel(l, 0, lang)
    updateModel({ layout: l })
    setSelected(null)
    setLevel(0)
    setMode('3d')
    toast.success(fill(t.planBuilt, { rooms: l.areas.length, items: l.elements.length }))
  }

  /** Modelo pronto: um toque e a loja inteira já aparece (cômodos, equipamentos e andar de cima). */
  const buildFromTemplate = (tpl) => {
    if (hasContent && !confirm(t.replaceConfirm)) return
    const l = buildTemplate(tpl, { lang })
    updateModel({ layout: l })
    setPlan(p => ({ ...p, width: tpl.width, depth: tpl.depth, preset: tpl.preset, rooms: { ...tpl.rooms }, upper: tpl.upper || null }))
    setSelected(null)
    setLevel(0)
    setMode('3d')
    toast.success(fill(t.planBuilt, { rooms: l.areas.length, items: l.elements.length }))
    setTimeout(() => document.querySelector('.fac-studio-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }

  const addFloor = () => {
    const l = addUpperFloor(current.layout, upperKind, { lang })
    updateModel({ layout: l })
    setSelected(null)
    setLevel(1)
    toast.success(t.floorAdded)
  }
  const removeFloor = () => {
    if (!confirm(t.removeFloorConfirm)) return
    updateModel({ layout: removeUpperFloors(current.layout) })
    setSelected(null)
    setLevel(0)
  }

  const addFromPalette = (kind) => {
    const target = putIn || (selected?.type === 'area' ? selected.id : null)
    const res = placeItem(onFloor(), kind, { areaId: target, lang })
    updateFloor(() => res.layout)
    setSelected({ type: 'element', id: res.id })
    const area = res.layout.areas.find(a => a.id === res.areaId)
    toast.success(fill(t.itemAdded, { item: kindLabel(kind, lang), room: area?.name || '—' }))
  }

  const fillSelectedRoom = () => {
    if (selected?.type !== 'area') return
    const res = fillRoom(onFloor(), selected.id, lang)
    if (!res.added.length) return toast(t.roomEmptyKit)
    updateFloor(() => res.layout)
    toast.success(fill(t.roomFilled, { n: res.added.length }))
  }

  const quick = (fn) => {
    if (selected?.type !== 'element') return
    const el = current.layout.elements.find(e => e.id === selected.id)
    if (el) changeItem('element', el.id, fn(onFloor(), el))
  }

  const resizeSel = (factor) => quick((l, el) => {
    const w = Math.max(0.1, Math.round(el.w * factor * 100) / 100)
    const d = Math.max(0.1, Math.round(el.d * factor * 100) / 100)
    return { w, d, ...nudge(l, { ...el, w, d }, (el.w - w) / 2, (el.d - d) / 2) }
  })

  const duplicateSel = () => {
    const el = current.layout.elements.find(e => e.id === selected?.id)
    if (!el) return
    const res = duplicateItem(onFloor(), el, lang)
    updateFloor(() => res.layout)
    setSelected({ type: 'element', id: res.id })
  }

  const moveToRoom = (areaId) => {
    const el = current.layout.elements.find(e => e.id === selected?.id)
    if (!el || !areaId) return
    const floor = onFloor()
    const others = { ...floor, elements: floor.elements.filter(e => e.id !== el.id) }
    const res = placeItem(others, el.kind, { areaId, lang })
    const spot = res.layout.elements.find(e => e.id === res.id)
    changeItem('element', el.id, { x: spot.x, y: spot.y, w: spot.w, d: spot.d, areaId })
  }

  const setTasks = (el, tasks) => changeItem('element', el.id, { tasks })

  // ---- agenda: oferecer ou registrar feito ----
  const offer = async (row) => {
    setBusy(`offer:${row.element.id}:${row.task.id}`)
    try {
      const late = row.daysLeft != null && row.daysLeft < 0
      const reason = row.status === 'none'
        ? `No ${row.task.type} record for "${row.element.name}". Recommended every ${row.task.interval_days} days.`
        : `Last ${row.task.type} ${row.task.last}. ${late ? `${-row.daysLeft} days late` : `Due ${row.next}`} (every ${row.task.interval_days} days).`
      const r = await offerService({ model: current, element: row.element, task: row.task, reason, priority: late ? 'high' : 'medium' })
      toast.success(t.offered)
      void r
      await loadRecs(current.id)
    } catch (e) {
      toast.error(e.message)
    }
    setBusy('')
  }

  const doneToday = async (row) => {
    setBusy(`done:${row.element.id}:${row.task.id}`)
    try {
      await logElementService({ model: current, element: row.element, employee: { name: 'Admin' }, service: row.task.name })
      await loadRecs(current.id)
      toast.success(`✅ ${row.element.name} · ${row.task.name}`)
    } catch (e) {
      toast.error(e.message)
    }
    setBusy('')
  }

  const removeSelected = () => {
    if (!selected) return
    const key = COLLECTION[selected.type]
    updateLayout(l => ({
      ...l,
      [key]: l[key].filter(it => it.id !== selected.id),
      elements: selected.type === 'area'
        ? l.elements.map(el => (el.areaId === selected.id ? { ...el, areaId: null } : el))
        : (key === 'elements' ? l.elements.filter(it => it.id !== selected.id) : l.elements),
    }))
    setSelected(null)
  }

  // ---- fotos ----
  const uploadPhotos = async (files, elementId) => {
    if (!files?.length) return
    setBusy(elementId ? 'el-photo' : 'photos')
    const paths = []
    for (const [i, file] of [...files].entries()) {
      try {
        const name = elementId ? `el_${elementId}_${Date.now()}_${i}` : `${Date.now()}_${i}`
        paths.push(await uploadJobPhoto(`facility/${current.id}/${name}.jpg`, file))
      } catch (e) {
        toast.error(e.message)
      }
    }
    setBusy('')
    if (!paths.length) return
    if (elementId) {
      const el = current.layout.elements.find(e => e.id === elementId)
      changeItem('element', elementId, { photos: [...(el?.photos || []), ...paths] })
    } else {
      await persist({ ...current, photos: [...current.photos, ...paths] }, { quiet: true })
    }
  }

  const removePhoto = (path) => persist({ ...current, photos: current.photos.filter(p => p !== path) }, { quiet: true })

  const hasContent = current && (current.layout.areas.length || current.layout.elements.length)

  const generateAi = async () => {
    if (!current.photos.length) return toast.error(t.step1Hint)
    if (hasContent && !confirm(t.replaceConfirm)) return
    setBusy('ai')
    try {
      const resp = await apiPost('/api/admin-ai', {
        facilityAction: 'generate',
        photos: current.photos,
        name: current.name,
        width: current.layout.width,
        depth: current.layout.depth,
        hints,
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
      const saved = await persist({ ...current, layout: data.layout, ai_notes: data.notes, status: 'draft' }, { quiet: true })
      if (saved) {
        toast.success(t.aiDone)
        setMode('3d')
        setSelected(null)
      }
    } catch (e) {
      toast.error(e.message)
    }
    setBusy('')
  }

  // ---- construir aos poucos: cada foto nova, a IA acrescenta o que ela mostra ----
  const addPhotoToModel = async (photoRef, base = current) => {
    setBusy(`build:${photoRef}`)
    try {
      const resp = await apiPost('/api/admin-ai', {
        facilityAction: 'add-photo',
        photo: photoRef,
        layout: base.layout,
        caption,
        name: base.name,
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
      const merged = mergeLayoutAdditions(base.layout, data.additions, photoRef)
      const line = `📷 ${data.seen || t.photoAnalyzed}${merged.added.length ? ` → + ${merged.added.join(', ')}` : ''}${merged.updated.length ? ` · 📎 ${merged.updated.join(', ')}` : ''}`
      const photos = base.photos.includes(photoRef) ? base.photos : [...base.photos, photoRef]
      const saved = await persist({
        ...base,
        photos,
        layout: merged.layout,
        ai_notes: [base.ai_notes, line].filter(Boolean).join('\n').slice(-2000),
        status: 'draft',
      }, { quiet: true })
      if (saved) {
        setBuildLog(l => [{ photo: photoRef, line }, ...l])
        toast.success(merged.added.length ? fill(t.buildAdded, { n: merged.added.length }) : t.buildNothingNew)
        setCaption('')
        if (mode === '2d') setMode('3d')
      }
      return saved
    } catch (e) {
      toast.error(e.message)
      return null
    } finally {
      setBusy('')
    }
  }

  const uploadAndBuild = async (files) => {
    let base = current
    for (const [i, file] of [...files].entries()) {
      setBusy('photos')
      let ref
      try {
        ref = await uploadJobPhoto(`facility/${base.id}/${Date.now()}_${i}.jpg`, file)
      } catch (e) {
        toast.error(e.message)
        continue
      }
      const saved = await addPhotoToModel(ref, base)
      base = saved || { ...base, photos: [...base.photos, ref] }
    }
    setBusy('')
  }

  const useTemplate = () => {
    if (hasContent && !confirm(t.replaceConfirm)) return
    updateModel({ layout: restaurantTemplate(current.layout.width, current.layout.depth) })
    setSelected(null)
  }

  const toggleApprove = () => persist({ ...current, status: current.status === 'approved' ? 'draft' : 'approved' })

  const removeModel = async () => {
    if (!confirm(t.deleteConfirm)) return
    try {
      await deleteModel(current.id)
      setModels(ms => ms.filter(m => m.id !== current.id))
      setCurrent(null)
    } catch (e) {
      toast.error(e.message)
    }
  }

  // ---- recomendações ----
  const runRecommendations = async () => {
    let model = current
    if (dirty) model = await persist(current, { quiet: true })
    if (!model) return
    setBusy('recs')
    try {
      const r = await generateRecommendations(model)
      if (r.aiError) toast(t.aiUnavailable)
      toast.success(r.inserted ? fill(t.recsAdded, { n: r.inserted }) : t.recsNone)
      await loadRecs(model.id)
    } catch (e) {
      toast.error(e.message)
    }
    setBusy('')
  }

  const decide = async (rec, decision) => {
    setBusy(rec.id)
    try {
      await decideRecommendation(rec, decision, { by: 'admin' })
      await loadRecs(current.id)
    } catch (e) {
      toast.error(e.message)
    }
    setBusy('')
  }

  const removeLog = async (log) => {
    try {
      await deleteServiceLog(log.id)
      setLogs(ls => ls.filter(l => l.id !== log.id))
    } catch (e) {
      toast.error(e.message)
    }
  }

  const removeRec = async (rec) => {
    try {
      await deleteRecommendation(rec.id)
      setRecs(rs => rs.filter(r => r.id !== rec.id))
    } catch (e) {
      toast.error(e.message)
    }
  }

  const sortedRecs = useMemo(() => [...recs].sort((a, b) => {
    if ((a.status === 'pending') !== (b.status === 'pending')) return a.status === 'pending' ? -1 : 1
    return (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1)
  }), [recs])
  const alerts = useMemo(() => new Set(recs.filter(r => r.status === 'pending').map(r => r.element_id)), [recs])

  // ---- render ----
  if (schemaOk === false) {
    return (
      <div className="card" style={{ border: '2px solid #f87171' }}>
        <div className="card-title">🏢 {t.title}</div>
        <p style={{ fontSize: 14, color: 'var(--text2)' }}>{t.setupNeeded}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn btn-primary" onClick={runAutoSetup} disabled={setupBusy}>{setupBusy ? '...' : t.autoSetup}</button>
          <button type="button" className="btn" onClick={copySql}>{t.copySql}</button>
          <button type="button" className="btn" onClick={verifySchema}>{t.check}</button>
        </div>
        <textarea readOnly value={FACILITY_SETUP_SQL} onClick={e => e.target.select()} style={{ width: '100%', height: 120, marginTop: 14, fontSize: 10, fontFamily: 'monospace', boxSizing: 'border-box' }} />
      </div>
    )
  }

  if (!current) {
    const clientName = id => clients.find(c => c.id === id)?.company_name || ''
    const q = storeQuery.trim().toLowerCase()
    const stores = (allModels || []).filter(m => (!clientId || m.client_id === clientId)
      && (!q || `${m.name} ${m.location_name || ''} ${clientName(m.client_id)}`.toLowerCase().includes(q)))
    return (
      <div>
        <div className="card fac-home-head">
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="card-title" style={{ marginBottom: 2 }}>🏢 {t.title}</div>
            <div style={{ fontSize: 13, color: 'var(--text3)' }}>{t.homeHint}</div>
          </div>
          <input className="fac-home-search" value={storeQuery} onChange={e => setStoreQuery(e.target.value)} placeholder={t.searchStores} aria-label={t.searchStores} />
          <select className="fac-home-client" value={clientId} onChange={e => setClientId(e.target.value)} aria-label={t.client}>
            <option value="">{t.allClients}</option>
            {clients.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
          <button type="button" className="btn btn-primary" onClick={() => setShowNew(v => !v)}>＋ {t.newStore}</button>
        </div>

        {showNew && (
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-title" style={{ marginBottom: 8 }}>＋ {t.newStore}</div>
            <div className="grid-2">
              <div className="form-group">
                <label>{t.client}</label>
                <select value={clientId} onChange={e => setClientId(e.target.value)}>
                  <option value="">{t.selectClient}</option>
                  {clients.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>{t.location}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={newLocation} onChange={e => setNewLocation(e.target.value)} style={{ flex: 1 }} disabled={!clientId}>
                    <option value="">{t.wholeClient}</option>
                    {locations.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                  <button type="button" className="btn btn-primary" onClick={newModel} disabled={!clientId}>{t.create}</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {allModels === null && <div style={{ fontSize: 13, color: 'var(--text3)', margin: '10px 0' }}>…</div>}
        {allModels && stores.length === 0 && (
          <div className="card" style={{ fontSize: 13, color: 'var(--text3)' }}>{allModels.length ? t.noStoresMatch : t.noStoresYet}</div>
        )}
        <div className="fac-stores">
          {stores.map(m => (
            <button key={m.id} type="button" className="fac-store-card" onClick={() => openAny(m)}>
              <div className="fac-store-thumb">{m.layout.areas.length ? <PlanThumb layout={m.layout} /> : <span>🏢</span>}</div>
              <div className="fac-store-body">
                <div className="fac-store-name">{m.location_name || m.name}</div>
                <div className="fac-store-client">{clientName(m.client_id)}</div>
                <div className="fac-store-tags">
                  <span className={`badge ${m.status === 'approved' ? 'badge-green' : 'badge-amber'}`}>{m.status === 'approved' ? t.approved : t.draft}</span>
                  {m.due?.late > 0 && <span className="fac-store-due late">{fill(t.storeLate, { n: m.due.late })}</span>}
                  {m.due?.soon > 0 && <span className="fac-store-due soon">{fill(t.storeSoon, { n: m.due.soon })}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>

        {dueAll && dueAll.length > 0 && (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-title" style={{ marginBottom: 4 }}>📅 {t.allStoresTitle}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>{t.allStoresHint}</div>
            <CareList
              rows={clientId ? dueAll.filter(r => r.model.client_id === clientId) : dueAll}
              t={t}
              lang={lang}
              showElement
              limit={8}
              renderActions={r => (
                <>
                  <span style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'right' }}>{clientName(r.model.client_id)}<br />{r.model.location_name || r.model.name}</span>
                  <button type="button" className="btn btn-sm" onClick={() => openAny(r.model)}>{t.open}</button>
                </>
              )}
            />
          </div>
        )}
      </div>
    )
  }

  const layout = current.layout
  const liveLayout = withServiceLog(layout, logs)
  const floors = levelCount(layout)
  const shownLevel = Math.min(level, floors - 1)
  const floorLayout = levelLayout(layout, shownLevel)
  const liveFloor = levelLayout(liveLayout, shownLevel)
  const elStatus = statusMap(liveLayout)
  const todo = todoElementIds(recs)
  const schedule = careSchedule(liveLayout)
  const selArea = selected?.type === 'area' ? layout.areas.find(a => a.id === selected.id) : null
  const selEl = selected?.type === 'element' ? layout.elements.find(e => e.id === selected.id) : null
  const selWall = selected?.type === 'wall' ? layout.walls.find(w => w.id === selected.id) : null

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm" onClick={() => { if (!dirty || confirm('Discard unsaved changes?')) closeModel() }}>{t.back}</button>
            <input value={current.name} onChange={e => updateModel({ name: e.target.value })} style={{ fontWeight: 700, fontSize: 16, padding: '6px 10px', minWidth: 180 }} aria-label={t.modelName} />
            <span className={`badge ${current.status === 'approved' ? 'badge-green' : 'badge-amber'}`}>{current.status === 'approved' ? t.approved : t.draft}</span>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{client?.company_name}{current.location_name ? ` · ${current.location_name}` : ''}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy === 'save' || !dirty} onClick={() => persist()}>{t.save}{dirty ? ' •' : ''}</button>
            <button type="button" className="btn btn-sm" onClick={toggleApprove} disabled={busy === 'save'}>{current.status === 'approved' ? t.unapprove : t.approve}</button>
            <button type="button" className="btn btn-sm btn-danger" onClick={removeModel}>{t.delete}</button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title">{t.step1}</div>
        <div style={{ fontSize: 13, color: 'var(--text3)' }}>{t.step1Hint}</div>
        <div className="fac-thumbs">
          {current.photos.map(p => (
            <div key={p} className="fac-thumb">
              <img src={viewablePhotoUrl(p)} alt="" />
              <button type="button" onClick={() => removePhoto(p)} title={t.remove}>✕</button>
              <button type="button" className="fac-thumb-ai" disabled={busy.startsWith('build')} onClick={() => addPhotoToModel(p)} title={t.addToModel}>{busy === `build:${p}` ? '…' : '🤖 +'}</button>
            </div>
          ))}
        </div>
        <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
          {busy === 'photos' ? t.uploading : t.addPhotos}
          <input type="file" accept="image/*" multiple hidden disabled={busy === 'photos'} onChange={e => { uploadPhotos(e.target.files); e.target.value = '' }} />
        </label>
        <div className="fac-build">
          <div style={{ fontWeight: 700, fontSize: 14 }}>🧩 {t.buildTitle}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', margin: '4px 0 8px' }}>{t.buildHint}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={caption} onChange={e => setCaption(e.target.value)} placeholder={t.captionPlaceholder} style={{ flex: '1 1 220px', padding: '7px 10px' }} />
            <label className="btn btn-sm btn-primary" style={{ cursor: busy ? 'default' : 'pointer' }}>
              {busy === 'photos' ? t.uploading : busy.startsWith('build') ? t.buildWorking : t.buildButton}
              <input type="file" accept="image/*" capture="environment" multiple hidden disabled={!!busy} onChange={e => { uploadAndBuild(e.target.files); e.target.value = '' }} />
            </label>
          </div>
          {buildLog.length > 0 && (
            <ul className="fac-build-log">
              {buildLog.map(b => <li key={b.photo + b.line}>{b.line}</li>)}
            </ul>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title">{t.step2}</div>
        <div className="fac-seg" role="tablist">
          <button type="button" className={buildTab === 'quick' ? 'on' : ''} onClick={() => setBuildTab('quick')}>{t.quickBuild}</button>
          <button type="button" className={buildTab === 'ai' ? 'on' : ''} onClick={() => setBuildTab('ai')}>{t.fromPhotos}</button>
        </div>
        {buildTab === 'quick' ? (
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>⚡ {t.templatesTitle}</div>
            <div style={{ fontSize: 13, color: 'var(--text3)', margin: '2px 0 4px' }}>{t.templatesHint}</div>
            <div className="fac-presets fac-templates">
              {STORE_TEMPLATES.map(tpl => (
                <button key={tpl.id} type="button" className="fac-preset" onClick={() => buildFromTemplate(tpl)}>
                  <PlanThumb layout={templateThumbs[tpl.id]} />
                  <span className="fac-tpl-name">{tpl.icon} {t.tpl[tpl.id]}</span>
                  <span className="fac-tpl-size">{tpl.width}×{tpl.depth} m{tpl.upper ? ` · ${t.twoFloorsShort}` : ''}</span>
                </button>
              ))}
            </div>
            <details className="fac-details fac-custom">
            <summary>{t.customBuild}</summary>
            <div style={{ fontSize: 13, color: 'var(--text3)', margin: '6px 0 10px' }}>{t.quickHint}</div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{t.storeSize}</div>
            <div className="fac-toggles">
              {SIZES.map(z => (
                <button key={z.key} type="button" className={`fac-toggle${plan.width === z.w && plan.depth === z.d ? ' on' : ''}`} onClick={() => setPlan(p => ({ ...p, width: z.w, depth: z.d }))}>
                  {t[z.key]} · {z.w}×{z.d} m
                </button>
              ))}
            </div>
            <div className="grid-2">
              <NumField label={t.widthM} value={plan.width} min={3} step={0.5} onChange={v => setPlan(p => ({ ...p, width: Math.max(3, v || 3) }))} />
              <NumField label={t.depthM} value={plan.depth} min={3} step={0.5} onChange={v => setPlan(p => ({ ...p, depth: Math.max(3, v || 3) }))} />
            </div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{t.layoutStyle}</div>
            <div className="fac-presets">
              {PLAN_PRESETS.map(p => (
                <button key={p} type="button" className={`fac-preset${plan.preset === p ? ' on' : ''}`} onClick={() => setPlan(x => ({ ...x, preset: p }))}>
                  <PlanThumb layout={previews[p]} />
                  {t.preset[p]}
                </button>
              ))}
            </div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{t.extraRooms}</div>
            <div className="fac-toggles">
              {OPTIONAL_ROOMS.map(k => (
                <button key={k} type="button" className={`fac-toggle${plan.rooms[k] ? ' on' : ''}`} onClick={() => setPlan(p => ({ ...p, rooms: { ...p.rooms, [k]: !p.rooms[k] } }))}>
                  {AREA_KINDS[k].icon} {kindLabel(k, lang, AREA_KINDS)}
                </button>
              ))}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '4px 0 12px' }}>
              <input type="checkbox" checked={plan.fill} onChange={e => setPlan(p => ({ ...p, fill: e.target.checked }))} />
              {t.fillTypical}
            </label>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{t.secondFloor}</div>
            <div className="fac-toggles">
              {[null, ...UPPER_FLOORS].map(k => (
                <button key={k || 'none'} type="button" className={`fac-toggle${plan.upper === k ? ' on' : ''}`} onClick={() => setPlan(p => ({ ...p, upper: k }))}>
                  {k ? t.upper[k] : t.noUpper}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-primary" onClick={buildPlan}>{t.buildPlan}</button>
            </details>
          </div>
        ) : (
          <div>
            <div className="grid-2">
              <NumField label={t.widthM} value={layout.width} min={2} step={0.5} onChange={v => updateLayout(l => ({ ...l, width: Math.max(2, v || 2) }))} />
              <NumField label={t.depthM} value={layout.depth} min={2} step={0.5} onChange={v => updateLayout(l => ({ ...l, depth: Math.max(2, v || 2) }))} />
              <div className="form-group" style={{ gridColumn: '1/-1' }}>
                <label>{t.hints}</label>
                <textarea value={hints} onChange={e => setHints(e.target.value)} placeholder={t.hintsPlaceholder} />
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" className="btn btn-primary" onClick={generateAi} disabled={busy === 'ai'}>{busy === 'ai' ? t.generating : t.generateAi}</button>
              <button type="button" className="btn" onClick={useTemplate}>{t.useTemplate}</button>
            </div>
          </div>
        )}
        {current.ai_notes && (
          <div style={{ marginTop: 12, fontSize: 13, background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px', whiteSpace: 'pre-line' }}>
            <b>{t.aiNotes}:</b> {current.ai_notes}
          </div>
        )}
      </div>

      <div className="fac-studio-grid">
        <div className="card" style={{ marginTop: 0 }}>
          <div className="card-title">{t.step3}</div>
          <ViewModeChips mode={mode} setMode={setMode} t={t} allow2dEdit />
          <div className="fac-floorbar">
            {floors > 1 && Array.from({ length: floors }, (_, i) => (
              <button key={i} type="button" className={`fac-toggle${shownLevel === i ? ' on' : ''}`} onClick={() => { setLevel(i); setSelected(null) }}>
                {i === 0 ? `🏠 ${t.groundFloor}` : `⬆️ ${fill(t.upperFloorN, { n: i + 1 })}`}
              </button>
            ))}
            {floors < 2 ? (
              <span className="fac-floor-add">
                <select value={upperKind} onChange={e => setUpperKind(e.target.value)} aria-label={t.upperKind}>
                  {UPPER_FLOORS.map(k => <option key={k} value={k}>{t.upper[k]}</option>)}
                </select>
                <button type="button" className="btn btn-sm" onClick={addFloor}>➕ {t.addFloor}</button>
              </span>
            ) : (
              <button type="button" className="btn btn-sm" onClick={removeFloor}>🗑 {t.removeFloor}</button>
            )}
          </div>
          {mode === '2d' ? (
            <FacilityScene
              layout={floorLayout}
              mode="2d"
              rotation={rotation}
              selected={selected}
              onSelect={setSelected}
              editable
              onChange={changeItem}
              alerts={alerts}
              status={elStatus}
              todo={todo}
            />
          ) : (
            <div className="fac-dark" style={{ padding: 0 }}>
              <WorldView
                layout={liveFloor}
                mode={mode}
                selectedId={selected?.type === 'element' ? selected.id : null}
                onSelect={setSelected}
                status={elStatus}
                todo={todo}
                alerts={alerts}
                height={480}
                t={t}
                editable
                onMoveItem={(id, pos) => changeItem('element', id, pos)}
                onRotateItem={(id) => {
                  const el = current.layout.elements.find(e => e.id === id)
                  if (el) changeItem('element', id, rotate90(current.layout, el))
                }}
              />
            </div>
          )}
          <StatusLegend t={t} />
          {mode === '2d' && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>{t.dragHint}</div>}
          <div className="fac-details" style={{ padding: '10px 12px', marginTop: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>➕ {t.addItem}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', margin: '2px 0 6px' }}>{t.addItemHint}</div>
            <div className="fac-palette-tabs">
              {PALETTE.map(g => (
                <button key={g.id} type="button" className={`fac-chip${palTab === g.id ? ' on' : ''}`} onClick={() => setPalTab(g.id)}>{g.icon} {t.palette[g.id]}</button>
              ))}
            </div>
            <div className="fac-palette">
              {(PALETTE.find(g => g.id === palTab) || PALETTE[0]).kinds.map(k => (
                <button key={k} type="button" className="fac-pal-item" onClick={() => addFromPalette(k)}>
                  <span>{ELEMENT_KINDS[k].icon}</span>
                  <span>{kindLabel(k, lang)}</span>
                </button>
              ))}
            </div>
            {floorLayout.areas.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 10, fontSize: 13 }}>
                <span style={{ color: 'var(--text3)' }}>{t.putIn}:</span>
                <button type="button" className={`fac-chip${!putIn ? ' on' : ''}`} onClick={() => setPutIn('')}>✨ {t.autoRoom}</button>
                {floorLayout.areas.filter((a, i, all) => all.findIndex(b => b.name === a.name) === i).map(a => (
                  <button key={a.id} type="button" className={`fac-chip${putIn === a.id ? ' on' : ''}`} onClick={() => setPutIn(a.id)}>
                    {(AREA_KINDS[a.kind] || AREA_KINDS.other).icon} {a.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <details className="fac-details">
            <summary>{t.advanced}</summary>
            <div className="fac-toolbar">
              <select value={addAreaKind} onChange={e => setAddAreaKind(e.target.value)} style={{ padding: '5px 8px' }}>
                {Object.keys(AREA_KINDS).map(k => <option key={k} value={k}>{AREA_KINDS[k].icon} {kindLabel(k, lang, AREA_KINDS)}</option>)}
              </select>
              <button type="button" className="btn btn-sm" onClick={addArea}>{t.addArea}</button>
              <select value={addElKind} onChange={e => setAddElKind(e.target.value)} style={{ padding: '5px 8px' }}>
                {Object.keys(ELEMENT_KINDS).map(k => <option key={k} value={k}>{ELEMENT_KINDS[k].icon} {kindLabel(k, lang)}</option>)}
              </select>
              <button type="button" className="btn btn-sm" onClick={addElement}>{t.addElement}</button>
              <button type="button" className="btn btn-sm" onClick={addWall}>{t.addWall}</button>
              <button type="button" className="btn btn-sm" onClick={addOuterWalls}>{t.outerWalls}</button>
            </div>
          </details>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{t.areas}</div>
          <div className="fac-toolbar" style={{ marginTop: 4 }}>
            {floorLayout.areas.map(a => (
              <button key={a.id} type="button" className={`fac-chip${selected?.id === a.id ? ' on' : ''}`} onClick={() => setSelected({ type: 'area', id: a.id })}>
                {(AREA_KINDS[a.kind] || AREA_KINDS.other).icon} {a.name} · {areaSquareMeters(a)}㎡
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>{t.elements}</div>
          <div className="fac-toolbar" style={{ marginTop: 4 }}>
            {floorLayout.elements.map(el => (
              <button key={el.id} type="button" className={`fac-chip${selected?.id === el.id ? ' on' : ''}${alerts.has(el.id) ? ' alert' : ''}`} onClick={() => setSelected({ type: 'element', id: el.id })}>
                {(ELEMENT_KINDS[el.kind] || ELEMENT_KINDS.other).icon} {el.name}
              </button>
            ))}
          </div>
        </div>

        <div className="card" style={{ marginTop: 0 }}>
          {!selected && <div style={{ fontSize: 13, color: 'var(--text3)' }}>{t.noSelection}</div>}

          {selArea && (
            <>
              <div className="card-title">{(AREA_KINDS[selArea.kind] || AREA_KINDS.other).icon} {t.areas} · {areaSquareMeters(selArea)} ㎡</div>
              <div className="form-group" style={{ marginBottom: 8 }}><label>{t.name}</label><input value={selArea.name} onChange={e => changeItem('area', selArea.id, { name: e.target.value })} /></div>
              <div className="form-group" style={{ marginBottom: 8 }}><label>{t.kind}</label>
                <select value={selArea.kind} onChange={e => changeItem('area', selArea.id, { kind: e.target.value })}>
                  {Object.keys(AREA_KINDS).map(k => <option key={k} value={k}>{AREA_KINDS[k].icon} {kindLabel(k, lang, AREA_KINDS)}</option>)}
                </select>
              </div>
              <button type="button" className="btn btn-primary btn-sm" style={{ margin: '4px 0 8px' }} onClick={fillSelectedRoom}>{t.fillRoom}</button>
              <details className="fac-details">
                <summary>{t.exactSize}</summary>
                <div className="grid-2" style={{ gap: 8 }}>
                  <NumField label={t.x} value={selArea.x} onChange={v => changeItem('area', selArea.id, { x: v ?? 0 })} />
                  <NumField label={t.y} value={selArea.y} onChange={v => changeItem('area', selArea.id, { y: v ?? 0 })} />
                  <NumField label={t.w} value={selArea.w} onChange={v => changeItem('area', selArea.id, { w: Math.max(0.5, v || 0.5) })} />
                  <NumField label={t.d} value={selArea.d} onChange={v => changeItem('area', selArea.id, { d: Math.max(0.5, v || 0.5) })} />
                </div>
              </details>
              <div className="form-group"><label>{t.notes}</label><textarea value={selArea.notes} onChange={e => changeItem('area', selArea.id, { notes: e.target.value })} /></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-sm" onClick={() => setPreview(selected)}>{t.preview}</button>
                <button type="button" className="btn btn-sm btn-danger" onClick={removeSelected}>{t.remove}</button>
              </div>
            </>
          )}

          {selWall && (
            <>
              <div className="card-title">🧱 {t.walls}</div>
              <div className="grid-2" style={{ gap: 8 }}>
                <NumField label="X1" value={selWall.x1} onChange={v => changeItem('wall', selWall.id, { x1: v ?? 0 })} />
                <NumField label="Y1" value={selWall.y1} onChange={v => changeItem('wall', selWall.id, { y1: v ?? 0 })} />
                <NumField label="X2" value={selWall.x2} onChange={v => changeItem('wall', selWall.id, { x2: v ?? 0 })} />
                <NumField label="Y2" value={selWall.y2} onChange={v => changeItem('wall', selWall.id, { y2: v ?? 0 })} />
                <NumField label={t.h} value={selWall.h} onChange={v => changeItem('wall', selWall.id, { h: Math.max(0.3, v || 0.3) })} />
              </div>
              <button type="button" className="btn btn-sm btn-danger" onClick={removeSelected}>{t.remove}</button>
            </>
          )}

          {selEl && (
            <>
              <div className="card-title">{(ELEMENT_KINDS[selEl.kind] || ELEMENT_KINDS.other).icon} {selEl.name}</div>
              <div className="form-group" style={{ marginBottom: 8 }}><label>{t.name}</label><input value={selEl.name} onChange={e => changeItem('element', selEl.id, { name: e.target.value })} /></div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{t.moveHint}</div>
              <div className="fac-quick-row">
                <div className="fac-quick">
                  <span />
                  <button type="button" aria-label="up" onClick={() => quick((l, el) => nudge(l, el, 0, -0.25))}>⬆️</button>
                  <span />
                  <button type="button" aria-label="left" onClick={() => quick((l, el) => nudge(l, el, -0.25, 0))}>⬅️</button>
                  <button type="button" aria-label={t.rotate90} onClick={() => quick(rotate90)}>⟳</button>
                  <button type="button" aria-label="right" onClick={() => quick((l, el) => nudge(l, el, 0.25, 0))}>➡️</button>
                  <span />
                  <button type="button" aria-label="down" onClick={() => quick((l, el) => nudge(l, el, 0, 0.25))}>⬇️</button>
                  <span />
                </div>
                <div className="fac-quick-actions">
                  <button type="button" className="btn btn-sm" onClick={() => quick(rotate90)}>{t.rotate90}</button>
                  <button type="button" className="btn btn-sm" onClick={() => quick(snapToWall)}>{t.toWall}</button>
                  <button type="button" className="btn btn-sm" onClick={() => quick(centerInArea)}>{t.centerRoom}</button>
                  <button type="button" className="btn btn-sm" onClick={duplicateSel}>{t.duplicate}</button>
                  <button type="button" className="btn btn-sm" onClick={() => resizeSel(1.15)}>{t.bigger}</button>
                  <button type="button" className="btn btn-sm" onClick={() => resizeSel(1 / 1.15)}>{t.smaller}</button>
                </div>
              </div>
              <div className="grid-2" style={{ gap: 8 }}>
                <div className="form-group" style={{ marginBottom: 8 }}><label>{t.kind}</label>
                  <select value={selEl.kind} onChange={e => changeItem('element', selEl.id, { kind: e.target.value })}>
                    {Object.keys(ELEMENT_KINDS).map(k => <option key={k} value={k}>{ELEMENT_KINDS[k].icon} {kindLabel(k, lang)}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 8 }}><label>{t.moveToRoom}</label>
                  <select value={selEl.areaId || ''} onChange={e => (e.target.value ? moveToRoom(e.target.value) : changeItem('element', selEl.id, { areaId: null }))}>
                    <option value="">{t.autoArea}</option>
                    {floorLayout.areas.map(a => <option key={a.id} value={a.id}>{(AREA_KINDS[a.kind] || AREA_KINDS.other).icon} {a.name}</option>)}
                  </select>
                </div>
              </div>
              <details className="fac-details">
                <summary>{t.exactSize}</summary>
                <div className="grid-2" style={{ gap: 8 }}>
                  <NumField label={t.x} value={selEl.x} onChange={v => changeItem('element', selEl.id, { x: v ?? 0 })} />
                  <NumField label={t.y} value={selEl.y} onChange={v => changeItem('element', selEl.id, { y: v ?? 0 })} />
                  <NumField label={t.w} value={selEl.w} onChange={v => changeItem('element', selEl.id, { w: Math.max(0.1, v || 0.1) })} />
                  <NumField label={t.d} value={selEl.d} onChange={v => changeItem('element', selEl.id, { d: Math.max(0.1, v || 0.1) })} />
                  <NumField label={t.h} value={selEl.h} onChange={v => changeItem('element', selEl.id, { h: Math.max(0.02, v || 0.02) })} />
                </div>
              </details>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '2px 0 10px' }}>
                <input type="checkbox" checked={!!selEl.important} onChange={e => changeItem('element', selEl.id, { important: e.target.checked })} />
                ⭐ {t.importantToggle}
              </label>
              <TaskEditor el={selEl} care={liveLayout.elements.find(e => e.id === selEl.id)?.care} t={t} onChange={tasks => setTasks(selEl, tasks)} />
              <div className="form-group" style={{ marginBottom: 8 }}><label>{t.locationHint}</label><textarea value={selEl.location_hint} onChange={e => changeItem('element', selEl.id, { location_hint: e.target.value })} /></div>
              <div className="form-group" style={{ marginBottom: 8 }}><label>{t.instructions}</label><textarea value={selEl.instructions} onChange={e => changeItem('element', selEl.id, { instructions: e.target.value })} /></div>
              <div className="form-group" style={{ marginBottom: 8 }}><label>{t.notes}</label><textarea value={selEl.notes} onChange={e => changeItem('element', selEl.id, { notes: e.target.value })} /></div>
              <div style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 500 }}>{t.photos}</div>
              <div className="fac-thumbs">
                {selEl.photos.map(p => (
                  <div key={p} className="fac-thumb">
                    <img src={viewablePhotoUrl(p)} alt="" />
                    <button type="button" onClick={() => changeItem('element', selEl.id, { photos: selEl.photos.filter(x => x !== p) })}>✕</button>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                  {busy === 'el-photo' ? t.uploading : t.addPhotos}
                  <input type="file" accept="image/*" multiple hidden onChange={e => { uploadPhotos(e.target.files, selEl.id); e.target.value = '' }} />
                </label>
                <button type="button" className="btn btn-sm" onClick={() => setPreview(selected)}>{t.preview}</button>
                <button type="button" className="btn btn-sm btn-danger" onClick={removeSelected}>{t.remove}</button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title" style={{ marginBottom: 4 }}>📅 {t.scheduleTitle}</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>{t.scheduleHint}</div>
        {schedule.length === 0 && <div style={{ fontSize: 13, color: 'var(--text3)' }}>{t.scheduleEmpty}</div>}
        <CareList
          rows={schedule}
          t={t}
          lang={lang}
          showElement
          limit={10}
          onElement={el => setPreview({ type: 'element', id: el.id })}
          renderActions={r => {
            const offeredAlready = recs.some(x => x.element_id === r.element.id && x.status === 'pending' && String(x.service || '').toLowerCase() === r.task.name.toLowerCase())
            const key = `${r.element.id}:${r.task.id}`
            return (
              <>
                {r.status !== 'ok' && (
                  <button type="button" className="btn btn-sm btn-primary" disabled={offeredAlready || busy === `offer:${key}`} onClick={() => offer(r)}>
                    {offeredAlready ? t.offered : t.offer}
                  </button>
                )}
                <button type="button" className="btn btn-sm" disabled={busy === `done:${key}`} onClick={() => doneToday(r)}>{t.doneToday}</button>
              </>
            )
          }}
        />
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div className="card-title" style={{ marginBottom: 0 }}>🧽 {t.recTitle}</div>
          <button type="button" className="btn btn-sm btn-primary" onClick={runRecommendations} disabled={busy === 'recs'}>{busy === 'recs' ? '...' : t.generateRecs}</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', margin: '6px 0 10px' }}>{t.recHint}</div>
        {sortedRecs.length === 0 && <div style={{ fontSize: 13, color: 'var(--text3)' }}>{t.noRecs}</div>}
        <div style={{ background: '#0d1f35', color: '#fff', borderRadius: 12, padding: sortedRecs.length ? '2px 12px 12px' : 0 }}>
          {sortedRecs.map(r => (
            <div key={r.id}>
              <RecommendationCard
                rec={{ ...r }}
                t={{ ...t, accept: t.acceptOnBehalf }}
                onDecide={decide}
                busy={busy === r.id}
              />
              <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                <span>{r.source === 'ai' ? t.sourceAi : t.sourceRule} · {new Date(r.created_at).toLocaleDateString(localeOf(lang))}{r.decided_by ? ` · ${r.decided_by}` : ''}</span>
                <button type="button" onClick={() => removeRec(r)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>✕</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title" style={{ marginBottom: 4 }}>📋 {t.historyTitle}</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>{t.historyHint}</div>
        {logs.length === 0 && <div style={{ fontSize: 13, color: 'var(--text3)' }}>{t.noHistory}</div>}
        {logs.slice(0, 40).map(l => (
          <div key={l.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid var(--border)', fontSize: 13 }}>
            <span style={{ fontWeight: 700, minWidth: 84 }}>{l.service_date}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <button type="button" onClick={() => setPreview({ type: 'element', id: l.element_id })} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent, #c19c56)', fontWeight: 700, cursor: 'pointer' }}>{l.element_name}</button>
              {l.service ? ` · ${l.service}` : ''}
              <div style={{ color: 'var(--text3)', fontSize: 12 }}>{[l.employee_name, l.job_id ? t.fromJob : null, l.photos?.length ? `📷 ${l.photos.length}` : null].filter(Boolean).join(' · ')}</div>
              {l.notes && <div style={{ fontSize: 12 }}>{l.notes}</div>}
            </span>
            <button type="button" title={t.remove} onClick={() => removeLog(l)} style={{ background: 'none', border: 'none', color: 'inherit', opacity: 0.5, cursor: 'pointer' }}>✕</button>
          </div>
        ))}
      </div>

      {preview && (
        <FacilityItemPopup
          layout={liveLayout}
          item={preview}
          t={t}
          lang={lang}
          recs={recs}
          logs={logs}
          todo={todo}
          onClose={() => setPreview(null)}
          onSelectItem={setPreview}
        />
      )}
    </div>
  )
}
