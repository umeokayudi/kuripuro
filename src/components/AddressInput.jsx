import { useEffect, useRef, useState } from 'react'
import { mapsApiKey, loadGoogleMaps } from '../lib/googleMaps'
import { useLang } from '../hooks/useLang'
import './SalaryPopups.css'

// v1.0.133 · Every address field: Google Places autocomplete (Japan) when the Maps key is on, plus an
// optional "📍 Pino" (manual pin on a map, or a pasted Google Maps link / "lat, lng" without the key).
// Drop-in for <input value onChange>: same props, so the look of each form does not change.
//   onPick({ address, lat, lng }) — when a suggestion or a pin is chosen (lat/lng may be null).
let placesLib = null
async function places(lang) {
  const key = mapsApiKey()
  if (!key) return null
  if (placesLib) return placesLib
  const g = await loadGoogleMaps(key, lang === 'pt' ? 'pt-BR' : lang)
  placesLib = g.maps.importLibrary ? await g.maps.importLibrary('places') : g.maps.places
  return placesLib
}

/** "35.67, 139.76" or a Google Maps link with @lat,lng / ?q=lat,lng / !3dlat!4dlng → { lat, lng } | null */
export function coordsFromText(text) {
  const s = String(text || '')
  const m = s.match(/@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/) || s.match(/[?&](?:q|query|ll)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/)
    || s.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/) || s.match(/^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/)
  if (!m) return null
  const lat = Number(m[1]), lng = Number(m[2])
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}

export default function AddressInput({ value, onChange, onPick, pin = false, lat = null, lng = null, ...rest }) {
  const { lang, tr } = useLang()
  const ref = useRef(null)
  const [pinOpen, setPinOpen] = useState(false)
  const pickRef = useRef(onPick)
  const changeRef = useRef(onChange)
  pickRef.current = onPick
  changeRef.current = onChange

  useEffect(() => {
    let ac = null, alive = true
    places(lang).then(lib => {
      if (!alive || !lib || !ref.current || !lib.Autocomplete) return
      ac = new lib.Autocomplete(ref.current, { componentRestrictions: { country: 'jp' }, fields: ['formatted_address', 'geometry', 'name'] })
      ac.addListener('place_changed', () => {
        const p = ac.getPlace() || {}
        const address = p.formatted_address || p.name || ref.current?.value || ''
        const loc = p.geometry?.location
        // same shape as a typed change, so every form keeps its own onChange
        changeRef.current?.({ target: { value: address } })
        pickRef.current?.({ address, lat: loc ? loc.lat() : null, lng: loc ? loc.lng() : null })
      })
    }).catch(() => { /* no key / blocked: plain input */ })
    return () => { alive = false; if (ac && window.google?.maps?.event) window.google.maps.event.clearInstanceListeners(ac) }
  }, [lang])

  const input = <input ref={ref} value={value ?? ''} onChange={onChange} autoComplete="off" {...rest} />
  if (!pin) return input
  return (
    <>
      <span style={{ display: 'flex', gap: 6, flex: rest.style?.flex ?? 1, minWidth: 0 }}>
        {input}
        <button type="button" className="btn" onClick={() => setPinOpen(true)} title={tr('Mark the place on the map', '地図で場所を指定', 'Marcar o local no mapa')}>📍 {tr('Pin', 'ピン', 'Pino')}</button>
      </span>
      {pinOpen && <PinSheet start={lat != null && lng != null ? { lat: Number(lat), lng: Number(lng) } : coordsFromText(value)} address={value}
        onClose={() => setPinOpen(false)}
        onDone={pt => { setPinOpen(false); pickRef.current?.({ address: value || `${pt.lat.toFixed(6)},${pt.lng.toFixed(6)}`, lat: pt.lat, lng: pt.lng }) }} />}
    </>
  )
}

const TOKYO = { lat: 35.6812, lng: 139.7671 }

function PinSheet({ start, address, onClose, onDone }) {
  const { lang, tr } = useLang()
  const mapEl = useRef(null)
  const [pt, setPt] = useState(start)
  const [text, setText] = useState('')
  const [noMap, setNoMap] = useState(!mapsApiKey())
  useEffect(() => {
    const key = mapsApiKey()
    if (!key) return
    let marker = null
    loadGoogleMaps(key, lang === 'pt' ? 'pt-BR' : lang).then(g => {
      if (!mapEl.current) return
      const map = new g.maps.Map(mapEl.current, { center: start || TOKYO, zoom: start ? 18 : 12, mapTypeControl: false, streetViewControl: false, gestureHandling: 'greedy' })
      const put = (p) => {
        if (!marker) marker = new g.maps.Marker({ map, position: p, draggable: true })
        else marker.setPosition(p)
        marker.addListener('dragend', e => setPt({ lat: e.latLng.lat(), lng: e.latLng.lng() }))
        setPt(p)
      }
      if (start) put(start)
      map.addListener('click', e => put({ lat: e.latLng.lat(), lng: e.latLng.lng() }))
      // the typed address centers the map when there is no point yet
      if (!start && address && g.maps.Geocoder) new g.maps.Geocoder().geocode({ address, region: 'JP' }, (res, st) => {
        if (st === 'OK' && res?.[0]) { const l = res[0].geometry.location; map.setCenter(l); map.setZoom(17) }
      })
    }).catch(() => setNoMap(true))
  }, [])
  const typed = coordsFromText(text)
  return (
    <div className="sp-overlay" onClick={onClose} style={{ zIndex: 1200 }}>
      <section className="sp-modal is-admin" role="dialog" aria-modal="true" style={{ maxWidth: 560, width: '100%' }} onClick={e => e.stopPropagation()}>
        <h3>📍 {tr('Mark the place', '場所を指定', 'Marcar o local')}</h3>
        {!noMap && <>
          <p style={{ fontSize: 12, color: 'var(--text3)', margin: '0 0 8px' }}>{tr('Tap the map where the entrance is. Drag the pin to adjust.', '入口の場所を地図でタップ。ピンはドラッグで調整できます。', 'Toque no mapa onde fica a entrada. Arraste o pino para ajustar.')}</p>
          <div ref={mapEl} style={{ width: '100%', height: 320, borderRadius: 10, background: 'var(--surface2)' }} />
        </>}
        <div className="form-group" style={{ marginTop: 10 }}>
          <label>{tr('Or paste a Google Maps link / "lat, lng"', 'またはGoogleマップのリンク／「緯度, 経度」を貼り付け', 'Ou cole um link do Google Maps / "lat, lng"')}</label>
          <input value={text} onChange={e => setText(e.target.value)} placeholder="35.6747, 139.7613" />
        </div>
        {(typed || pt) && <div style={{ fontSize: 12, color: 'var(--green)' }}>✓ {(typed || pt).lat.toFixed(5)}, {(typed || pt).lng.toFixed(5)}</div>}
        <div className="sp-actions">
          <button type="button" className="btn" onClick={onClose}>{tr('Cancel', 'キャンセル', 'Cancelar')}</button>
          <button type="button" className="btn btn-primary" disabled={!(typed || pt)} onClick={() => onDone(typed || pt)}>{tr('Use this point', 'この地点を使う', 'Usar este ponto')}</button>
        </div>
      </section>
    </div>
  )
}
