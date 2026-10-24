import { useState } from 'react'
import { AREA_KINDS, ELEMENT_KINDS, areaForElement, areaSquareMeters, kindLabel, elementHistory, careForElement } from '../../lib/facilityModel'
import CareList, { rowsForElement } from './CareList'
import { useLang, fill } from '../../hooks/useLang'
import CleaningTimeline from '../CleaningTimeline'
import { entriesFromLogs } from '../../lib/cleaningTimeline'

export function RecommendationCard({ rec, t, onDecide, busy, showStatus = true }) {
  return (
    <div className={`fac-rec${rec.priority === 'high' ? ' fac-rec-high' : ''}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>🧽 {rec.service}</div>
        <span className="fac-muted" style={{ whiteSpace: 'nowrap' }}>
          {t.priority?.[rec.priority] || rec.priority}
          {showStatus && rec.status !== 'pending' ? ` · ${t[rec.status] || rec.status}` : ''}
        </span>
      </div>
      {rec.element_name && <div className="fac-muted" style={{ marginTop: 2 }}>{rec.element_name}</div>}
      {rec.reason && <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5, color: 'rgba(255,255,255,0.8)' }}>{rec.reason}</div>}
      {rec.status === 'pending' && onDecide && (
        <div className="fac-rec-actions">
          <button type="button" className="fac-btn fac-btn-gold" disabled={busy} onClick={() => onDecide(rec, 'accepted')}>{t.accept}</button>
          <button type="button" className="fac-btn" disabled={busy} onClick={() => onDecide(rec, 'declined')}>{t.decline}</button>
        </div>
      )}
    </div>
  )
}

/** Funcionário marca o equipamento como limpo durante o serviço (fotos opcionais). */
function LogServiceForm({ t, onSave, startOpen = false, tasks = [], defaultTask = '', defaultDate = '' }) {
  const { tr } = useLang()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
  const [open, setOpen] = useState(startOpen)
  const [date, setDate] = useState(defaultDate || today)
  const [service, setService] = useState(defaultTask || tasks[0]?.name || '')
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState([])
  const [saving, setSaving] = useState(false)
  if (!open) {
    return <button type="button" className="fac-btn fac-btn-gold" style={{ width: '100%', marginTop: 12 }} onClick={() => setOpen(true)}>{tasks.length > 1 ? t.markDone : t.markCleaned}</button>
  }
  return (
    <div className="fac-block fac-logform" style={{ whiteSpace: 'normal' }}>
      <div className="fac-block-title">{tasks.length > 1 ? t.whatDone : t.markCleaned}</div>
      {tasks.length > 1 && (
        <div className="fac-task-pick">
          {tasks.map(task => (
            <button key={task.id} type="button" className={`fac-chip${service === task.name ? ' on' : ''}`} onClick={() => setService(task.name)}>
              {task.type === 'maintenance' ? '🔧' : '🧽'} {task.name}
            </button>
          ))}
        </div>
      )}
      <label className="fac-muted" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        📅 {tr('Day of the cleaning', '清掃日', 'Dia da limpeza')}
        <input type="date" value={date} max={today} onChange={e => setDate(e.target.value || today)} style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.08)', color: 'inherit', font: 'inherit' }} />
      </label>
      <label className="fac-btn" style={{ textAlign: 'center', cursor: 'pointer' }}>
        📷 {files.length ? fill(t.photosSelected, { n: files.length }) : t.addPhotoOptional}
        <input type="file" accept="image/*" capture="environment" multiple hidden onChange={e => setFiles([...e.target.files].slice(0, 4))} />
      </label>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t.cleanNotesPlaceholder} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="fac-btn" style={{ flex: 1 }} disabled={saving} onClick={() => setOpen(false)}>{t.cancel}</button>
        <button
          type="button"
          className="fac-btn fac-btn-gold"
          style={{ flex: 2 }}
          disabled={saving}
          onClick={async () => {
            setSaving(true)
            try {
              await onSave({ notes, files, service: service || null, date: date && date !== today ? date : null })
              setOpen(false); setNotes(''); setFiles([])
            } finally {
              setSaving(false)
            }
          }}
        >
          {saving ? '...' : t.saveCleaned}
        </button>
      </div>
    </div>
  )
}

/** Pop-up ao tocar num elemento/área: foto do local, últimas limpezas e calendário, instruções e recomendações. */
export default function FacilityItemPopup({ layout, item, t, lang = 'en', recs = [], logs = [], todo, onLogService, onDecide, busyId, onClose, onSelectItem }) {
  const [logDate, setLogDate] = useState('')
  if (!item) return null

  if (item.type === 'area') {
    const area = layout.areas.find(a => a.id === item.id)
    if (!area) return null
    const k = AREA_KINDS[area.kind] || AREA_KINDS.other
    const inside = layout.elements.filter(el => areaForElement(layout, el)?.id === area.id)
    return (
      <div className="fac-overlay" onClick={onClose}>
        <div className="fac-sheet" onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <h3>{k.icon} {area.name}</h3>
              <div className="fac-muted">{kindLabel(area.kind, lang, AREA_KINDS)} · {areaSquareMeters(area)} ㎡ ({area.w} × {area.d} m)</div>
            </div>
            <button type="button" className="fac-chip" onClick={onClose}>✕</button>
          </div>
          <div style={{ marginTop: 12 }}>
            <CleaningTimeline
              key={area.id}
              dark
              entries={entriesFromLogs(logs.filter(l => inside.some(el => el.id === l.element_id)))}
              placePhotos={inside.flatMap(el => el.photos || [])}
              size={`${areaSquareMeters(area)} m² (${area.w} × ${area.d} m)`}
            />
          </div>
          {area.notes && <div className="fac-block">{area.notes}</div>}
          {inside.length > 0 && (
            <div className="fac-block" style={{ whiteSpace: 'normal' }}>
              <div className="fac-block-title">{t.elements}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {inside.map(el => (
                  <button key={el.id} type="button" className="fac-chip" onClick={() => onSelectItem?.({ type: 'element', id: el.id })}>
                    {(ELEMENT_KINDS[el.kind] || ELEMENT_KINDS.other).icon} {el.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button type="button" className="fac-btn" style={{ width: '100%', marginTop: 14 }} onClick={onClose}>{t.close}</button>
        </div>
      </div>
    )
  }

  if (item.type !== 'element') return null
  const el = layout.elements.find(e => e.id === item.id)
  if (!el) return null
  const k = ELEMENT_KINDS[el.kind] || ELEMENT_KINDS.other
  const area = areaForElement(layout, el)
  const care = el.care || careForElement(el, logs)
  const careRows = rowsForElement(el, care)
  const elRecs = recs.filter(r => r.element_id === el.id && r.status === 'pending')
  const history = elementHistory(el.id, logs)
  const isTodo = todo?.has?.(el.id)
  const acceptedRec = recs.find(r => r.element_id === el.id && r.status === 'accepted')

  return (
    <div className="fac-overlay" onClick={onClose}>
      <div className="fac-sheet" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <h3>{k.icon} {el.name}</h3>
            <div className="fac-muted">{kindLabel(el.kind, lang)}</div>
          </div>
          <button type="button" className="fac-chip" onClick={onClose}>✕</button>
        </div>

        {isTodo && (
          <div className="fac-todo-box">
            <div style={{ fontWeight: 700 }}>⭐ {t.todoThisJob}</div>
            {acceptedRec && <div className="fac-muted" style={{ marginTop: 4 }}>{acceptedRec.service}</div>}
          </div>
        )}

        <div className="fac-block">
          <div className="fac-block-title">📍 {t.locatedIn}</div>
          {area ? (
            <button type="button" className="fac-chip" style={{ marginBottom: 6 }} onClick={() => onSelectItem?.({ type: 'area', id: area.id })}>
              {(AREA_KINDS[area.kind] || AREA_KINDS.other).icon} {area.name}
            </button>
          ) : null}
          <div className="fac-muted">{fill(t.position, { x: el.x, y: el.y })}</div>
        </div>

        {el.location_hint && (
          <div className="fac-block">
            <div className="fac-block-title">🔎 {t.howToFind}</div>
            {el.location_hint}
          </div>
        )}

        {el.instructions && (
          <div className="fac-block">
            <div className="fac-block-title">🛠 {t.howToOperate}</div>
            {el.instructions}
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <CleaningTimeline
            key={el.id}
            dark
            entries={entriesFromLogs(history)}
            placePhotos={el.photos || []}
            onLogDay={onLogService ? d => setLogDate(d) : undefined}
          />
        </div>

        {careRows.length > 0 && (
          <div className="fac-block" style={{ whiteSpace: 'normal' }}>
            <div className="fac-block-title">🧽 {t.careTitle}</div>
            <CareList rows={careRows} t={t} lang={lang} dark />
          </div>
        )}

        {el.notes && <div className="fac-block">{el.notes}</div>}

        {onLogService && (care.length > 0 || isTodo || logDate) && (
          <LogServiceForm
            key={logDate || 'today'}
            t={t}
            startOpen={!!item.log || !!logDate}
            defaultDate={logDate}
            tasks={care}
            defaultTask={(acceptedRec && care.find(c => c.name.toLowerCase() === String(acceptedRec.service || '').toLowerCase())?.name) || careRows.find(r => r.status === 'overdue' || r.status === 'due')?.task.name || care.find(c => c.type === 'cleaning')?.name || ''}
            onSave={data => onLogService(el, data)}
          />
        )}

        {elRecs.map(r => (
          <RecommendationCard key={r.id} rec={r} t={t} onDecide={onDecide} busy={busyId === r.id} showStatus={false} />
        ))}

        <button type="button" className="fac-btn" style={{ width: '100%', marginTop: 14 }} onClick={onClose}>{t.close}</button>
      </div>
    </div>
  )
}
