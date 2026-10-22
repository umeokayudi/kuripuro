import { Suspense, lazy, useMemo, useState } from 'react'
import FacilityScene from './FacilityScene'
import FacilityItemPopup from './FacilityItemPopup'
import PhotoLightbox from '../PhotoLightbox'
import { viewablePhotoUrl } from '../../lib/photoUrl'
import { pickLang } from '../../hooks/useLang'
import { AREA_KINDS, ELEMENT_KINDS, areaForElement, withServiceLog, statusMap, todoElementIds, elementTasks, careForElement, levelCount, levelLayout, levelOf } from '../../lib/facilityModel'
import CareList, { rowsForElement } from './CareList'

// three.js só é baixado quando alguém abre o mapa
const FacilityWorld = lazy(() => import('./FacilityWorld'))

const STATUS_STYLE = {
  overdue: { background: 'rgba(239,68,68,0.2)', color: '#fca5a5' },
  due: { background: 'rgba(245,158,11,0.2)', color: '#fcd34d' },
  ok: { background: 'rgba(34,197,94,0.2)', color: '#86efac' },
  none: { background: 'rgba(148,163,184,0.2)', color: '#cbd5e1' },
}

export function StatusLegend({ t }) {
  return (
    <div className="fac-legend">
      <span><i style={{ background: '#ef4444' }} />{t.stOverdue}</span>
      <span><i style={{ background: '#f59e0b' }} />{t.stDue}</span>
      <span><i style={{ background: '#22c55e' }} />{t.stOk}</span>
      <span><i style={{ border: '1.5px dashed #94a3b8' }} />{t.stNone}</span>
    </div>
  )
}

export function ViewModeChips({ mode, setMode, t, allow2dEdit = false }) {
  return (
    <div className="fac-toolbar">
      <button type="button" className={`fac-chip${mode === '3d' ? ' on' : ''}`} onClick={() => setMode('3d')}>🛰 {t.view3d}</button>
      <button type="button" className={`fac-chip${mode === 'walk' ? ' on' : ''}`} onClick={() => setMode('walk')}>🚶 {t.walkInside}</button>
      <button type="button" className={`fac-chip${mode === '2d' ? ' on' : ''}`} onClick={() => setMode('2d')}>🗺 {allow2dEdit ? t.view2d : '2D'}</button>
    </div>
  )
}

export function WorldView({ layout, mode, selectedId, onSelect, status, todo, alerts, height, t, editable = false, onMoveItem, onRotateItem }) {
  return (
    <Suspense fallback={<div className="fac-world" style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.6)' }}>{t.loading3d}</div>}>
      <FacilityWorld
        layout={layout}
        mode={mode === 'walk' ? 'walk' : 'orbit'}
        selectedId={selectedId}
        onSelect={onSelect}
        status={status}
        todo={todo}
        alerts={alerts}
        height={height}
        labels={{ walkHint: t.walkHint, no3d: t.no3d, moveTop: t.moveTop, moveHint: t.moveDragHint, moveBlocked: t.moveBlocked, rotate: t.moveRotate, done: t.moveDone }}
        editable={editable}
        onMoveItem={onMoveItem}
        onRotateItem={onRotateItem}
      />
    </Suspense>
  )
}

/**
 * Painel do item tocado: foto real ao lado (computador) ou embaixo (celular).
 * Itens importantes já abrem com a foto; nos outros a pessoa aperta "Ver foto real".
 */
export function FocusDock({ el, layout, t, lang, status, onDetails, onLog, onClose }) {
  const [showPhoto, setShowPhoto] = useState(!!el.important)
  const [idx, setIdx] = useState(0)
  const [zoom, setZoom] = useState(null)
  const k = ELEMENT_KINDS[el.kind] || ELEMENT_KINDS.other
  const area = areaForElement(layout, el)
  const st = status?.get?.(el.id)
  const photos = el.photos || []
  const photo = photos[Math.min(idx, photos.length - 1)]
  const stLabel = { overdue: t.stOverdue, due: t.stDue, ok: t.stOk, none: t.stNone }[st]
  const RANK = { overdue: 0, due: 1, none: 2, ok: 3 }
  const careRows = rowsForElement(el, el.care || careForElement(el, [])).sort((a, b) => RANK[a.status] - RANK[b.status])

  return (
    <div className="fac-dock" key={el.id}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <h4>{k.icon} {el.name}</h4>
          <div className="fac-muted">
            {area ? `${(AREA_KINDS[area.kind] || AREA_KINDS.other).icon} ${area.name}` : ''}
            {el.important ? ` · ⭐ ${t.important}` : ''}
          </div>
          {st && <span className="fac-st-pill" style={STATUS_STYLE[st]}>{stLabel}</span>}
        </div>
        <button type="button" className="fac-chip" onClick={onClose} aria-label={t.close}>✕</button>
      </div>

      {photos.length > 0 && showPhoto && (
        <>
          <img className="fac-dock-photo" src={viewablePhotoUrl(photo)} alt={el.name} onClick={() => setZoom(photo)} />
          {photos.length > 1 && (
            <div className="fac-dock-strip">
              {photos.map((p, i) => <img key={p} src={viewablePhotoUrl(p)} alt="" className={i === idx ? 'on' : ''} onClick={() => setIdx(i)} />)}
            </div>
          )}
        </>
      )}

      {careRows.length > 0 && <div style={{ marginTop: 10 }}><CareList rows={careRows} t={t} lang={lang} dark limit={2} /></div>}
      {el.location_hint && <div className="fac-dock-text">🔎 {el.location_hint}</div>}
      {el.instructions && <div className="fac-dock-text">🛠 {el.instructions.length > 220 ? `${el.instructions.slice(0, 220)}…` : el.instructions}</div>}

      <div className="fac-dock-actions">
        {photos.length > 0
          ? <button type="button" className={`fac-btn${showPhoto ? '' : ' fac-btn-gold'}`} onClick={() => setShowPhoto(v => !v)}>{showPhoto ? t.hidePhoto : `📷 ${t.realPhoto}`}</button>
          : <span className="fac-muted" style={{ alignSelf: 'center' }}>{t.noPhotoYet}</span>}
        <button type="button" className="fac-btn" onClick={onDetails}>{t.details}</button>
      </div>
      {onLog && <button type="button" className="fac-btn fac-btn-gold" style={{ width: '100%', marginTop: 8 }} onClick={onLog}>{careRows.length > 1 ? t.markDone : t.markCleaned}</button>}
      {zoom && <PhotoLightbox url={zoom} onClose={() => setZoom(null)} closeLabel={t.close} />}
    </div>
  )
}

/**
 * Visualização somente leitura (portal do cliente e funcionários).
 * logs = facility_service_log do modelo; onLogService(el, { notes, files }) habilita "Marcar como limpo" (funcionário em serviço).
 */
export default function FacilityViewer({ model, t, lang, recs = [], logs = [], onDecide, onLogService, busyId, maxHeight = 460 }) {
  const [mode, setMode] = useState('3d')
  const [selected, setSelected] = useState(null)
  const [popup, setPopup] = useState(null)
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState(0)
  const layout = useMemo(() => withServiceLog(model.layout, logs), [model.layout, logs])
  const floors = levelCount(layout)
  const shownLevel = Math.min(level, floors - 1)
  const floorLayout = useMemo(() => levelLayout(layout, shownLevel), [layout, shownLevel])

  const alerts = useMemo(
    () => new Set(recs.filter(r => r.status === 'pending' && r.element_id).map(r => r.element_id)),
    [recs],
  )
  const status = useMemo(() => statusMap(layout), [layout])
  const todo = useMemo(() => todoElementIds(recs), [recs])
  const todoEls = layout.elements.filter(el => todo.has(el.id))
  const attention = layout.elements.filter(el => !todo.has(el.id) && ['overdue', 'due'].includes(status.get(el.id)))
  const selEl = selected?.type === 'element' ? layout.elements.find(e => e.id === selected.id) : null

  // tocar num equipamento: sobe no 3D + painel com a foto real; tocar numa área abre o pop-up dela
  const select = (item) => {
    if (!item) { setSelected(null); return }
    if (item.type === 'area') { setPopup(item); return }
    // item de outro andar (lista / pendências): a tela vai para o andar dele
    const el = layout.elements.find(e => e.id === item.id)
    if (el && levelOf(el) !== shownLevel) setLevel(levelOf(el))
    setSelected(item)
  }

  const q = query.trim().toLowerCase()
  const listed = layout.elements.filter(el => !q
    || el.name.toLowerCase().includes(q)
    || (pickLang(lang, ELEMENT_KINDS[el.kind]?.en, ELEMENT_KINDS[el.kind]?.ja, ELEMENT_KINDS[el.kind]?.pt) || '').toLowerCase().includes(q))

  const chip = el => {
    const st = status.get(el.id)
    const cls = todo.has(el.id) ? ' todo' : alerts.has(el.id) ? ' alert' : st === 'overdue' ? ' st-overdue' : st === 'due' ? ' st-due' : el.important ? ' important' : ''
    return (
      <button key={el.id} type="button" className={`fac-chip${cls}${selEl?.id === el.id ? ' on' : ''}`} onClick={() => select({ type: 'element', id: el.id })}>
        {(ELEMENT_KINDS[el.kind] || ELEMENT_KINDS.other).icon} {el.name}{el.important && el.photos?.length ? ' 📷' : ''}
      </button>
    )
  }

  const stageH = Math.min(maxHeight, 520)

  return (
    <div>
      {todoEls.length > 0 && (
        <div className="fac-todo-box">
          <div style={{ fontWeight: 700, marginBottom: 8 }}>⭐ {onLogService ? t.todoThisJob : t.todoAccepted} ({todoEls.length})</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{todoEls.map(chip)}</div>
        </div>
      )}
      {onLogService && attention.length > 0 && (
        <div className="fac-block" style={{ whiteSpace: 'normal', marginTop: 0, marginBottom: 10 }}>
          <div className="fac-block-title">⚠️ {t.needsAttention}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{attention.map(chip)}</div>
        </div>
      )}
      <ViewModeChips mode={mode} setMode={setMode} t={t} />
      {floors > 1 && (
        <div className="fac-floorbar">
          {Array.from({ length: floors }, (_, i) => (
            <button key={i} type="button" className={`fac-toggle${shownLevel === i ? ' on' : ''}`} onClick={() => { setLevel(i); setSelected(null) }}>
              {i === 0 ? `🏠 ${t.groundFloor}` : `⬆️ ${String(t.upperFloorN || 'Floor {n}').replace('{n}', i + 1)}`}
            </button>
          ))}
        </div>
      )}
      <div className={`fac-viewer-grid${selEl ? ' has-dock' : ''}`}>
        <div style={{ minWidth: 0 }}>
          {mode === '2d' ? (
            <FacilityScene
              layout={floorLayout}
              mode="2d"
              selected={selected}
              onSelect={select}
              alerts={alerts}
              status={status}
              todo={todo}
              maxHeight={stageH}
            />
          ) : (
            <WorldView layout={floorLayout} mode={mode} selectedId={selEl?.id || null} onSelect={select} status={status} todo={todo} alerts={alerts} height={stageH} t={t} />
          )}
        </div>
        {selEl && (
          <FocusDock
            key={selEl.id}
            el={selEl}
            layout={layout}
            t={t}
            lang={lang}
            status={status}
            onDetails={() => setPopup({ type: 'element', id: selEl.id })}
            onLog={onLogService && (elementTasks(selEl).length > 0 || todo.has(selEl.id)) ? () => setPopup({ type: 'element', id: selEl.id, log: true }) : undefined}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
      <StatusLegend t={t} />
      <div style={{ fontSize: 12, opacity: 0.6, margin: '4px 2px 8px' }}>{t.tapHint}</div>
      {layout.elements.length > 6 && (
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t.search}
          style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 10, border: '1px solid rgba(148,163,184,0.35)', background: 'transparent', color: 'inherit', marginBottom: 8 }}
        />
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {listed.map(chip)}
      </div>
      {popup && (
        <FacilityItemPopup
          layout={layout}
          item={popup}
          t={t}
          lang={lang}
          recs={recs}
          logs={logs}
          todo={todo}
          onLogService={onLogService}
          onDecide={onDecide}
          busyId={busyId}
          onClose={() => setPopup(null)}
          onSelectItem={item => (item?.type === 'element' ? (setPopup(null), setSelected(item)) : setPopup(item))}
        />
      )}
    </div>
  )
}
