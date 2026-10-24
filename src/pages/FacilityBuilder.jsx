import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useLang, fill } from '../hooks/useLang'
import { uploadJobPhoto } from '../lib/uploadPhoto'
import { viewablePhotoUrl } from '../lib/photoUrl'
import {
  AREA_KINDS, ELEMENT_KINDS, kindLabel, newId, normalizeLayout, levelCount, levelLayout, mergeLevel, emptyLayout,
} from '../lib/facilityModel'
import {
  PALETTE, STORE_TEMPLATES, UPPER_FLOORS, buildTemplate, placeItem, rotate90, duplicateItem, fillRoom, addUpperFloor, removeUpperFloors,
} from '../lib/facilityBuilder'
import { createModel, getModel, saveModel } from '../lib/facilityApi'
import { PlanThumb, TaskEditor } from './FacilityStudio'
import '../components/facility/facility.css'
import '../components/facility/world.css'
import '../components/facility/builder.css'

// three.js só é baixado quando o editor abre
const FacilityWorld = lazy(() => import('../components/facility/FacilityWorld'))

const COLLECTION = { area: 'areas', element: 'elements', wall: 'walls' }
const HISTORY = 60
const SIZE_SCALE = [{ key: 'sizeSmall', k: 0.75 }, { key: 'sizeMedium', k: 1 }, { key: 'sizeLarge', k: 1.4 }]
const r1 = v => Math.round(v * 2) / 2

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

/**
 * Editor da planta em tela cheia (estilo The Sims): o 3D ocupa tudo, catálogo à esquerda,
 * barra flutuante no item tocado (Mover · Girar · Duplicar · Detalhes · Apagar), Desfazer/Refazer e salvamento automático.
 * Sem ?model= abre "Nova loja" com 3 perguntas (tipo, tamanho, andares). O estúdio antigo fica em /facility/studio (Avançado).
 */
export default function FacilityBuilder() {
  const [params] = useSearchParams()
  const id = params.get('model')
  return id ? <Editor key={id} modelId={id} /> : <NewStore initialClient={params.get('client') || ''} />
}

function Editor({ modelId }) {
  const { t: tr, lang } = useLang()
  const t = tr.facility
  const b = t.build
  const navigate = useNavigate()
  const rootRef = useRef(null)
  const { w: rootW, h: rootH } = useBoxSize(rootRef)
  const mobile = rootW > 0 && rootW < 760

  const [model, setModel] = useState(null)
  const [missing, setMissing] = useState(false)
  const [doc, setDoc] = useState(null)
  const layout = doc?.layout || null
  const [level, setLevel] = useState(0)
  const [selected, setSelected] = useState(null)
  const [catalog, setCatalog] = useState(true)
  const [catTab, setCatTab] = useState('kitchen')
  const [target, setTarget] = useState('')
  const [details, setDetails] = useState(false)
  const [moving, setMoving] = useState(false)
  const [moveSignal, setMoveSignal] = useState(0)
  const [save, setSave] = useState('saved')
  const [upperKind, setUpperKind] = useState('dining')
  const dirtyRef = useRef(false)
  const latest = useRef({ model: null, layout: null })
  latest.current = { model, layout }

  useEffect(() => {
    getModel(modelId).then(m => {
      if (!m) { setMissing(true); return }
      setModel(m)
      setDoc({ layout: m.layout, past: [], future: [] })
    }).catch(() => setMissing(true))
  }, [modelId])
  useEffect(() => { if (mobile) setCatalog(false) }, [mobile])

  // ---- histórico: toda mudança passa por aqui (digitação no mesmo campo vira um passo só) ----
  const lastKey = useRef({ key: null, at: 0 })
  const markDirty = () => { dirtyRef.current = true; setSave('dirty') }
  const commit = useCallback((next, key = null) => {
    const now = Date.now()
    const merge = key && lastKey.current.key === key && now - lastKey.current.at < 1500
    lastKey.current = { key, at: now }
    setDoc(d => (!d || next === d.layout ? d : {
      layout: next,
      past: merge ? d.past : [...d.past, d.layout].slice(-HISTORY),
      future: [],
    }))
    markDirty()
  }, [])
  const undo = useCallback(() => {
    lastKey.current = { key: null, at: 0 }
    setDoc(d => (d?.past.length ? { layout: d.past[d.past.length - 1], past: d.past.slice(0, -1), future: [d.layout, ...d.future].slice(0, HISTORY) } : d))
    markDirty()
  }, [])
  const redo = useCallback(() => {
    lastKey.current = { key: null, at: 0 }
    setDoc(d => (d?.future.length ? { layout: d.future[0], past: [...d.past, d.layout].slice(-HISTORY), future: d.future.slice(1) } : d))
    markDirty()
  }, [])

  // ---- salvamento automático ----
  const flush = useCallback(async () => {
    const { model: m, layout: l } = latest.current
    if (!m || !l || !dirtyRef.current) return
    dirtyRef.current = false
    setSave('saving')
    try {
      const saved = await saveModel({ ...m, layout: l })
      setModel(cur => ({ ...cur, updated_at: saved?.updated_at, status: saved?.status ?? cur.status }))
      setSave(dirtyRef.current ? 'dirty' : 'saved')
    } catch {
      dirtyRef.current = true
      setSave('error')
    }
  }, [])
  useEffect(() => {
    if (save !== 'dirty' && save !== 'error') return
    const tm = setTimeout(flush, save === 'error' ? 4000 : 1200)
    return () => clearTimeout(tm)
  }, [save, layout, flush])
  useEffect(() => {
    const warn = e => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => { window.removeEventListener('beforeunload', warn); flush() }
  }, [flush])

  const floors = layout ? levelCount(layout) : 1
  const shown = Math.min(level, floors - 1)
  const floorLayout = useMemo(() => (layout ? levelLayout(layout, shown) : null), [layout, shown])
  const updateFloor = (fn) => commit(mergeLevel(layout, shown, fn(floorLayout)))
  const tagLevel = shown ? { level: shown } : {}

  const selItem = selected && layout ? layout[COLLECTION[selected.type]]?.find(x => x.id === selected.id) : null
  useEffect(() => { if (selected && !selItem) { setSelected(null); setDetails(false) } }, [selItem, selected])

  const changeItem = (type, id, patch, typingKey = null) => {
    const key = COLLECTION[type]
    commit({ ...layout, [key]: layout[key].map(it => (it.id === id ? { ...it, ...patch } : it)) }, typingKey)
  }

  // ---- ações ----
  const addKind = (kind) => {
    const areaId = target || (selected?.type === 'area' ? selected.id : null)
    const res = placeItem(floorLayout, kind, { areaId, lang })
    updateFloor(() => res.layout)
    setSelected({ type: 'element', id: res.id })
    if (mobile) setCatalog(false)
  }
  const addRoom = (kind) => {
    const { width, depth } = floorLayout
    const w = Math.min(3, width)
    const d = Math.min(3, depth)
    const nid = newId('area')
    commit({ ...layout, areas: [...layout.areas, { id: nid, name: kindLabel(kind, lang, AREA_KINDS), kind, x: r1((width - w) / 2), y: r1((depth - d) / 2), w, d, notes: '', ...tagLevel }] })
    setSelected({ type: 'area', id: nid })
    setDetails(true)
    if (mobile) setCatalog(false)
  }
  const rotateSel = (elId = selected?.id) => {
    const el = layout.elements.find(e => e.id === elId)
    if (el) changeItem('element', el.id, rotate90(layout, el))
  }
  const duplicateSel = () => {
    if (selected?.type !== 'element') return
    const res = duplicateItem(floorLayout, selItem, lang)
    updateFloor(() => res.layout)
    setSelected({ type: 'element', id: res.id })
  }
  const fillSel = () => {
    if (selected?.type !== 'area') return
    const res = fillRoom(floorLayout, selected.id, lang)
    if (!res.added.length) return toast(t.roomEmptyKit)
    updateFloor(() => res.layout)
    toast.success(fill(t.roomFilled, { n: res.added.length }))
  }
  const removeSel = () => {
    if (!selected) return
    const key = COLLECTION[selected.type]
    commit({
      ...layout,
      [key]: layout[key].filter(it => it.id !== selected.id),
      ...(selected.type === 'area' ? { elements: layout.elements.map(el => (el.areaId === selected.id ? { ...el, areaId: null } : el)) } : {}),
    })
    setSelected(null)
    setDetails(false)
    toast(b.removed, { icon: '🗑' })
  }
  const addFloor = () => {
    commit(addUpperFloor(layout, upperKind, { lang }))
    setLevel(1)
    setSelected(null)
    toast.success(t.floorAdded)
  }
  const removeFloor = () => {
    commit(removeUpperFloors(layout))
    setLevel(0)
    setSelected(null)
  }
  const togglePublish = async () => {
    const status = model.status === 'approved' ? 'draft' : 'approved'
    setModel(m => ({ ...m, status }))
    latest.current.model = { ...latest.current.model, status }
    dirtyRef.current = true
    await flush()
    toast.success(status === 'approved' ? b.publishedHint : b.draftHint)
  }
  const addPhotos = async (files) => {
    if (!files?.length || selected?.type !== 'element') return
    const elId = selected.id
    const paths = []
    for (const [i, file] of [...files].entries()) {
      try { paths.push(await uploadJobPhoto(`facility/${model.id}/el_${elId}_${Date.now()}_${i}.jpg`, file)) } catch (e) { toast.error(e.message) }
    }
    if (!paths.length) return
    const el = latest.current.layout.elements.find(e => e.id === elId)
    changeItem('element', elId, { photos: [...(el?.photos || []), ...paths] })
  }

  // atalhos: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, Delete, D duplica, R gira
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
      else if (!mod && !moving && (e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); removeSel() }
      else if (!mod && !moving && (e.key === 'd' || e.key === 'D') && selected?.type === 'element') duplicateSel()
      else if (!mod && !moving && (e.key === 'r' || e.key === 'R') && selected?.type === 'element') rotateSel()
      else if (e.key === 'Escape' && !moving) { setSelected(null); setDetails(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (missing) return <div className="kw-root" ref={rootRef}><div className="kw-loading">{b.notFound}</div></div>
  if (!layout) return <div className="kw-root" ref={rootRef}><div className="kw-loading">{b.loading}</div></div>

  const selIcon = selected?.type === 'area' ? (AREA_KINDS[selItem?.kind] || AREA_KINDS.other).icon : (ELEMENT_KINDS[selItem?.kind] || ELEMENT_KINDS.other).icon
  const saveLabel = { saved: `✓ ${b.saved}`, saving: b.saving, dirty: b.unsaved, error: b.saveError }[save]
  const areasHere = floorLayout.areas
  const panelOpen = details && selItem

  return (
    <div className="kw-root kb-root" ref={rootRef}>
      <div className="kw-stage">
        <Suspense fallback={<div className="kw-loading">{t.loading3d}</div>}>
          <FacilityWorld
            layout={floorLayout}
            mode="orbit"
            selectedId={selected?.type === 'element' ? selected.id : null}
            onSelect={item => { setSelected(item); if (!item) setDetails(false) }}
            height={Math.max(320, rootH)}
            labels={{ no3d: t.no3d, moveTop: t.moveTop, moveHint: t.moveDragHint, moveBlocked: t.moveBlocked, rotate: t.moveRotate, done: t.moveDone }}
            editable
            hideMoveButton
            moveSignal={moveSignal}
            onMovingChange={setMoving}
            onMoveItem={(elId, pos) => changeItem('element', elId, pos)}
            onRotateItem={rotateSel}
          />
        </Suspense>
      </div>

      {/* topo */}
      <div className="kw-hud kw-hud-tl">
        <button type="button" className="kw-back" onClick={async () => { await flush(); navigate(`/facility?model=${model.id}`) }}>‹ {b.back}</button>
        <div className="kw-brand kw-store-name"><span><strong>✏️ {model.name}</strong><small className={`kb-save ${save}`}>{saveLabel}</small></span></div>
        <div className="kb-undo">
          <button type="button" className="kw-round" onClick={undo} disabled={!doc.past.length} title={`${b.undo} (Ctrl+Z)`} aria-label={b.undo}>↶</button>
          <button type="button" className="kw-round" onClick={redo} disabled={!doc.future.length} title={`${b.redo} (Ctrl+Shift+Z)`} aria-label={b.redo}>↷</button>
        </div>
      </div>
      <div className="kw-hud kw-hud-tr kw-actions">
        <div className="kw-floors">
          {Array.from({ length: floors }, (_, i) => (
            <button key={i} type="button" className={shown === i ? 'on' : ''} onClick={() => { setLevel(i); setSelected(null) }}>{i === 0 ? t.groundFloor : `${i + 1}F`}</button>
          ))}
          {floors < 2 ? (
            <span className="kb-addfloor">
              <select value={upperKind} onChange={e => setUpperKind(e.target.value)} aria-label={t.upperKind}>
                {UPPER_FLOORS.map(k => <option key={k} value={k}>{t.upper?.[k] || k}</option>)}
              </select>
              <button type="button" onClick={addFloor}>{b.addFloor}</button>
            </span>
          ) : (
            <button type="button" onClick={removeFloor} title={b.removeFloor}>－</button>
          )}
        </div>
        <button type="button" className={`kw-chip-btn kb-publish${model.status === 'approved' ? ' on' : ''}`} onClick={togglePublish} title={model.status === 'approved' ? b.publishedHint : b.draftHint}>
          {model.status === 'approved' ? `🟢 ${b.approved}` : `📝 ${b.draft} · ${b.approve}`}
        </button>
        <button type="button" className="kw-chip-btn" onClick={async () => { await flush(); navigate(`/facility/studio?model=${model.id}`) }} title={b.aiHelp}>⚙️ <span>{b.advanced}</span></button>
      </div>

      {/* catálogo */}
      {!moving && (
        <aside className={`kb-catalog${catalog ? ' open' : ''}${mobile ? ' sheet' : ''}`}>
          <button type="button" className="kb-catalog-head" onClick={() => setCatalog(v => !v)} aria-expanded={catalog}>
            <span>🧰 {b.catalog}</span><i aria-hidden="true">{catalog ? (mobile ? '▾' : '‹') : (mobile ? '▴' : '›')}</i>
          </button>
          {catalog && (
            <>
              <div className="kb-tabs">
                {PALETTE.map(g => (
                  <button key={g.id} type="button" className={catTab === g.id ? 'on' : ''} onClick={() => setCatTab(g.id)} title={t.palette?.[g.id]}>{g.icon}<span>{t.palette?.[g.id]}</span></button>
                ))}
                <button type="button" className={catTab === 'rooms' ? 'on' : ''} onClick={() => setCatTab('rooms')}>🧱<span>{b.rooms}</span></button>
              </div>
              {catTab !== 'rooms' && (
                <label className="kb-target">
                  <span>{b.addTo}</span>
                  <select value={target} onChange={e => setTarget(e.target.value)}>
                    <option value="">✨ {b.autoRoom}</option>
                    {areasHere.map(a => <option key={a.id} value={a.id}>{(AREA_KINDS[a.kind] || AREA_KINDS.other).icon} {a.name}</option>)}
                  </select>
                </label>
              )}
              <div className="kb-grid">
                {catTab === 'rooms'
                  ? Object.keys(AREA_KINDS).map(k => (
                    <button key={k} type="button" className="kb-tile" onClick={() => addRoom(k)}>
                      <span className="kb-tile-ico" style={{ background: `${AREA_KINDS[k].color}33` }}>{AREA_KINDS[k].icon}</span>
                      <small>{kindLabel(k, lang, AREA_KINDS)}</small>
                    </button>
                  ))
                  : (PALETTE.find(g => g.id === catTab)?.kinds || []).map(k => (
                    <button key={k} type="button" className="kb-tile" onClick={() => addKind(k)}>
                      <span className="kb-tile-ico">{(ELEMENT_KINDS[k] || ELEMENT_KINDS.other).icon}</span>
                      <small>{kindLabel(k, lang)}</small>
                    </button>
                  ))}
              </div>
            </>
          )}
        </aside>
      )}

      {/* barra flutuante do item tocado */}
      {selItem && !moving && !(mobile && panelOpen) && (
        <div className="kb-bar" role="toolbar" aria-label={selItem.name}>
          <div className="kb-bar-name"><span aria-hidden="true">{selIcon}</span><strong>{selItem.name}</strong></div>
          {selected.type === 'element' ? (
            <>
              <button type="button" onClick={() => setMoveSignal(n => n + 1)}>✥<span>{b.move}</span></button>
              <button type="button" onClick={() => rotateSel()}>⟳<span>{b.rotate}</span></button>
              <button type="button" onClick={duplicateSel}>⧉<span>{b.duplicate}</span></button>
            </>
          ) : (
            <button type="button" onClick={fillSel}>✨<span>{b.fillRoom}</span></button>
          )}
          <button type="button" className={details ? 'on' : ''} onClick={() => setDetails(v => !v)}>ⓘ<span>{b.details}</span></button>
          <button type="button" className="danger" onClick={removeSel}>🗑<span>{b.remove}</span></button>
          <button type="button" className="kb-bar-x" onClick={() => { setSelected(null); setDetails(false) }} aria-label={b.close}>✕</button>
        </div>
      )}
      {!selItem && !moving && !mobile && <div className="kw-help kb-help">{b.tapHint}</div>}

      {/* detalhes */}
      {panelOpen && !moving && (
        <aside className={`kb-panel${mobile ? ' sheet' : ''}`}>
          <div className="kb-panel-head">
            <strong>{selIcon} {b.details}</strong>
            <button type="button" className="kw-round" onClick={() => setDetails(false)} aria-label={b.close}>✕</button>
          </div>
          <label className="kb-field"><span>{b.name}</span>
            <input value={selItem.name} onChange={e => changeItem(selected.type, selItem.id, { name: e.target.value }, `name:${selItem.id}`)} />
          </label>
          <label className="kb-field"><span>{b.kind}</span>
            <select value={selItem.kind} onChange={e => changeItem(selected.type, selItem.id, { kind: e.target.value })}>
              {Object.keys(selected.type === 'area' ? AREA_KINDS : ELEMENT_KINDS).map(k => (
                <option key={k} value={k}>{(selected.type === 'area' ? AREA_KINDS : ELEMENT_KINDS)[k].icon} {kindLabel(k, lang, selected.type === 'area' ? AREA_KINDS : ELEMENT_KINDS)}</option>
              ))}
            </select>
          </label>
          {selected.type === 'area' ? (
            <div className="kb-row">
              {[['x', 'X'], ['y', 'Y'], ['w', b.width], ['d', b.depth]].map(([k, lbl]) => (
                <label key={k} className="kb-field small"><span>{lbl}</span>
                  <input type="number" step={0.5} min={0} value={selItem[k]} onChange={e => changeItem('area', selItem.id, { [k]: Math.max(k === 'w' || k === 'd' ? 0.5 : 0, parseFloat(e.target.value) || 0) })} />
                </label>
              ))}
            </div>
          ) : (
            <>
              <div className="kb-row">
                {[['w', b.width], ['d', b.depth]].map(([k, lbl]) => (
                  <label key={k} className="kb-field small"><span>{lbl}</span>
                    <input type="number" step={0.1} min={0.1} value={selItem[k]} onChange={e => changeItem('element', selItem.id, { [k]: Math.max(0.1, parseFloat(e.target.value) || 0.1) })} />
                  </label>
                ))}
              </div>
              <label className="kb-check">
                <input type="checkbox" checked={!!selItem.important} onChange={e => changeItem('element', selItem.id, { important: e.target.checked })} />
                <span>⭐ {b.important}</span>
              </label>
              <div className="kb-field"><span>{b.photos}</span>
                <div className="kb-photos">
                  {(selItem.photos || []).map(p => (
                    <span key={p} className="kb-photo">
                      <img src={viewablePhotoUrl(p)} alt="" loading="lazy" />
                      <button type="button" aria-label={b.remove} onClick={() => changeItem('element', selItem.id, { photos: selItem.photos.filter(x => x !== p) })}>✕</button>
                    </span>
                  ))}
                  <label className="kb-photo add">{b.addPhoto}<input type="file" accept="image/*" multiple hidden onChange={e => { addPhotos(e.target.files); e.target.value = '' }} /></label>
                </div>
              </div>
              <label className="kb-field"><span>🔎 {b.where}</span>
                <textarea rows={2} value={selItem.location_hint || ''} onChange={e => changeItem('element', selItem.id, { location_hint: e.target.value }, `hint:${selItem.id}`)} />
              </label>
              <label className="kb-field"><span>🛠 {b.how}</span>
                <textarea rows={3} value={selItem.instructions || ''} onChange={e => changeItem('element', selItem.id, { instructions: e.target.value }, `how:${selItem.id}`)} />
              </label>
              <div className="kb-tasks">
                <TaskEditor el={selItem} care={null} t={t} onChange={tasks => changeItem('element', selItem.id, { tasks }, `tasks:${selItem.id}`)} />
              </div>
            </>
          )}
        </aside>
      )}
    </div>
  )
}

/** Loja nova em 3 perguntas: tipo, tamanho e andares (o cliente vem antes, se não veio pelo link). */
function NewStore({ initialClient }) {
  const { t: tr, lang } = useLang()
  const t = tr.facility
  const b = t.build
  const navigate = useNavigate()
  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState(initialClient)
  const [name, setName] = useState('')
  const [tpl, setTpl] = useState('restaurant')
  const [size, setSize] = useState(1)
  const [floors, setFloors] = useState(1)
  const [upper, setUpper] = useState('dining')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('clients').select('id,company_name').order('company_name').then(({ data }) => setClients(data || []))
  }, [])

  const thumbs = useMemo(() => Object.fromEntries(STORE_TEMPLATES.map(x => [x.id, buildTemplate(x, { lang, fill: false, upper: null })])), [lang])
  const base = STORE_TEMPLATES.find(x => x.id === tpl)
  const k = SIZE_SCALE[size].k
  const dims = base ? { w: Math.round(base.width * k), d: Math.round(base.depth * k) } : { w: Math.round(12 * k), d: Math.round(8 * k) }

  const create = async () => {
    if (!clientId) return toast.error(b.chooseClient)
    setBusy(true)
    try {
      let layout = base
        ? buildTemplate({ ...base, width: dims.w, depth: dims.d }, { lang, upper: floors > 1 ? upper : null })
        : emptyLayout(dims.w, dims.d)
      if (!base && floors > 1) layout = addUpperFloor(layout, upper, { lang })
      const client = clients.find(c => c.id === clientId)
      const m = await createModel({ clientId, locationName: name.trim() || null, name: name.trim() ? `${client?.company_name || ''} — ${name.trim()}` : (client?.company_name || 'Store'), layout: normalizeLayout(layout) })
      navigate(`/facility/edit?model=${m.id}`, { replace: true })
    } catch (e) {
      toast.error(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="kw-root kb-root kb-new-root">
      <div className="kw-hud kw-hud-tl">
        <button type="button" className="kw-back" onClick={() => navigate('/facility')}>‹ {t.world?.back || 'World'}</button>
        <div className="kw-brand"><span className="kw-brand-logo" aria-hidden="true">🏗</span><span><strong>{b.newTitle}</strong></span></div>
      </div>
      <div className="kb-new">
        <section className="kb-q">
          <h3><b>1</b> {b.q1}</h3>
          <div className="kb-row">
            <select value={clientId} onChange={e => setClientId(e.target.value)} aria-label={b.q1}>
              <option value="">{b.chooseClient}</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
            <input value={name} onChange={e => setName(e.target.value)} placeholder={b.q1b} aria-label={b.q1b} />
          </div>
        </section>
        <section className="kb-q">
          <h3><b>2</b> {b.q2}</h3>
          <div className="kb-types">
            {STORE_TEMPLATES.filter(x => x.id !== 'twoFloors').map(x => (
              <button key={x.id} type="button" className={`kb-type${tpl === x.id ? ' on' : ''}`} onClick={() => setTpl(x.id)}>
                <PlanThumb layout={thumbs[x.id]} />
                <span>{x.icon} {t.tpl?.[x.id] || x.id}</span>
              </button>
            ))}
            <button type="button" className={`kb-type${tpl === 'blank' ? ' on' : ''}`} onClick={() => setTpl('blank')}>
              <span className="kb-type-blank">▢</span>
              <span>{b.blank}</span>
            </button>
          </div>
        </section>
        <section className="kb-q">
          <h3><b>3</b> {b.q3}</h3>
          <div className="kb-seg">
            {SIZE_SCALE.map((s, i) => {
              const w = Math.round((base?.width || 12) * s.k)
              const d = Math.round((base?.depth || 8) * s.k)
              return (
                <button key={s.key} type="button" className={size === i ? 'on' : ''} onClick={() => setSize(i)}>
                  <strong>{t[s.key]}</strong><small>{w} × {d} m · {w * d} m²</small>
                </button>
              )
            })}
          </div>
        </section>
        <section className="kb-q">
          <h3><b>4</b> {b.q4}</h3>
          <div className="kb-seg">
            <button type="button" className={floors === 1 ? 'on' : ''} onClick={() => setFloors(1)}><strong>🏠 {b.oneFloor}</strong></button>
            <button type="button" className={floors === 2 ? 'on' : ''} onClick={() => setFloors(2)}><strong>🏢 {b.twoFloors}</strong></button>
          </div>
          {floors === 2 && (
            <label className="kb-field" style={{ marginTop: 10 }}><span>{t.upperKind}</span>
              <select value={upper} onChange={e => setUpper(e.target.value)}>
                {UPPER_FLOORS.map(u => <option key={u} value={u}>{t.upper?.[u] || u}</option>)}
              </select>
            </label>
          )}
        </section>
        <div className="kb-new-actions">
          <button type="button" className="kw-pill" disabled={busy || !clientId} onClick={create}>{busy ? b.creating : `🏗 ${b.create}`}</button>
          <button type="button" className="kw-pill ghost" onClick={() => navigate(`/facility/studio${clientId ? `?client=${clientId}` : ''}`)}>📷 {b.aiHelp}</button>
        </div>
      </div>
    </div>
  )
}
