import { useEffect, useRef, useState } from 'react'
import { useLang } from '../hooks/useLang'
import { geocodeAddress, getCurrentPosition } from '../lib/geocode'
import { loadGoogleMaps, mapsApiKey, onMapsAuthFailure } from '../lib/googleMaps'
import { coordsFromText, fmtCoords, isRealCoords } from '../lib/placeLocation'
import './place-picker.css'

const TOKYO = { lat: 35.6812, lng: 139.7671 }
let placesBroken = false // Places API off / key refused: stop asking for suggestions this session

/**
 * Address field with Google Places suggestions (official address + coordinates) and, on the same screen,
 * a fallback that never blocks saving: tap the map to drop the pin, paste coordinates or a Google Maps link,
 * or use this phone's GPS. Without the API key it is a plain text field plus those fallbacks.
 *
 * value: { address, lat, lng } · onChange({ address?, lat?, lng?, name? }) — lat/lng null clears the pin.
 * withCoords=false: only the address text (client company address).
 */
export default function PlacePicker({ value, onChange, placeholder, invalid, withCoords = true, autoFocus }) {
  const { lang, tr } = useLang()
  const apiKey = mapsApiKey()
  const address = value?.address || ''
  const coords = isRealCoords(value?.lat, value?.lng) ? { lat: Number(value.lat), lng: Number(value.lng) } : null

  const [sugs, setSugs] = useState([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [hint, setHint] = useState('')
  const [pinOpen, setPinOpen] = useState(false)
  const [paste, setPaste] = useState('')
  const typed = useRef(false)
  const token = useRef(null)
  const reqId = useRef(0)

  // ---- suggestions while typing (Google Places, new API) ----
  useEffect(() => {
    if (!typed.current || !apiKey || placesBroken) return undefined
    const q = address.trim()
    if (q.length < 2 || /^https?:\/\//i.test(q) || coordsFromText(q)) { setSugs([]); return undefined }
    const id = ++reqId.current
    const timer = setTimeout(async () => {
      try {
        const g = await loadGoogleMaps(apiKey, lang)
        const { AutocompleteSuggestion, AutocompleteSessionToken } = await g.maps.importLibrary('places')
        if (!token.current) token.current = new AutocompleteSessionToken()
        const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: q, sessionToken: token.current, includedRegionCodes: ['jp'], language: lang === 'pt' ? 'pt-BR' : lang,
          locationBias: { center: TOKYO, radius: 50000 },
        })
        if (id !== reqId.current) return
        setSugs((suggestions || []).map(s => s.placePrediction).filter(Boolean).slice(0, 5))
        setOpen(true)
      } catch {
        if (id !== reqId.current) return
        placesBroken = true
        setSugs([])
        setHint(tr('Google suggestions are unavailable — use "Pin on map" or paste the coordinates.', 'Googleの候補が使えません — 「地図で指定」か座標を貼り付けてください。', 'Sugestões do Google indisponíveis — use "Marcar no mapa" ou cole as coordenadas.'))
      }
    }, 280)
    return () => clearTimeout(timer)
  }, [address]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (p) => {
    setOpen(false)
    setSugs([])
    typed.current = false
    setBusy('pick')
    try {
      const place = p.toPlace()
      await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] })
      token.current = null // one session per chosen place
      const loc = place.location
      const full = String(place.formattedAddress || p.text?.text || '').replace(/^日本、\s*/, '')
      onChange({
        address: full,
        name: place.displayName || p.mainText?.text || '',
        ...(withCoords && loc ? { lat: loc.lat(), lng: loc.lng() } : {}),
      })
      setHint('')
    } catch {
      onChange({ address: p.text?.text || address })
    }
    setBusy('')
  }

  const type = (text) => {
    typed.current = true
    const c = withCoords ? coordsFromText(text) : null
    // a Google Maps link with the pin in it (or pasted numbers) is already the location
    onChange(c ? { address: text, lat: c.lat, lng: c.lng } : { address: text })
    setHint('')
  }

  const findGps = async () => {
    if (!address.trim()) return setHint(tr('Type the address first', '先に住所を入力', 'Digite o endereço primeiro'))
    setBusy('find')
    const r = await geocodeAddress(address).catch(() => null)
    setBusy('')
    if (isRealCoords(r?.lat, r?.lng)) { onChange({ lat: r.lat, lng: r.lng }); setHint('') }
    else setHint(tr('Not found from the text — pick a suggestion, pin it on the map or paste the coordinates.', '文字からは見つかりません — 候補を選ぶか、地図で指定、または座標を貼り付けてください。', 'Não achei pelo texto — escolha uma sugestão, marque no mapa ou cole as coordenadas.'))
  }

  const hereGps = async () => {
    setBusy('here')
    try {
      const p = await getCurrentPosition()
      onChange({ lat: p.lat, lng: p.lng })
      setHint(p.acc ? `GPS ±${Math.round(p.acc)} m` : '')
    } catch { setHint(tr('GPS unavailable on this device', 'この端末ではGPSが使えません', 'GPS indisponível neste aparelho')) }
    setBusy('')
  }

  const applyPaste = () => {
    const c = coordsFromText(paste)
    if (!c) return setHint(tr('Use "35.67417, 139.76688" or a Google Maps link with the pin.', '「35.67417, 139.76688」かピン付きのGoogleマップのリンクを使ってください。', 'Use "35.67417, 139.76688" ou um link do Google Maps com o pino.'))
    onChange({ lat: c.lat, lng: c.lng, ...(address.trim() ? {} : { address: paste.trim() }) })
    setPaste('')
    setHint('')
  }

  return (
    <div className="pp">
      <div className="pp-row">
        <div className="pp-input">
          <input
            className={invalid ? 'ag-invalid' : ''}
            value={address}
            onChange={e => type(e.target.value)}
            onFocus={() => sugs.length && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 180)}
            placeholder={placeholder}
            autoFocus={autoFocus}
            autoComplete="off"
          />
          {open && sugs.length > 0 && (
            <ul className="pp-sugs" role="listbox">
              {sugs.map(p => (
                <li key={p.placeId}>
                  <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => pick(p)}>
                    <strong>{p.mainText?.text || p.text?.text}</strong>
                    {p.secondaryText?.text && <small>{p.secondaryText.text}</small>}
                  </button>
                </li>
              ))}
              <li className="pp-google">Google</li>
            </ul>
          )}
        </div>
        {withCoords && <button type="button" className="btn" onClick={findGps} disabled={!!busy}>{busy === 'find' || busy === 'pick' ? '…' : '📍 GPS'}</button>}
      </div>

      {withCoords && (
        <>
          <div className="pp-status">
            {coords
              ? <span className="pp-ok">✓ {fmtCoords(coords)} <a href={`https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`} target="_blank" rel="noreferrer">↗</a></span>
              : <span className="pp-warn">📍? {tr('No location yet', '位置情報なし', 'Sem localização ainda')}</span>}
            <button type="button" className="pp-link" onClick={() => setPinOpen(v => !v)}>🗺 {tr('Pin on map', '地図で指定', 'Marcar no mapa')}</button>
            <button type="button" className="pp-link" onClick={hereGps} disabled={!!busy}>{busy === 'here' ? '…' : `📱 ${tr("I'm here", '現在地', 'Estou aqui')}`}</button>
            {coords && <button type="button" className="pp-link" onClick={() => onChange({ lat: null, lng: null })}>✕</button>}
          </div>
          {hint && <div className="pp-hint">{hint}</div>}
          {pinOpen && (
            <div className="pp-pin">
              <PinMap apiKey={apiKey} lang={lang} coords={coords} onPick={c => { onChange(c); setHint('') }} tr={tr} />
              <div className="pp-paste">
                <input value={paste} onChange={e => setPaste(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyPaste() } }}
                  placeholder={tr('or paste coordinates / Maps link: 35.67417, 139.76688', 'または座標・地図リンクを貼り付け：35.67417, 139.76688', 'ou cole coordenadas / link do Maps: 35.67417, 139.76688')} />
                <button type="button" className="btn btn-sm" onClick={applyPaste}>OK</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Small map: tap to drop the pin, drag it to adjust. Without the map, says so (pasting still works). */
function PinMap({ apiKey, lang, coords, onPick, tr }) {
  const el = useRef(null)
  const mapRef = useRef(null)
  const markerRef = useRef(null)
  const pickRef = useRef(onPick)
  pickRef.current = onPick
  const [state, setState] = useState(apiKey ? 'loading' : 'nokey')

  useEffect(() => {
    if (!apiKey) return undefined
    let off = false
    const stopAuth = onMapsAuthFailure(() => setState('fail'))
    loadGoogleMaps(apiKey, lang).then(g => {
      if (off || !el.current) return
      const map = new g.maps.Map(el.current, {
        center: coords || TOKYO, zoom: coords ? 17 : 12, disableDefaultUI: true, zoomControl: true,
        gestureHandling: 'greedy', clickableIcons: false,
      })
      const marker = new g.maps.Marker({ map, position: coords || null, draggable: true, visible: !!coords })
      const set = ll => {
        marker.setPosition(ll)
        marker.setVisible(true)
        pickRef.current({ lat: Number(ll.lat().toFixed(6)), lng: Number(ll.lng().toFixed(6)) })
      }
      map.addListener('click', e => set(e.latLng))
      marker.addListener('dragend', e => set(e.latLng))
      mapRef.current = map
      markerRef.current = marker
      setState('ready')
    }).catch(() => { if (!off) setState('fail') })
    return () => { off = true; stopAuth(); markerRef.current?.setMap(null) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // a suggestion / pasted coordinates moves the pin too
  useEffect(() => {
    if (!coords || !mapRef.current || !markerRef.current) return
    const cur = markerRef.current.getPosition()
    if (cur && Math.abs(cur.lat() - coords.lat) < 1e-6 && Math.abs(cur.lng() - coords.lng) < 1e-6) return
    markerRef.current.setPosition(coords)
    markerRef.current.setVisible(true)
    mapRef.current.panTo(coords)
    if (mapRef.current.getZoom() < 16) mapRef.current.setZoom(17)
  }, [coords?.lat, coords?.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="pp-map-wrap">
      <div ref={el} className="pp-map" />
      {state === 'ready' && <div className="pp-map-tip">{tr('Tap the map where the store is', '店の位置をタップ', 'Toque no mapa onde fica a loja')}</div>}
      {state !== 'ready' && (
        <div className="pp-map-off">
          {state === 'loading' ? '…' : tr('Map unavailable here — paste the coordinates below.', 'ここでは地図が使えません — 下に座標を貼り付けてください。', 'Mapa indisponível aqui — cole as coordenadas abaixo.')}
        </div>
      )}
    </div>
  )
}
