// Locais que a gente atende (para o mapa da cidade): serviços dos últimos 180 dias e dos próximos 60, agrupados por local.
import { supabase } from './supabase'
import { businessName, siteCoords } from './nearbyJob.js'
import { coordsFromText, realCoords } from './placeLocation.js'

const dayStr = offset => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
const keyOf = name => String(name || '').trim().toLowerCase()
const storeBase = name => String(name || '').split(/\s+[-—–]\s+/)[0].trim().toLowerCase()
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

export async function loadCityPlaces() {
  const today = dayStr(0)
  const [{ data, error }, { data: locs }, { data: scs }] = await Promise.all([
    supabase.from('jobs')
      .select('id,title,scheduled_date,status,employee_name,client_id,client_name,address,gps_lat,gps_lng')
      .gte('scheduled_date', dayStr(-180)).lte('scheduled_date', dayStr(60))
      .order('scheduled_date', { ascending: false }).limit(3000),
    supabase.from('locations').select('name,address,gps_lat,gps_lng,is_active'),
    supabase.from('service_contracts').select('location_name,location_address,is_active'),
  ])
  if (error) throw error
  // the registry (Locations, then Contracts) is where the place really is; jobs only copy it
  const registry = new Map()
  const reg = k => registry.get(k) || registry.set(k, { coords: null, addresses: [] }).get(k)
  for (const l of locs || []) {
    if (l.is_active === false) continue
    const r = reg(storeBase(l.name))
    r.inLocations = true
    r.coords = r.coords || realCoords(l)
    if (String(l.address || '').trim()) r.addresses.push(String(l.address).trim())
  }
  for (const c of scs || []) {
    if (c.is_active === false || !storeBase(c.location_name)) continue
    const r = reg(storeBase(c.location_name))
    const a = String(c.location_address || '').trim()
    if (a && !r.addresses.includes(a)) r.addresses.push(a)
  }
  const byKey = new Map()
  for (const j of data || []) {
    if (j.status === 'cancelled') continue
    const name = businessName(j)
    const key = keyOf(name)
    if (!key) continue
    let p = byKey.get(key)
    if (!p) {
      const r = registry.get(storeBase(name))
      p = {
        key, name, client_id: j.client_id || null, client_name: j.client_name || '', addresses: [...(r?.addresses || [])], gps: [], jobs: [], last: null, next: null, count: 0,
        registryCoords: r?.coords || null, registered: Boolean(r),
      }
      byKey.set(key, p)
    }
    if (!p.client_id && j.client_id) p.client_id = j.client_id
    if (!p.client_name && j.client_name) p.client_name = j.client_name
    const addr = String(j.address || '').trim()
    if (addr && !p.addresses.includes(addr)) p.addresses.push(addr)
    const own = realCoords(j)
    if (own) p.gps.push([own.lat, own.lng])
    p.jobs.push(j)
    const d = String(j.scheduled_date || '').slice(0, 10)
    if (d < today || j.status === 'completed') {
      p.count++
      if (!p.last || d > p.last.date) p.last = { date: d, who: j.employee_name || '' }
    } else if (!p.next || d < p.next.date) {
      p.next = { date: d, who: j.employee_name || '' }
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Coordenadas de um local: as do cadastro (Locations), as que estão num link do Maps, o endereço
 * (link do Maps ou endereço japonês, guardado no aparelho) ou o GPS dos serviços.
 */
export async function placeCoords(place) {
  if (place.registryCoords) return place.registryCoords
  for (const address of place.addresses) {
    const c = coordsFromText(address)
    if (c) return c
  }
  for (const address of place.addresses.slice(0, 4)) {
    const c = await siteCoords({ address })
    if (c) return c
  }
  if (place.gps.length) return { lat: median(place.gps.map(g => g[0])), lng: median(place.gps.map(g => g[1])) }
  return null
}

/** Loja do Mundo Kuripuro (planta) que corresponde ao local, se houver. */
export function storeForPlace(place, stores) {
  const k = storeBase(place.name)
  const own = stores.filter(s => s.model.client_id === place.client_id)
  const byName = own.find(s => {
    const loc = storeBase(s.model.location_name)
    return (loc && (loc.startsWith(k) || k.startsWith(loc) || k.includes(loc))) || storeBase(s.name) === k
  })
  return byName || null
}
