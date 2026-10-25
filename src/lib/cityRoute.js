// Mapa da cidade (Mundo Kuripuro): distância, tempo estimado de carro e trem, melhor ordem e links do Google Maps.
// Sem chave de API: o tempo de trem é estimativa (Tóquio); o tempo exato vem pelo link do Google Maps.
import { distanceMeters } from './geocode.js'

export const MODES = ['car', 'train']

/**
 * Minutos estimados porta a porta em Tóquio para uma distância em linha reta.
 * Carro: rua ≈ 1,35× a linha reta a ~22 km/h + 5 min para estacionar.
 * Trem: ~12 min de caminhada e espera + ~2 min por km.
 */
export function estimateMinutes(meters, mode) {
  const km = Math.max(0, Number(meters) || 0) / 1000
  if (km < 0.6) return Math.max(1, Math.round(km * 13)) // perto: a pé
  if (mode === 'train') return Math.round(12 + km * 2)
  return Math.round(5 + km * 1.35 * (60 / 22))
}

export const legMeters = (a, b) => distanceMeters(a.lat, a.lng, b.lat, b.lng)

/** Matriz de minutos estimados entre todos os pontos. */
export function minutesMatrix(points, mode) {
  return points.map(a => points.map(b => (a === b ? 0 : estimateMinutes(legMeters(a, b), mode))))
}

const pathCost = (order, m) => order.reduce((s, v, i) => (i ? s + m[order[i - 1]][v] : 0), 0)

/**
 * Melhor ordem para visitar os pontos, sem voltar ao início.
 * fixedStart: começa no índice 0 (ex.: minha localização); senão testa cada ponto como início.
 * Vizinho mais próximo + 2-opt: para até ~30 pontos fica perto do ótimo e é instantâneo.
 */
export function bestOrder(matrix, { fixedStart = true } = {}) {
  const n = matrix.length
  if (n <= 2) return [...Array(n).keys()]
  if (!fixedStart) {
    let best = null
    for (let s = 0; s < n; s++) {
      const idx = [s, ...[...Array(n).keys()].filter(i => i !== s)]
      const sub = idx.map(i => idx.map(j => matrix[i][j]))
      const order = bestOrder(sub).map(i => idx[i])
      if (!best || pathCost(order, matrix) < pathCost(best, matrix)) best = order
    }
    return best
  }
  const left = new Set([...Array(n).keys()].slice(1))
  const order = [0]
  while (left.size) {
    const last = order[order.length - 1]
    let best = null
    for (const j of left) if (best == null || matrix[last][j] < matrix[last][best]) best = j
    order.push(best)
    left.delete(best)
  }
  let improved = true
  for (let guard = 0; improved && guard < 50; guard++) {
    improved = false
    for (let i = 1; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const next = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)]
        if (pathCost(next, matrix) < pathCost(order, matrix) - 0.01) { order.splice(0, n, ...next); improved = true }
      }
    }
  }
  return order
}

/** Trechos de uma rota já em ordem: distância (linha reta) e minutos estimados. */
export function routeLegs(points, mode) {
  return points.slice(1).map((b, i) => {
    const meters = legMeters(points[i], b)
    return { from: points[i], to: b, meters, minutes: estimateMinutes(meters, mode) }
  })
}

const ll = p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`

/** Link do Google Maps para um trecho (tempo exato de trem/carro lá). */
export function mapsLegUrl(a, b, mode) {
  return `https://www.google.com/maps/dir/?api=1&origin=${ll(a)}&destination=${ll(b)}&travelmode=${mode === 'train' ? 'transit' : 'driving'}`
}

/** Rota inteira no Google Maps. De trem o Google não aceita paradas no link, então vai só até a 1ª parada. */
export function mapsRouteUrl(points, mode) {
  if (points.length < 2) return points[0] ? `https://www.google.com/maps/search/?api=1&query=${ll(points[0])}` : ''
  if (mode === 'train') return mapsLegUrl(points[0], points[1], 'train')
  const mid = points.slice(1, -1).slice(0, 9).map(ll).join('|')
  return `${mapsLegUrl(points[0], points[points.length - 1], 'car')}${mid ? `&waypoints=${encodeURIComponent(mid)}` : ''}`
}

/**
 * Rota de carro pelas ruas (OpenStreetMap / OSRM, grátis). Volta { legs:[{meters,minutes}], line:[[lat,lng]...] }
 * ou null se o serviço não responder; aí o mapa usa a estimativa. Minutos ×1,3 por causa do trânsito de Tóquio.
 */
export async function carRoute(points, { timeout = 7000 } = {}) {
  if (points.length < 2 || points.length > 25) return null
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeout)
  try {
    const coords = points.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`, { signal: ctl.signal })
    if (!res.ok) return null
    const data = await res.json()
    const r = data?.routes?.[0]
    if (!r?.legs?.length) return null
    return {
      legs: r.legs.map(l => ({ meters: l.distance, minutes: Math.max(1, Math.round((l.duration / 60) * 1.3 + 3)) })),
      line: (r.geometry?.coordinates || []).map(([lng, lat]) => [lat, lng]),
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function fmtMinutes(min, lang = 'pt') {
  const m = Math.round(Number(min) || 0)
  if (m < 60) return lang === 'ja' ? `${m}分` : `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  if (lang === 'ja') return r ? `${h}時間${r}分` : `${h}時間`
  return r ? `${h}h${String(r).padStart(2, '0')}` : `${h}h`
}
