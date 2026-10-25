// Google Maps no mapa da cidade: só liga quando existe a chave VITE_GOOGLE_MAPS_API_KEY (Vercel → Environment Variables).
// Sem chave o mapa continua no OpenStreetMap com tempo estimado.
export const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''

let loading = null

/** Carrega a API JavaScript do Google Maps uma vez. Volta google.maps ou null (sem chave / falhou). */
export function loadGoogleMaps(lang = 'pt') {
  if (!GOOGLE_MAPS_KEY) return Promise.resolve(null)
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps)
  if (loading) return loading
  loading = new Promise(resolve => {
    const cb = `__kpGmaps${Date.now()}`
    const timer = setTimeout(() => resolve(null), 12000)
    window[cb] = async () => {
      clearTimeout(timer)
      try {
        await Promise.all([window.google.maps.importLibrary('maps'), window.google.maps.importLibrary('routes')])
        resolve(window.google.maps)
      } catch {
        resolve(null)
      }
      delete window[cb]
    }
    // se a chave estiver errada o Google chama gm_authFailure
    window.gm_authFailure = () => { clearTimeout(timer); resolve(null) }
    const s = document.createElement('script')
    const language = lang === 'ja' ? 'ja' : lang === 'pt' ? 'pt-BR' : 'en'
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}&v=weekly&loading=async&language=${language}&region=JP&callback=${cb}`
    s.async = true
    s.onerror = () => { clearTimeout(timer); resolve(null) }
    document.head.appendChild(s)
  })
  return loading
}

const leg = (gm, svc, a, b, mode) => new Promise(resolve => {
  const req = {
    origin: { lat: a.lat, lng: a.lng },
    destination: { lat: b.lat, lng: b.lng },
    travelMode: mode === 'train' ? gm.TravelMode.TRANSIT : gm.TravelMode.DRIVING,
  }
  if (mode === 'train') req.transitOptions = { departureTime: new Date(), modes: [gm.TransitMode.TRAIN, gm.TransitMode.SUBWAY, gm.TransitMode.RAIL] }
  else req.drivingOptions = { departureTime: new Date(), trafficModel: gm.TrafficModel.BEST_GUESS }
  svc.route(req, (res, status) => {
    const l = status === 'OK' ? res?.routes?.[0]?.legs?.[0] : null
    if (!l) { resolve(null); return }
    const sec = (l.duration_in_traffic || l.duration)?.value
    resolve({
      meters: l.distance?.value ?? null,
      minutes: sec != null ? Math.max(1, Math.round(sec / 60)) : null,
      line: (res.routes[0].overview_path || []).map(p => [p.lat(), p.lng()]),
      lines: mode === 'train' ? (l.steps || []).filter(s => s.transit).map(s => s.transit.line?.short_name || s.transit.line?.name).filter(Boolean) : [],
    })
  })
})

/**
 * Tempo de cada trecho pelo Google (carro com trânsito agora; trem/metrô se o Google tiver para o Japão).
 * Volta { legs:[{meters,minutes,lines}], line } ou null; trechos que o Google não achar ficam null (a tela usa a estimativa).
 */
export async function googleRoute(points, mode) {
  if (points.length < 2 || points.length > 12) return null
  const gm = await loadGoogleMaps()
  if (!gm) return null
  const svc = new gm.DirectionsService()
  const legs = await Promise.all(points.slice(1).map((b, i) => leg(gm, svc, points[i], b, mode)))
  if (!legs.some(Boolean)) return null
  return { legs, line: legs.flatMap((l, i) => (l?.line?.length ? l.line : [[points[i].lat, points[i].lng], [points[i + 1].lat, points[i + 1].lng]])) }
}
