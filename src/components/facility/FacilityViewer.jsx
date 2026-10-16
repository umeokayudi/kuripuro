import { useMemo, useState } from 'react'
import FacilityScene from './FacilityScene'
import FacilityItemPopup from './FacilityItemPopup'
import { ELEMENT_KINDS } from '../../lib/facilityModel'

/** Visualização somente leitura (portal do cliente e funcionários). */
export default function FacilityViewer({ model, t, lang, recs = [], onDecide, busyId, maxHeight = 460 }) {
  const [mode, setMode] = useState('3d')
  const [rotation, setRotation] = useState(-30)
  const [selected, setSelected] = useState(null)
  const [query, setQuery] = useState('')
  const layout = model.layout

  const alerts = useMemo(
    () => new Set(recs.filter(r => r.status === 'pending' && r.element_id).map(r => r.element_id)),
    [recs],
  )

  const q = query.trim().toLowerCase()
  const listed = layout.elements.filter(el => !q
    || el.name.toLowerCase().includes(q)
    || (ELEMENT_KINDS[el.kind]?.[lang === 'ja' ? 'ja' : 'en'] || '').toLowerCase().includes(q))

  return (
    <div>
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
        maxHeight={maxHeight}
      />
      <div style={{ fontSize: 12, opacity: 0.6, margin: '8px 2px' }}>{t.tapHint}</div>
      {layout.elements.length > 6 && (
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t.search}
          style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 10, border: '1px solid rgba(148,163,184,0.35)', background: 'transparent', color: 'inherit', marginBottom: 8 }}
        />
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {listed.map(el => (
          <button
            key={el.id}
            type="button"
            className={`fac-chip${alerts.has(el.id) ? ' alert' : ''}`}
            onClick={() => setSelected({ type: 'element', id: el.id })}
          >
            {(ELEMENT_KINDS[el.kind] || ELEMENT_KINDS.other).icon} {el.name}
          </button>
        ))}
      </div>
      {selected && (selected.type === 'element' || selected.type === 'area') && (
        <FacilityItemPopup
          layout={layout}
          item={selected}
          t={t}
          lang={lang}
          recs={recs}
          onDecide={onDecide}
          busyId={busyId}
          onClose={() => setSelected(null)}
          onSelectItem={setSelected}
        />
      )}
    </div>
  )
}
