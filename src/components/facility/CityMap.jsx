import { useEffect, useMemo, useRef, useState } from 'react'
import { fill } from '../../hooks/useLang'
import { formatDistance, getCurrentPosition } from '../../lib/geocode'
import { openClientSheet } from '../../lib/clientSheet'
import { loadCityPlaces, placeCoords, storeForPlace } from '../../lib/cityPlaces'
import {
  bestOrder, carRoute, estimateMinutes, fmtMinutes, legMeters, mapsLegUrl, mapsRouteUrl, minutesMatrix, routeLegs,
} from '../../lib/cityRoute'
import { loadGoogleMaps, mapsApiKey, onMapsAuthFailure } from '../../lib/googleMaps'
import { worstStatus } from '../../lib/pinClusters'
import { createPinLayer } from './gmapPins'
import './city-map.css'

const TOKYO = { lat: 35.6812, lng: 139.7671 }
// tira o excesso de lojas/restaurantes do próprio Google para os nossos pinos aparecerem
const MAP_STYLE = [{ featureType: 'poi.business', stylers: [{ visibility: 'off' }] }]
const ME = '__me__'
const tokyoDay = (offset = 0) => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const short = s => (s.length > 14 ? `${s.slice(0, 13)}…` : s)
// grupo de pinos próximos: número de locais + o primeiro nome, na cor do pior status
const clusterHtml = items => `<div class="cm-pin cm-cluster st-${worstStatus(items.map(i => i.status))}"><i>${items.length}</i><span>${esc(short(items[0].name))} +${items.length - 1}</span></div>`

/**
 * Mapa real da cidade (Google Maps; sem chave mostra só a lista com um aviso): todos os locais que a gente atende, abrir cada um,
 * medir distância e montar rota de carro ou trem com tempo de deslocamento, inclusive na melhor ordem automática.
 */
export default function CityMap({ stores, m, lang, query = '', mobile, onOpenStore }) {
  const mapEl = useRef(null)
  const mapRef = useRef(null)
  const layers = useRef({})
  const measuringRef = useRef(false)
  const gRef = useRef(null)
  const pinClickRef = useRef(() => {})
  const apiKey = mapsApiKey()
  const [gm, setGm] = useState(apiKey ? 'loading' : 'nokey') // nokey | loading | ready | fail
  const noMap = gm === 'nokey' || gm === 'fail'

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

  // carro: rota pelas ruas (se o serviço grátis responder); trem: estimativa
  useEffect(() => {
    setRoad(null)
    if (mode !== 'car' || routePoints.length < 2) return
    let off = false
    const pts = routePoints
    carRoute(pts).then(r => { if (!off && r) setRoad({ key: routeKey, ...r }) })
    return () => { off = true }
  }, [routeKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const estLegs = routeLegs(routePoints, mode)
  const legs = road?.key === routeKey ? estLegs.map((l, i) => ({ ...l, ...road.legs[i], real: true })) : estLegs
  const totalMin = legs.reduce((s, l) => s + l.minutes, 0)
  const totalM = legs.reduce((s, l) => s + l.meters, 0)

  // ---- mapa (Google Maps JavaScript API) ----
  useEffect(() => {
    if (!apiKey) return
    let off = false
    const stopAuth = onMapsAuthFailure(() => setGm('fail'))
    loadGoogleMaps(apiKey, lang).then(g => {
      if (off || !mapEl.current) return
      const map = new g.maps.Map(mapEl.current, {
        center: TOKYO, zoom: 12, disableDefaultUI: true, zoomControl: !mobile,
        zoomControlOptions: { position: g.maps.ControlPosition.LEFT_BOTTOM },
        gestureHandling: 'greedy', clickableIcons: false, styles: MAP_STYLE, backgroundColor: '#dfe6ee',
      })
      map.addListener('click', e => {
        if (!measuringRef.current) { setSelKey(null); return }
        setMeasure(prev => (prev.length >= 2 ? [] : prev).concat({ lat: e.latLng.lat(), lng: e.latLng.lng() }))
      })
      gRef.current = g
      layers.current = { pins: createPinLayer(g, map, r => pinClickRef.current(r), clusterHtml), lines: [] }
      mapRef.current = map
      if (import.meta.env.DEV) window.__cityMap = map
      setGm('ready')
    }).catch(() => { if (!off) setGm('fail') })
    return () => {
      off = true
      stopAuth()
      layers.current.pins?.setMap(null)
      layers.current.lines?.forEach(l => l.setMap(null))
      layers.current = {}
      mapRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { measuringRef.current = measuring }, [measuring])

  const statusOf = p => {
    const s = storeForPlace(p, stores)
    if (s) return s.draft ? 'none' : s.status
    if (p.next && p.next.date <= tokyoDay(7)) return 'week'
    return 'none'
  }

  // enquadra os pontos deixando livre o espaço do painel (direita no PC, embaixo no celular)
  const fitPoints = (pts, maxZoom = 15) => {
    const map = mapRef.current
    const g = gRef.current
    if (!pts.length || !map || !g) return
    const b = new g.maps.LatLngBounds()
    pts.forEach(c => b.extend({ lat: c.lat, lng: c.lng }))
    map.fitBounds(b, mobile ? { top: 150, left: 30, right: 30, bottom: 120 } : { top: 110, left: 110, right: 470, bottom: 60 })
    g.maps.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > maxZoom) map.setZoom(maxZoom) })
  }
  const fitted = useRef(false)
  useEffect(() => {
    const pts = Object.values(coords)
    if (fitted.current || !mapRef.current || !pts.length || locating.done < locating.total) return
    fitted.current = true
    fitPoints(pts)
  }, [coords, locating, gm]) // eslint-disable-line react-hooks/exhaustive-deps

  // clique num pino ou num grupo (ref para sempre ver o estado atual)
  pinClickRef.current = r => {
    const map = mapRef.current
    if (!map) return
    if (r.kind === 'cluster') {
      const near = r.items.every(i => legMeters(i, r.items[0]) < 30)
      if (near || map.getZoom() >= 18) { select(r.items[0].key); return }
      fitPoints(r.items, 18)
      return
    }
    if (!r.key || r.key === ME) return
    if (measuringRef.current) { setMeasure(prev => (prev.length >= 2 ? [] : prev).concat({ lat: r.lat, lng: r.lng, name: r.name })); return }
    setSelKey(r.key)
    if (mobile) setPanelOpen(false)
  }

  // pinos (+ eu + pontos da régua)
  useEffect(() => {
    const layer = layers.current.pins
    if (!layer) return
    const order = new Map(stops.map((k, i) => [k, i + 1]))
    const items = []
    for (const p of places) {
      const c = coords[p.key]
      if (!c) continue
      const n = order.get(p.key)
      const st = statusOf(p)
      const isSel = selKey === p.key
      items.push({
        key: p.key, name: p.name, lat: c.lat, lng: c.lng, status: st, fixed: isSel || !!n, z: isSel ? 1000 : n ? 500 : 0,
        html: `<div class="cm-pin st-${st}${isSel ? ' sel' : ''}${n ? ' stop' : ''}"><i>${n || ''}</i><span>${esc(p.name)}</span></div>`,
      })
    }
    if (me) items.push({ key: ME, lat: me.lat, lng: me.lng, fixed: true, z: 900, html: '<div class="cm-me"></div>' })
    measure.forEach(pt => items.push({ lat: pt.lat, lng: pt.lng, fixed: true, z: 1100, html: '<div class="cm-mpt"></div>' }))
    layer.setItems(items)
  }, [places, coords, selKey, stops, me, stores, measure, gm]) // eslint-disable-line react-hooks/exhaustive-deps

  // linhas: rota e régua
  useEffect(() => {
    const g = gRef.current
    const map = mapRef.current
    if (!g || !map) return
    layers.current.lines.forEach(l => l.setMap(null))
    const lines = []
    const draw = (path, color, weight, opacity, dashed) => lines.push(new g.maps.Polyline({
      map, path, clickable: false, strokeColor: color, strokeWeight: weight, strokeOpacity: dashed ? 0 : opacity,
      icons: dashed ? [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: opacity, strokeColor: color, scale: weight }, offset: '0', repeat: `${weight * 4}px` }] : [],
    }))
    if (routePoints.length >= 2) {
      const real = road?.key === routeKey && road.line.length > 1
      const path = (real ? road.line.map(([lat, lng]) => ({ lat, lng })) : routePoints.map(p => ({ lat: p.lat, lng: p.lng })))
      if (real) draw(path, '#0b1a2e', 9, 0.25, false)
      draw(path, mode === 'train' ? '#7c3aed' : '#2563eb', real ? 5 : 4, 0.9, !real)
    }
    if (measure.length === 2) draw(measure.map(p => ({ lat: p.lat, lng: p.lng })), '#f59e0b', 3, 1, true)
    layers.current.lines = lines
  }, [routeKey, road, measure, gm]) // eslint-disable-line react-hooks/exhaustive-deps

  const flyTo = key => {
    const c = coords[key]
    const map = mapRef.current
    if (!c || !map) return
    map.panTo({ lat: c.lat, lng: c.lng })
    if (map.getZoom() < 15) map.setZoom(15)
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
      mapRef.current?.panTo({ lat: p.lat, lng: p.lng })
      mapRef.current?.setZoom(14)
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
      <div ref={mapEl} className={`cm-map${noMap ? ' off' : ''}`} />

      {noMap && (
        <div className="cm-nomap" role="status">
          <span aria-hidden="true">🗺️</span>
          <div>
            <strong>{gm === 'fail' ? m.mapFailTitle : m.noKeyTitle}</strong>
            <small>{gm === 'fail' ? m.mapFailBody : m.noKeyBody}</small>
          </div>
        </div>
      )}

      {!noMap && !(mobile && sel) && <div className="cm-tools">
        <button type="button" className={measuring ? 'on' : ''} onClick={() => { setMeasuring(v => !v); setMeasure([]) }} title={m.measure}>📏<span>{m.measure}</span></button>
        <button type="button" onClick={locateMe} title={m.myLocation}>📍<span>{m.me}</span></button>
        <button type="button" onClick={fitAll} title={m.fitAll}>🗾<span>{m.all}</span></button>
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
            <button type="button" disabled={!coords[sel.key] || noMap} onClick={() => { setMeasuring(true); setMeasure([{ ...coords[sel.key], name: sel.name }]) }}>📏 {m.measureFrom}</button>
            {coords[sel.key] && <a href={`https://www.google.com/maps/search/?api=1&query=${coords[sel.key].lat},${coords[sel.key].lng}`} target="_blank" rel="noreferrer">🧭 Google Maps</a>}
          </div>
        </div>
      )}

      <aside className={`cm-panel${panelOpen || noMap ? ' open' : ''}${mobile ? ' sheet' : ''}${noMap ? ' nomap' : ''}`}>
        <button type="button" className="cm-panel-head" onClick={() => setPanelOpen(v => !v)} aria-expanded={panelOpen}>
          <span>{tab === 'route' ? `🧭 ${m.route}` : `📍 ${m.places}`}</span>
          <b>{tab === 'route' ? stops.length : places.length}</b>
          {!noMap && <i aria-hidden="true">{panelOpen ? '▾' : '▴'}</i>}
        </button>
        {(panelOpen || noMap) && (
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
                            <small>{formatDistance(leg.meters)}</small>
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
                {legs.length > 0 && <p className="cm-note">{mode === 'train' ? m.trainNote : legs.every(l => l.real) ? m.carNoteReal : m.carNote}</p>}
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  )
}
