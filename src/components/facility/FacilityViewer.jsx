import { useMemo, useState } from 'react'
import FacilityScene from './FacilityScene'
import FacilityItemPopup from './FacilityItemPopup'
import { ELEMENT_KINDS, withServiceLog, statusMap, todoElementIds } from '../../lib/facilityModel'

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

/**
 * Visualização somente leitura (portal do cliente e funcionários).
 * logs = facility_service_log do modelo; onLogService(el, { notes, files }) habilita "Marcar como limpo" (funcionário em serviço).
 */
export default function FacilityViewer({ model, t, lang, recs = [], logs = [], onDecide, onLogService, busyId, maxHeight = 460 }) {
  const [mode, setMode] = useState('3d')
  const [rotation, setRotation] = useState(-30)
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState('')
  const layout = useMemo(() => withServiceLog(model.layout, logs), [model.layout, logs])

  const alerts = useMemo(
    () => new Set(recs.filter(r => r.status === 'pending' && r.element_id).map(r => r.element_id)),
    [recs],
  )
  const status = useMemo(() => statusMap(layout), [layout])
  const todo = useMemo(() => todoElementIds(recs), [recs])
  const todoEls = layout.elements.filter(el => todo.has(el.id))
  const attention = layout.elements.filter(el => !todo.has(el.id) && ['overdue', 'due'].includes(status.get(el.id)))

  const q = query.trim().toLowerCase()
  const listed = layout.elements.filter(el => !q
    || el.name.toLowerCase().includes(q)
    || (ELEMENT_KINDS[el.kind]?.[lang === 'ja' ? 'ja' : 'en'] || '').toLowerCase().includes(q))

  const chip = el => {
    const st = status.get(el.id)
    const cls = todo.has(el.id) ? ' todo' : alerts.has(el.id) ? ' alert' : st === 'overdue' ? ' st-overdue' : st === 'due' ? ' st-due' : ''
    return (
      <button key={el.id} type="button" className={`fac-chip${cls}`} onClick={() => setSelected({ type: 'element', id: el.id })}>
        {(ELEMENT_KINDS[el.kind] || ELEMENT_KINDS.other).icon} {el.name}
      </button>
    )
  }

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
      <div className="fac-toolbar">
        <button type="button" className={`fac-chip${mode === '3d' ? ' on' : ''}`} onClick={() => setMode('3d')}>{t.view3d}</button>
        <button type="button" className={`fac-chip${mode === '2d' ? ' on' : ''}`} onClick={() => setMode('2d')}>2D</button>
        {mode === '3d' && (
          <>
            <button type="button" className="fac-chip" onClick={() => setRotation(r => r - 45)}>⟲</button>
            <button type="button" className="fac-chip" onClick={() => setRotation(r => r + 45)}>⟳</button>
          </>
        )}
      </div>
      <FacilityScene
        layout={layout}
        mode={mode}
        rotation={rotation}
        selected={selected}
        onSelect={setSelected}
        alerts={alerts}
        status={status}
        todo={todo}
        maxHeight={maxHeight}
      />
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
      {selected && (selected.type === 'element' || selected.type === 'area') && (
        <FacilityItemPopup
          layout={layout}
          item={selected}
          t={t}
          lang={lang}
          recs={recs}
          logs={logs}
          todo={todo}
          onLogService={onLogService}
          onDecide={onDecide}
          busyId={busyId}
          onClose={() => setSelected(null)}
          onSelectItem={setSelected}
        />
      )}
    </div>
  )
}
