import { useState } from 'react'
import { AREA_KINDS, ELEMENT_KINDS, areaForElement, areaSquareMeters, kindLabel, elementHistory } from '../../lib/facilityModel'
import { viewablePhotoUrl } from '../../lib/photoUrl'
import { fill } from '../../hooks/useLang'
import PhotoLightbox from '../PhotoLightbox'

function nextCleaning(el) {
  const kind = ELEMENT_KINDS[el.kind] || ELEMENT_KINDS.other
  const interval = el.service_interval_days || kind.intervalDays
  if (!interval || !kind.service) return null
  if (!el.last_serviced_at) return { none: true, interval }
  const next = new Date(el.last_serviced_at + 'T00:00:00+09:00')
  next.setDate(next.getDate() + interval)
  return { date: next.toISOString().slice(0, 10), overdue: next < new Date(), interval }
}

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

/** Pop-up ao tocar num elemento/área: fotos, localização, instruções e recomendações. */
/** Histórico de limpezas do equipamento: data, quem fez, notas e fotos do serviço. */
function ServiceHistory({ history, t, lang, onPhoto }) {
  if (!history.length) return null
  const shown = history.slice(0, 6)
  return (
    <div className="fac-block" style={{ whiteSpace: 'normal' }}>
      <div className="fac-block-title">📋 {t.history}</div>
      <div className="fac-hist">
        {shown.map(h => (
          <div key={h.id} className="fac-hist-row">
            <span className="fac-hist-date">{new Date(h.service_date + 'T00:00:00+09:00').toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Tokyo' })}</span>
            <span style={{ flex: 1 }}>
              {h.service || t.cleaned}{h.employee_name ? ` · ${h.employee_name.split(' ')[0]}` : ''}
              {h.notes && <div className="fac-muted">{h.notes}</div>}
              {h.photos?.length > 0 && (
                <div className="fac-hist-thumbs">
                  {h.photos.map(p => <img key={p} src={viewablePhotoUrl(p)} alt="" onClick={() => onPhoto(p)} />)}
                </div>
              )}
            </span>
          </div>
        ))}
      </div>
      {history.length > shown.length && <div className="fac-muted" style={{ marginTop: 6 }}>{fill(t.moreHistory, { n: history.length - shown.length })}</div>}
    </div>
  )
}

/** Funcionário marca o equipamento como limpo durante o serviço (fotos opcionais). */
function LogServiceForm({ t, onSave }) {
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState([])
  const [saving, setSaving] = useState(false)
  if (!open) {
    return <button type="button" className="fac-btn fac-btn-gold" style={{ width: '100%', marginTop: 12 }} onClick={() => setOpen(true)}>{t.markCleaned}</button>
  }
  return (
    <div className="fac-block fac-logform" style={{ whiteSpace: 'normal' }}>
      <div className="fac-block-title">{t.markCleaned}</div>
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
              await onSave({ notes, files })
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

export default function FacilityItemPopup({ layout, item, t, lang = 'en', recs = [], logs = [], todo, onLogService, onDecide, busyId, onClose, onSelectItem }) {
  const [lightbox, setLightbox] = useState(null)
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
  const next = nextCleaning(el)
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

        {el.photos?.length > 0 && (
          <div className="fac-photos">
            {el.photos.map(p => (
              <img key={p} src={viewablePhotoUrl(p)} alt={el.name} onClick={() => setLightbox(p)} />
            ))}
          </div>
        )}

        {next && (
          <div className="fac-block">
            <div className="fac-block-title">🧽 {t.nextCleaning}</div>
            {next.none
              ? <span>{t.noRecord}</span>
              : <span style={{ color: next.overdue ? '#f87171' : undefined, fontWeight: next.overdue ? 700 : 400 }}>
                  {next.date}{next.overdue ? ` · ${t.overdue}` : ''}
                </span>}
            {el.last_serviced_at && <div className="fac-muted">{t.lastServiced}: {el.last_serviced_at}</div>}
          </div>
        )}

        {el.notes && <div className="fac-block">{el.notes}</div>}

        <ServiceHistory history={history} t={t} lang={lang} onPhoto={setLightbox} />

        {onLogService && (k.service || isTodo) && <LogServiceForm t={t} onSave={data => onLogService(el, data)} />}

        {elRecs.map(r => (
          <RecommendationCard key={r.id} rec={r} t={t} onDecide={onDecide} busy={busyId === r.id} showStatus={false} />
        ))}

        <button type="button" className="fac-btn" style={{ width: '100%', marginTop: 14 }} onClick={onClose}>{t.close}</button>
      </div>
      {lightbox && (
        <div onClick={e => e.stopPropagation()}>
          <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} closeLabel={t.close} />
        </div>
      )}
    </div>
  )
}
