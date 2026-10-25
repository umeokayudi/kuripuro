import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { fill } from '../../hooks/useLang'
import { formatDistance, getCurrentPosition } from '../../lib/geocode'
import { openClientSheet } from '../../lib/clientSheet'
import { loadCityPlaces, placeCoords, storeForPlace } from '../../lib/cityPlaces'
import {
  bestOrder, carRoute, estimateMinutes, fmtMinutes, legMeters, mapsLegUrl, mapsRouteUrl, minutesMatrix, routeLegs,
} from '../../lib/cityRoute'
import { GOOGLE_MAPS_KEY, googleRoute, loadGoogleMaps } from '../../lib/googleMaps'
import './city-map.css'

const TOKYO = [35.6812, 139.7671]
const ME = '__me__'
const tokyoDay = (offset = 0) => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/**
 * Mapa real da cidade (OpenStreetMap, sem chave): todos os locais que a gente atende, abrir cada um,
 * medir distância e montar rota de carro ou trem com tempo de deslocamento, inclusive na melhor ordem automática.
 */
export default function CityMap({ stores, m, lang, query = '', mobile, onOpenStore }) {
  const mapEl = useRef(null)
  const mapRef = useRef(null)
  const layers = useRef({})
  const measuringRef = useRef(false)

  const [places, setPlaces] = useState([])
  const [coords, setCoords] = useState({})
  const [locating, setLocating] = useState({ done: 0, total: 0 })
  const [selKey, setSelKey] = useState(null)
  const [tab, setTab] = useState('places')
  const [panelOpen, setPanelOpen] = useState(!mobile)
  const [stops, setStops] = useState([])
  const [mode, setMode] = useState('car')
  const [fromMe, setFromMe] = useState(false)
  const [me, setMe] = useState(null)
  const [day, setDay] = useState(tokyoDay(0))
  const [road, setRoad] = useState(null)
  const [gReady, setGReady] = useState(false)
  const [satellite, setSatellite] = useState(false)
  const [measuring, setMeasuring] = useState(false)
  const [measure, setMeasure] = useState([])

  // ---- dados ----
  useEffect(() => {
    let off = false
    loadCityPlaces().then(async list => {
      if (off) return
      setPlaces(list)
      setLocating({ done: 0, total: list.length })
      let done = 0
      const queue = [...list]
      const worker = async () => {
        while (queue.length && !off) {
          const p = queue.shift()
          const c = await placeCoords(p).catch(() => null)
          done++
          if (off) return
          if (c) setCoords(prev => ({ ...prev, [p.key]: c }))
          setLocating({ done, total: list.length })
        }
      }
      await Promise.all([worker(), worker(), worker()])
    }).catch(() => setLocating({ done: 0, total: 0 }))
    return () => { off = true }
  }, [])

  const placeByKey = useMemo(() => new Map(places.map(p => [p.key, p])), [places])
  const pointOf = key => (key === ME ? (me ? { ...me, key: ME, name: m.myLocation } : null) : coords[key] ? { ...coords[key], key, name: placeByKey.get(key)?.name || key } : null)
  const routePoints = [fromMe ? pointOf(ME) : null, ...stops.map(pointOf)].filter(Boolean)
  const routeKey = `${mode}|${routePoints.map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';')}`

  // com Google: carro com trânsito de agora e trem/metrô de verdade (quando o Google tiver o trecho);
  // sem Google: carro pelas ruas (OpenStreetMap) e trem estimado
  useEffect(() => {
    setRoad(null)
    if (routePoints.length < 2) return
    let off = false
    const pts = routePoints
    const go = async () => {
      const g = gReady ? await googleRoute(pts, mode) : null
      if (g) return { ...g, source: 'google' }
      if (mode !== 'car') return null
      const r = await carRoute(pts)
      return r ? { ...r, source: 'osm' } : null
    }
    go().then(r => { if (!off && r) setRoad({ key: routeKey, ...r }) })
    return () => { off = true }
  }, [routeKey, gReady]) // eslint-disable-line react-hooks/exhaustive-deps

  const estLegs = routeLegs(routePoints, mode)
  const legs = road?.key === routeKey
    ? estLegs.map((l, i) => {
      const r = road.legs[i]
      return r && r.minutes != null ? { ...l, minutes: r.minutes, meters: r.meters ?? l.meters, lines: r.lines || [], real: true } : l
    })
    : estLegs
  const totalMin = legs.reduce((s, l) => s + l.minutes, 0)
  const totalM = legs.reduce((s, l) => s + l.meters, 0)

  // ---- mapa ----
  useEffect(() => {
    const map = L.map(mapEl.current, { zoomControl: false, attributionControl: true }).setView(TOKYO, 12)
    const osm = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd', maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map)
    // com a chave do Google, o fundo vira o Google Maps (o OpenStreetMap fica se o Google não carregar)
    if (GOOGLE_MAPS_KEY) {
      loadGoogleMaps(lang).then(async gm => {
        if (!gm || mapRef.current !== map) return
        const { default: GoogleMutant } = await import('leaflet.gridlayer.googlemutant')
        if (mapRef.current !== map) return
        layers.current.GoogleMutant = GoogleMutant
        layers.current.google = new GoogleMutant({ type: 'roadmap', maxZoom: 21 }).addTo(map)
        layers.current.google.bringToBack()
        osm.remove()
        setGReady(true)
      })
    }
    layers.current = { pins: L.layerGroup().addTo(map), route: L.layerGroup().addTo(map), measure: L.layerGroup().addTo(map) }
    map.on('click', e => {
      if (!measuringRef.current) { setSelKey(null); return }
      setMeasure(prev => (prev.length >= 2 ? [] : prev).concat({ lat: e.latlng.lat, lng: e.latlng.lng }))
    })
    mapRef.current = map
    if (import.meta.env.DEV) window.__cityMap = map
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(mapEl.current)
    return () => { ro.disconnect(); map.remove(); mapRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { measuringRef.current = measuring }, [measuring])

  const statusOf = p => {
    const s = storeForPlace(p, stores)
    if (s) return s.draft ? 'none' : s.status
    if (p.next && p.next.date <= tokyoDay(7)) return 'week'
    return 'none'
  }

  // enquadra os pontos deixando livre o espaço do painel (direita no PC, embaixo no celular)
  const fitPoints = pts => {
    if (!pts.length || !mapRef.current) return
    mapRef.current.fitBounds(L.latLngBounds(pts.map(c => [c.lat, c.lng])), {
      paddingTopLeft: mobile ? [30, 150] : [110, 110],
      paddingBottomRight: mobile ? [30, 120] : [470, 60],
      maxZoom: 15,
    })
  }
  const fitted = useRef(false)
  useEffect(() => {
    const pts = Object.values(coords)
    if (fitted.current || !mapRef.current || !pts.length || locating.done < locating.total) return
    fitted.current = true
    fitPoints(pts)
  }, [coords, locating]) // eslint-disable-line react-hooks/exhaustive-deps

  // pinos
  useEffect(() => {
    const g = layers.current.pins
    if (!g) return
    g.clearLayers()
    const order = new Map(stops.map((k, i) => [k, i + 1]))
    for (const p of places) {
      const c = coords[p.key]
      if (!c) continue
      const n = order.get(p.key)
      const html = `<div class="cm-pin st-${statusOf(p)}${selKey === p.key ? ' sel' : ''}${n ? ' stop' : ''}"><i>${n || ''}</i><span>${esc(p.name)}</span></div>`
      const mk = L.marker([c.lat, c.lng], {
        icon: L.divIcon({ className: 'cm-pin-wrap', html, iconSize: [0, 0], iconAnchor: [0, 0] }),
        zIndexOffset: selKey === p.key ? 1000 : n ? 500 : 0,
        keyboard: false,
      })
      mk.on('click', e => {
        L.DomEvent.stopPropagation(e)
        if (measuringRef.current) { setMeasure(prev => (prev.length >= 2 ? [] : prev).concat({ ...c, name: p.name })); return }
        setSelKey(p.key)
        if (mobile) setPanelOpen(false)
      })
      g.addLayer(mk)
    }
    if (me) {
      g.addLayer(L.marker([me.lat, me.lng], { icon: L.divIcon({ className: 'cm-pin-wrap', html: '<div class="cm-me"></div>', iconSize: [0, 0] }) }))
    }
  }, [places, coords, selKey, stops, me, stores]) // eslint-disable-line react-hooks/exhaustive-deps

  // linha da rota
  useEffect(() => {
    const g = layers.current.route
    if (!g) return
    g.clearLayers()
    if (routePoints.length < 2) return
    const real = road?.key === routeKey && road.line.length > 1
    const line = real ? road.line : routePoints.map(p => [p.lat, p.lng])
    g.addLayer(L.polyline(line, { color: '#0b1a2e', weight: 9, opacity: 0.25 }))
    g.addLayer(L.polyline(line, { color: mode === 'train' ? '#7c3aed' : '#2563eb', weight: 5, opacity: 0.9, dashArray: real ? null : '8 10' }))
  }, [routeKey, road]) // eslint-disable-line react-hooks/exhaustive-deps

  // Google: mapa ou satélite
  useEffect(() => {
    const { google, GoogleMutant } = layers.current
    const map = mapRef.current
    if (!gReady || !google || !map) return
    google.remove()
    layers.current.google = new GoogleMutant({ type: satellite ? 'hybrid' : 'roadmap', maxZoom: 21 }).addTo(map)
    layers.current.google.bringToBack()
  }, [satellite]) // eslint-disable-line react-hooks/exhaustive-deps

  // régua
  useEffect(() => {
    const g = layers.current.measure
    if (!g) return
    g.clearLayers()
    for (const p of measure) g.addLayer(L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 3, fillColor: '#f59e0b', fillOpacity: 1 }))
    if (measure.length === 2) g.addLayer(L.polyline(measure.map(p => [p.lat, p.lng]), { color: '#f59e0b', weight: 4, dashArray: '6 8' }))
  }, [measure])

  const flyTo = key => {
    const c = coords[key]
    if (c && mapRef.current) mapRef.current.flyTo([c.lat, c.lng], Math.max(mapRef.current.getZoom(), 15), { duration: 0.6 })
  }
  const select = key => { setSelKey(key); flyTo(key); if (mobile) setPanelOpen(false) }
  const toggleStop = key => setStops(s => (s.includes(key) ? s.filter(k => k !== key) : [...s, key]))
  const moveStop = (i, d) => setStops(s => { const n = [...s]; const j = i + d; if (j < 0 || j >= n.length) return s; [n[i], n[j]] = [n[j], n[i]]; return n })

  const optimize = () => {
    const keys = [fromMe && me ? ME : null, ...stops].filter(k => k && pointOf(k))
    if (keys.length < 3) return
    const order = bestOrder(minutesMatrix(keys.map(pointOf), mode), { fixedStart: keys[0] === ME })
    setStops([...order.map(i => keys[i]).filter(k => k !== ME), ...stops.filter(k => !pointOf(k))])
  }
  const dayRoute = () => {
    const keys = places.filter(p => coords[p.key] && p.jobs.some(j => String(j.scheduled_date).slice(0, 10) === day)).map(p => p.key)
    const withMe = fromMe && me ? [ME, ...keys] : keys
    const order = withMe.length > 2 ? bestOrder(minutesMatrix(withMe.map(pointOf), mode), { fixedStart: withMe[0] === ME }) : withMe.map((_, i) => i)
    setStops(order.map(i => withMe[i]).filter(k => k !== ME))
    setTab('route')
    fitPoints([...(fromMe && me ? [me] : []), ...keys.map(k => coords[k])])
  }
  const locateMe = async () => {
    try {
      const p = await getCurrentPosition({ maxWait: 8000, goodEnough: 80 })
      setMe(p)
      setFromMe(true)
      mapRef.current?.flyTo([p.lat, p.lng], 14, { duration: 0.6 })
    } catch {
      setFromMe(false)
    }
  }
  const fitAll = () => fitPoints(Object.values(coords))

  const q = query.trim().toLowerCase()
  const shown = places.filter(p => !q || `${p.name} ${p.client_name}`.toLowerCase().includes(q))
  const sel = selKey ? placeByKey.get(selKey) : null
  const selStore = sel ? storeForPlace(sel, stores) : null
  const fmtDay = d => (d ? new Date(`${d}T00:00:00+09:00`).toLocaleDateString(lang === 'ja' ? 'ja-JP' : lang === 'pt' ? 'pt-BR' : 'en-US', { day: 'numeric', month: 'short', timeZone: 'Asia/Tokyo' }) : '—')
  const mDist = measure.length === 2 ? legMeters(measure[0], measure[1]) : null
  const dayCount = places.filter(p => coords[p.key] && p.jobs.some(j => String(j.scheduled_date).slice(0, 10) === day)).length

  return (
    <div className="cm-root">
      <div ref={mapEl} className="cm-map" />

      {!(mobile && sel) && <div className="cm-tools">
        <button type="button" className={measuring ? 'on' : ''} onClick={() => { setMeasuring(v => !v); setMeasure([]) }} title={m.measure}>📏<span>{m.measure}</span></button>
        <button type="button" onClick={locateMe} title={m.myLocation}>📍<span>{m.me}</span></button>
        <button type="button" onClick={fitAll} title={m.fitAll}>🗾<span>{m.all}</span></button>
        {gReady && <button type="button" className={satellite ? 'on' : ''} onClick={() => setSatellite(v => !v)} title={m.satellite}>🛰️<span>{m.satellite}</span></button>}
      </div>}

      {locating.total > 0 && locating.done < locating.total && (
        <div className="cm-chip">⏳ {fill(m.locating, { n: locating.done, total: locating.total })}</div>
      )}
      {measuring && (
        <div className="cm-chip cm-measure">
          {mDist == null ? `📏 ${m.measureHint}` : (
            <>
              <b>📏 {formatDistance(mDist)}</b>
              <span>🚗 ≈ {fmtMinutes(estimateMinutes(mDist, 'car'), lang)}</span>
              <span>🚆 ≈ {fmtMinutes(estimateMinutes(mDist, 'train'), lang)}</span>
            </>
          )}
          <button type="button" onClick={() => { setMeasuring(false); setMeasure([]) }} aria-label={m.close}>✕</button>
        </div>
      )}

      {sel && (
        <div className="cm-card">
          <div className="cm-card-head">
            <i className={`cm-dot st-${statusOf(sel)}`} />
            <div>
              <strong>{sel.name}</strong>
              <small>{sel.client_name}</small>
            </div>
            <button type="button" className="cm-x" onClick={() => setSelKey(null)} aria-label={m.close}>✕</button>
          </div>
          <div className="cm-card-grid">
            <span><em>{m.last}</em><b>{fmtDay(sel.last?.date)}</b>{sel.last?.who && <small>{sel.last.who}</small>}</span>
            <span><em>{m.next}</em><b>{fmtDay(sel.next?.date)}</b>{sel.next?.who && <small>{sel.next.who}</small>}</span>
            <span><em>{m.visits}</em><b>{sel.count}</b><small>{m.days180}</small></span>
          </div>
          {selStore && (() => {
            const where = ['light_switch', 'supplies', 'breaker']
              .map(kind => selStore.model.layout.elements.find(e => e.kind === kind && (e.location_hint || e.photos?.length)))
              .filter(Boolean)
            return where.length > 0 && (
              <div className="cm-where">
                {where.map(e => (
                  <span key={e.id}>{{ light_switch: '💡', supplies: '🧴', breaker: '⚡' }[e.kind]} {e.location_hint || e.name}{e.photos?.length ? ' 📷' : ''}</span>
                ))}
              </div>
            )
          })()}
          {!coords[sel.key] && <div className="cm-warn">📍 {m.noLocation}</div>}
          {me && coords[sel.key] && (
            <div className="cm-from-me">
              📍 {formatDistance(legMeters(me, coords[sel.key]))} · 🚗 ≈ {fmtMinutes(estimateMinutes(legMeters(me, coords[sel.key]), 'car'), lang)} · 🚆 ≈ {fmtMinutes(estimateMinutes(legMeters(me, coords[sel.key]), 'train'), lang)}
            </div>
          )}
          <div className="cm-card-actions">
            {selStore
              ? <button type="button" className="primary" onClick={() => onOpenStore(selStore.id)}>🏢 {m.openStore}</button>
              : <button type="button" className="primary" onClick={() => openClientSheet({ id: sel.client_id, name: sel.client_name })}>📋 {m.clientSheet}</button>}
            {selStore && <button type="button" onClick={() => openClientSheet({ id: sel.client_id, name: sel.client_name })}>📋 {m.client}</button>}
            <button type="button" className={stops.includes(sel.key) ? 'on' : ''} disabled={!coords[sel.key]} onClick={() => toggleStop(sel.key)}>
              {stops.includes(sel.key) ? `✓ ${m.inRoute}` : `➕ ${m.addRoute}`}
            </button>
            <button type="button" disabled={!coords[sel.key]} onClick={() => { setMeasuring(true); setMeasure([{ ...coords[sel.key], name: sel.name }]) }}>📏 {m.measureFrom}</button>
            {coords[sel.key] && <a href={`https://www.google.com/maps/search/?api=1&query=${coords[sel.key].lat},${coords[sel.key].lng}`} target="_blank" rel="noreferrer">🧭 Google Maps</a>}
          </div>
        </div>
      )}

      <aside className={`cm-panel${panelOpen ? ' open' : ''}${mobile ? ' sheet' : ''}`}>
        <button type="button" className="cm-panel-head" onClick={() => setPanelOpen(v => !v)} aria-expanded={panelOpen}>
          <span>{tab === 'route' ? `🧭 ${m.route}` : `📍 ${m.places}`}</span>
          <b>{tab === 'route' ? stops.length : places.length}</b>
          <i aria-hidden="true">{panelOpen ? '▾' : '▴'}</i>
        </button>
        {panelOpen && (
          <>
            <div className="cm-seg">
              <button type="button" className={tab === 'places' ? 'on' : ''} onClick={() => setTab('places')}>📍 {m.places} · {places.length}</button>
              <button type="button" className={tab === 'route' ? 'on' : ''} onClick={() => setTab('route')}>🧭 {m.route} · {stops.length}</button>
            </div>

            {tab === 'places' && (
              <div className="cm-list">
                {shown.length === 0 && <div className="cm-empty">{locating.total ? m.noMatch : m.loading}</div>}
                {shown.map(p => (
                  <div key={p.key} className={`cm-row${selKey === p.key ? ' sel' : ''}`}>
                    <button type="button" className="cm-row-main" onClick={() => select(p.key)}>
                      <i className={`cm-dot st-${statusOf(p)}`} />
                      <span>
                        <strong>{p.name}</strong>
                        <small>{p.client_name}{p.next ? ` · ${m.next.toLowerCase()} ${fmtDay(p.next.date)}` : p.last ? ` · ${m.last.toLowerCase()} ${fmtDay(p.last.date)}` : ''}</small>
                      </span>
                      {!coords[p.key] && locating.done >= locating.total && <em title={m.noLocation}>📍?</em>}
                    </button>
                    <button type="button" className={`cm-add${stops.includes(p.key) ? ' on' : ''}`} disabled={!coords[p.key]} onClick={() => toggleStop(p.key)} aria-label={m.addRoute}>
                      {stops.includes(p.key) ? stops.indexOf(p.key) + 1 : '＋'}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {tab === 'route' && (
              <div className="cm-route">
                <div className="cm-seg small">
                  <button type="button" className={mode === 'car' ? 'on' : ''} onClick={() => setMode('car')}>🚗 {m.car}</button>
                  <button type="button" className={mode === 'train' ? 'on' : ''} onClick={() => setMode('train')}>🚆 {m.train}</button>
                </div>
                <div className="cm-auto">
                  <label>📅 <input type="date" value={day} onChange={e => setDay(e.target.value)} aria-label={m.day} /></label>
                  <button type="button" onClick={dayRoute} disabled={!dayCount}>⚡ {fill(m.dayRoute, { n: dayCount })}</button>
                </div>
                <div className="cm-auto">
                  <label className="cm-check"><input type="checkbox" checked={fromMe} onChange={e => (e.target.checked ? (me ? setFromMe(true) : locateMe()) : setFromMe(false))} /> {m.startMe}</label>
                  <button type="button" onClick={optimize} disabled={stops.length < (fromMe && me ? 2 : 3)}>🔀 {m.bestOrder}</button>
                </div>

                {stops.length === 0 && <div className="cm-empty">{m.routeEmpty}</div>}
                <ol className="cm-stops">
                  {fromMe && me && <li className="cm-stop me"><i>📍</i><span><strong>{m.myLocation}</strong></span></li>}
                  {stops.map((k, i) => {
                    const p = placeByKey.get(k)
                    const leg = legs.find(l => l.to.key === k)
                    return (
                      <li key={k} className="cm-stop-wrap">
                        {leg && (
                          <div className="cm-leg">
                            <span>{mode === 'train' ? '🚆' : '🚗'} {leg.real ? '' : '≈ '}{fmtMinutes(leg.minutes, lang)}</span>
                            <small>{formatDistance(leg.meters)}{leg.lines?.length ? ` · ${leg.lines.join(' → ')}` : ''}</small>
                            <a href={mapsLegUrl(leg.from, leg.to, mode)} target="_blank" rel="noreferrer" title={m.exactTime}>↗</a>
                          </div>
                        )}
                        <div className="cm-stop">
                          <i>{i + 1}</i>
                          <button type="button" className="cm-stop-name" onClick={() => select(k)}>
                            <strong>{p?.name || k}</strong>
                            <small>{p?.client_name}{!coords[k] ? ` · ${m.noLocation}` : ''}</small>
                          </button>
                          <button type="button" onClick={() => moveStop(i, -1)} disabled={i === 0} aria-label="▲">▲</button>
                          <button type="button" onClick={() => moveStop(i, 1)} disabled={i === stops.length - 1} aria-label="▼">▼</button>
                          <button type="button" onClick={() => toggleStop(k)} aria-label={m.remove}>✕</button>
                        </div>
                      </li>
                    )
                  })}
                </ol>

                {legs.length > 0 && (
                  <div className="cm-total">
                    <div>
                      <b>{legs.some(l => !l.real) ? '≈ ' : ''}{fmtMinutes(totalMin, lang)}</b>
                      <span>{formatDistance(totalM)} · {fill(m.stopsN, { n: routePoints.length })}</span>
                    </div>
                    <a href={mapsRouteUrl(routePoints, mode)} target="_blank" rel="noreferrer">🧭 {m.openGoogle}</a>
                    <button type="button" className="cm-clear" onClick={() => setStops([])}>🗑 {m.clear}</button>
                  </div>
                )}
                {legs.length > 0 && <p className="cm-note">{road?.key === routeKey && road.source === 'google' && legs.every(l => l.real) ? m.googleNote : mode === 'train' ? m.trainNote : legs.every(l => l.real) ? m.carNoteReal : m.carNote}</p>}
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  )
}
