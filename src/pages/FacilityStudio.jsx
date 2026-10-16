import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { apiFetch, apiPost } from '../lib/apiFetch'
import { uploadJobPhoto } from '../lib/uploadPhoto'
import { viewablePhotoUrl } from '../lib/photoUrl'
import { useLang, fill } from '../hooks/useLang'
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
  areaSquareMeters,
  PRIORITY_ORDER,
  withServiceLog,
  statusMap,
  todoElementIds,
} from '../lib/facilityModel'
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
} from '../lib/facilityApi'
import FacilityScene from '../components/facility/FacilityScene'
import { StatusLegend } from '../components/facility/FacilityViewer'
import FacilityItemPopup, { RecommendationCard } from '../components/facility/FacilityItemPopup'

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

/** Aba "Smart Facility" da área Clientes: fotos → modelo inicial (IA) → edição → aprovação. */
export default function FacilityStudio({ clients, initialClientId }) {
  const { lang, t: tr } = useLang()
  const t = tr.facility
  const [schemaOk, setSchemaOk] = useState(null)
  const [setupBusy, setSetupBusy] = useState(false)
  const [clientId, setClientId] = useState(initialClientId || '')
  const [locations, setLocations] = useState([])
  const [models, setModels] = useState([])
  const [current, setCurrent] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [selected, setSelected] = useState(null)
  const [preview, setPreview] = useState(null)
  const [mode, setMode] = useState('3d')
  const [rotation, setRotation] = useState(-30)
  const [hints, setHints] = useState('')
  const [busy, setBusy] = useState('')
  const [recs, setRecs] = useState([])
  const [logs, setLogs] = useState([])
  const [newLocation, setNewLocation] = useState('')
  const [addAreaKind, setAddAreaKind] = useState('kitchen')
  const [addElKind, setAddElKind] = useState('range_hood')

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
    loadClient(clientId)
  }, [clientId, schemaOk, loadClient])

  const loadRecs = useCallback(async (modelId) => {
    try { setRecs(await listRecommendations({ modelId })) } catch { setRecs([]) }
    setLogs(await listServiceLog({ modelId }))
  }, [])

  const openModel = (m) => {
    setCurrent(m)
    setDirty(false)
    setSelected(null)
    loadRecs(m.id)
  }

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
    const sel = selected?.type === 'area' ? current.layout.areas.find(a => a.id === selected.id) : null
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
      areas: [...l.areas, { id, name: kindLabel(addAreaKind, lang, AREA_KINDS), kind: addAreaKind, x: (width - w) / 2, y: (depth - d) / 2, w, d, notes: '' }],
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
        x: c.x - 0.4, y: c.y - 0.3, w: 0.8, d: 0.6, h: k.h,
      }],
    }))
    setSelected({ type: 'element', id })
  }

  const addWall = () => {
    const id = newId('wall')
    const { width, depth } = current.layout
    updateLayout(l => ({ ...l, walls: [...l.walls, { id, x1: width * 0.3, y1: depth / 2, x2: width * 0.7, y2: depth / 2, h: 2.4 }] }))
    setSelected({ type: 'wall', id })
    setMode('2d')
  }

  const addOuterWalls = () => {
    updateLayout(l => ({ ...l, walls: [...l.walls, ...perimeterWalls(l.width, l.depth)] }))
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
    return (
      <div>
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-title">🏢 {t.title}</div>
          <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 14, lineHeight: 1.5 }}>{t.subtitle}</div>
          <div className="grid-2">
            <div className="form-group">
              <label>{t.client}</label>
              <select value={clientId} onChange={e => setClientId(e.target.value)}>
                <option value="">{t.selectClient}</option>
                {clients.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
            {clientId && (
              <div className="form-group">
                <label>{t.location}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={newLocation} onChange={e => setNewLocation(e.target.value)} style={{ flex: 1 }}>
                    <option value="">{t.wholeClient}</option>
                    {locations.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                  <button type="button" className="btn btn-primary" onClick={newModel}>{t.newModel}</button>
                </div>
              </div>
            )}
          </div>
        </div>
        {clientId && (
          <div className="card">
            <div className="card-title">{t.models} ({models.length})</div>
            {models.length === 0 && <div style={{ fontSize: 13, color: 'var(--text3)' }}>{t.noModels}</div>}
            {models.map(m => (
              <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{m.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                    {m.location_name || t.wholeClient} · {m.layout.areas.length} {t.areas.toLowerCase()} · {m.layout.elements.length} {t.elements.toLowerCase()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className={`badge ${m.status === 'approved' ? 'badge-green' : 'badge-amber'}`}>{m.status === 'approved' ? t.approved : t.draft}</span>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => openModel(m)}>✏️</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const layout = current.layout
  const liveLayout = withServiceLog(layout, logs)
  const elStatus = statusMap(liveLayout)
  const todo = todoElementIds(recs)
  const selArea = selected?.type === 'area' ? layout.areas.find(a => a.id === selected.id) : null
  const selEl = selected?.type === 'element' ? layout.elements.find(e => e.id === selected.id) : null
  const selWall = selected?.type === 'wall' ? layout.walls.find(w => w.id === selected.id) : null

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm" onClick={() => { if (!dirty || confirm('Discard unsaved changes?')) { setCurrent(null); loadClient(clientId) } }}>{t.back}</button>
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
            </div>
          ))}
        </div>
        <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
          {busy === 'photos' ? t.uploading : t.addPhotos}
          <input type="file" accept="image/*" multiple hidden disabled={busy === 'photos'} onChange={e => { uploadPhotos(e.target.files); e.target.value = '' }} />
        </label>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-title">{t.step2}</div>
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
        {current.ai_notes && (
          <div style={{ marginTop: 12, fontSize: 13, background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px', whiteSpace: 'pre-line' }}>
            <b>{t.aiNotes}:</b> {current.ai_notes}
          </div>
        )}
      </div>

      <div className="fac-studio-grid">
        <div className="card" style={{ marginTop: 0 }}>
          <div className="card-title">{t.step3}</div>
          <div className="fac-toolbar">
            <button type="button" className={`fac-chip${mode === '3d' ? ' on' : ''}`} onClick={() => setMode('3d')}>{t.view3d}</button>
            <button type="button" className={`fac-chip${mode === '2d' ? ' on' : ''}`} onClick={() => setMode('2d')}>{t.view2d}</button>
            {mode === '3d' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                {t.rotate}
                <input type="range" min={-180} max={180} value={rotation} onChange={e => setRotation(Number(e.target.value))} />
              </label>
            )}
          </div>
          <FacilityScene
            layout={layout}
            mode={mode}
            rotation={rotation}
            selected={selected}
            onSelect={setSelected}
            editable
            onChange={changeItem}
            alerts={alerts}
            status={elStatus}
            todo={todo}
          />
          <StatusLegend t={t} />
          {mode === '2d' && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>{t.dragHint}</div>}
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
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{t.areas}</div>
          <div className="fac-toolbar" style={{ marginTop: 4 }}>
            {layout.areas.map(a => (
              <button key={a.id} type="button" className={`fac-chip${selected?.id === a.id ? ' on' : ''}`} onClick={() => setSelected({ type: 'area', id: a.id })}>
                {(AREA_KINDS[a.kind] || AREA_KINDS.other).icon} {a.name} · {areaSquareMeters(a)}㎡
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>{t.elements}</div>
          <div className="fac-toolbar" style={{ marginTop: 4 }}>
            {layout.elements.map(el => (
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
              <div className="grid-2" style={{ gap: 8 }}>
                <NumField label={t.x} value={selArea.x} onChange={v => changeItem('area', selArea.id, { x: v ?? 0 })} />
                <NumField label={t.y} value={selArea.y} onChange={v => changeItem('area', selArea.id, { y: v ?? 0 })} />
                <NumField label={t.w} value={selArea.w} onChange={v => changeItem('area', selArea.id, { w: Math.max(0.5, v || 0.5) })} />
                <NumField label={t.d} value={selArea.d} onChange={v => changeItem('area', selArea.id, { d: Math.max(0.5, v || 0.5) })} />
              </div>
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
              <div className="grid-2" style={{ gap: 8 }}>
                <div className="form-group" style={{ marginBottom: 8 }}><label>{t.kind}</label>
                  <select value={selEl.kind} onChange={e => changeItem('element', selEl.id, { kind: e.target.value })}>
                    {Object.keys(ELEMENT_KINDS).map(k => <option key={k} value={k}>{ELEMENT_KINDS[k].icon} {kindLabel(k, lang)}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 8 }}><label>{t.area}</label>
                  <select value={selEl.areaId || ''} onChange={e => changeItem('element', selEl.id, { areaId: e.target.value || null })}>
                    <option value="">{t.autoArea}</option>
                    {layout.areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <NumField label={t.x} value={selEl.x} onChange={v => changeItem('element', selEl.id, { x: v ?? 0 })} />
                <NumField label={t.y} value={selEl.y} onChange={v => changeItem('element', selEl.id, { y: v ?? 0 })} />
                <NumField label={t.w} value={selEl.w} onChange={v => changeItem('element', selEl.id, { w: Math.max(0.1, v || 0.1) })} />
                <NumField label={t.d} value={selEl.d} onChange={v => changeItem('element', selEl.id, { d: Math.max(0.1, v || 0.1) })} />
                <NumField label={t.h} value={selEl.h} onChange={v => changeItem('element', selEl.id, { h: Math.max(0.02, v || 0.02) })} />
                <NumField label={t.intervalDays} value={selEl.service_interval_days} step={1} min={1} onChange={v => changeItem('element', selEl.id, { service_interval_days: v })} />
              </div>
              <div className="form-group" style={{ marginBottom: 8 }}><label>{t.lastServiced}</label>
                <input type="date" value={selEl.last_serviced_at || ''} onChange={e => changeItem('element', selEl.id, { last_serviced_at: e.target.value || null })} />
              </div>
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
                <span>{r.source === 'ai' ? t.sourceAi : t.sourceRule} · {new Date(r.created_at).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-GB')}{r.decided_by ? ` · ${r.decided_by}` : ''}</span>
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
