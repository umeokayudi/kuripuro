import { useEffect, useMemo, useState } from 'react'
import { AREA_KINDS, ELEMENT_KINDS, areaForElement } from '../../lib/facilityModel'
import { viewablePhotoUrl } from '../../lib/photoUrl'
import PhotoLightbox from '../PhotoLightbox'
import './where-is.css'

/** O que o funcionário mais precisa achar ao chegar: luz, materiais de limpeza e disjuntor. */
export const WHERE_KINDS = ['light_switch', 'supplies', 'breaker']
const ICON = { light_switch: '💡', supplies: '🧴', breaker: '⚡' }

/**
 * "Onde fica": um cartão por coisa (luz, materiais, disjuntor) com a foto real e onde fica em uma frase.
 * Tocar abre o item no mapa. Quem pode editar (onAdd) vê "Pôr foto" quando ainda falta.
 */
export default function WhereIs({ layout, wi = {}, onOpen, onAdd, onAddPhoto, defaultOpen = true, className = '' }) {
  const [open, setOpen] = useState(defaultOpen)
  const [zoom, setZoom] = useState(null)
  const rows = WHERE_KINDS.map(kind => ({ kind, el: layout.elements.find(e => e.kind === kind && e.photos?.length) || layout.elements.find(e => e.kind === kind) || null }))
  const shown = rows.filter(r => r.el || onAdd)
  if (!shown.length) return null
  const label = kind => wi[kind] || (ELEMENT_KINDS[kind] || ELEMENT_KINDS.other).en

  return (
    <div className={`wi${open ? ' open' : ''}${className ? ` ${className}` : ''}`}>
      <button type="button" className="wi-head" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span>📍 {wi.title || 'Where is it'}</span>
        <span className="wi-mini" aria-hidden="true">{shown.map(r => ICON[r.kind]).join(' ')}</span>
        <i aria-hidden="true">{open ? '▾' : '▸'}</i>
      </button>
      {open && (
        <div className="wi-cards">
          {shown.map(({ kind, el }) => {
            if (!el) {
              return (
                <button key={kind} type="button" className="wi-card add" onClick={() => onAdd(kind)}>
                  <span className="wi-ph">{ICON[kind]}</span>
                  <span className="wi-txt"><strong>{label(kind)}</strong><small>＋ {wi.addPhoto || 'Add a photo of where it is'}</small></span>
                </button>
              )
            }
            const area = areaForElement(layout, el)
            const hint = el.location_hint || (area ? `${(AREA_KINDS[area.kind] || AREA_KINDS.other).icon} ${area.name}` : '')
            const photo = el.photos?.[0]
            return (
              <div key={kind} className="wi-card">
                <button type="button" className="wi-ph" onClick={() => (photo ? setZoom(photo) : onAddPhoto ? onAddPhoto(el) : onOpen?.(el))} aria-label={label(kind)}>
                  {photo ? <img src={viewablePhotoUrl(photo)} alt="" loading="lazy" /> : <span>{ICON[kind]}</span>}
                  {!photo && onAddPhoto && <em>📷 ＋</em>}
                </button>
                <button type="button" className="wi-txt" onClick={() => onOpen?.(el)}>
                  <strong>{ICON[kind]} {label(kind)}</strong>
                  <small>{hint || wi.noHint || ''}</small>
                </button>
              </div>
            )
          })}
        </div>
      )}
      {zoom && <PhotoLightbox url={zoom} onClose={() => setZoom(null)} closeLabel="✕" />}
    </div>
  )
}

/**
 * Pôr rapidinho onde fica (luz, materiais, disjuntor): foto + uma frase + cômodo.
 * Serve para item novo (kind) ou para pôr foto num que já existe (el).
 */
export function WherePlaceForm({ kind, el = null, layout, wi = {}, onSave, onClose }) {
  const [files, setFiles] = useState([])
  const [hint, setHint] = useState(el?.location_hint || '')
  const [areaId, setAreaId] = useState(el?.areaId || '')
  const [busy, setBusy] = useState(false)
  const k = el?.kind || kind
  const previews = useMemo(() => files.map(f => URL.createObjectURL(f)), [files])
  useEffect(() => () => previews.forEach(u => URL.revokeObjectURL(u)), [previews])

  const save = async () => {
    setBusy(true)
    try {
      await onSave({ kind: k, el, files, hint: hint.trim(), areaId: areaId || null })
      onClose()
    } catch {
      setBusy(false)
    }
  }

  return (
    <div className="wi-modal" role="dialog" aria-modal="true" onClick={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="wi-form">
        <h3>{ICON[k] || '📍'} {wi[`q_${k}`] || (wi.whereQ || 'Where is the {x}?').replace('{x}', (wi[k] || k).toLowerCase())}</h3>
        <label className="wi-photo-pick">
          <input type="file" accept="image/*" capture="environment" multiple onChange={e => setFiles(f => [...f, ...Array.from(e.target.files || [])].slice(0, 4))} />
          {previews.length ? (
            <span className="wi-previews">{previews.map(u => <img key={u} src={u} alt="" />)}<b>＋</b></span>
          ) : (
            <span className="wi-photo-empty">📷 {wi.takePhoto || 'Take or choose a photo'}</span>
          )}
        </label>
        <label className="wi-field">
          <span>{wi.hintLabel || 'Where exactly? (one sentence)'}</span>
          <input value={hint} onChange={e => setHint(e.target.value)} placeholder={wi[`${k}Ph`] || ''} maxLength={140} />
        </label>
        {!el && layout.areas.length > 0 && (
          <label className="wi-field">
            <span>{wi.room || 'Room'}</span>
            <select value={areaId} onChange={e => setAreaId(e.target.value)}>
              <option value="">✨ {wi.autoRoom || 'Choose for me'}</option>
              {layout.areas.map(a => <option key={a.id} value={a.id}>{(AREA_KINDS[a.kind] || AREA_KINDS.other).icon} {a.name}</option>)}
            </select>
          </label>
        )}
        <div className="wi-form-actions">
          <button type="button" onClick={onClose} disabled={busy}>{wi.cancel || 'Cancel'}</button>
          <button type="button" className="primary" onClick={save} disabled={busy || (!files.length && !hint.trim())}>{busy ? '…' : `✓ ${wi.save || 'Save'}`}</button>
        </div>
      </div>
    </div>
  )
}
