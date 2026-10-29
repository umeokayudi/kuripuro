// Single place registry (v1.0.96): `locations` is the place; recurring contracts and Manager & stores
// point at it. Until the SQL links them (location_id), places are matched by store name, and a
// store that only exists in Contracts still shows up as a place.
import { storeName } from './agenda'

const key = n => storeName(n).toLowerCase()

/** locations + stores only found in contracts → one list [{ id, name, address, client_id, contracts[], fromContract }]. */
export function buildPlaces(locations = [], contracts = []) {
  const out = new Map()
  for (const l of locations || []) {
    if (l.is_active === false) continue
    if (!out.has(key(l.name))) out.set(key(l.name), { ...l, contracts: [] })
  }
  for (const c of contracts || []) {
    if (c.is_active === false || !c.location_name) continue
    const linked = c.location_id && [...out.values()].find(p => p.id === c.location_id)
    const k = linked ? key(linked.name) : key(c.location_name)
    if (!out.has(k)) {
      out.set(k, {
        id: `sc:${c.id}`, name: storeName(c.location_name), address: c.location_address || '', client_id: c.client_id,
        area: c.area || null, notes: '', contracts: [], fromContract: true,
      })
    }
    const p = out.get(k)
    if (!p.client_id) p.client_id = c.client_id
    if (!p.address && c.location_address) p.address = c.location_address
    p.contracts.push(c)
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Contract of a place for a cleaning type: deep → the "Deep Clean" contract, basic → the main one. */
export function contractForPlace(place, cleaningType = 'basic') {
  const list = place?.contracts || []
  if (!list.length) return null
  const isDeep = c => /deep/i.test(c.location_name) || /deep/i.test(c.service_type || '')
  if (cleaningType === 'deep') return list.find(c => /deep clean/i.test(c.location_name)) || list.find(isDeep) || null
  return list.find(c => key(c.location_name) === key(place.name) && c.location_name.trim().toLowerCase() === place.name.trim().toLowerCase())
    || list.find(c => !isDeep(c) && !/ — /.test(c.location_name)) || list[0]
}

/**
 * Saving a contract makes sure its store exists in the place registry (Person → Client → Place → Contract).
 * Returns the place id, or null when it could not be created. An existing place only gets its client filled in.
 */
export async function ensurePlaceForContract(supabase, contract) {
  const name = storeName(contract?.location_name)
  if (!name) return null
  const { data: found } = await supabase.from('locations').select('id,name,client_id,is_active')
  const same = (found || []).filter(l => key(l.name) === key(name))
  const place = same.find(l => l.is_active !== false) || same[0] // a removed place stays removed
  if (place) {
    if (!place.client_id && contract.client_id) await supabase.from('locations').update({ client_id: contract.client_id }).eq('id', place.id)
    return place.id
  }
  const { data, error } = await supabase.from('locations')
    .insert({ name, address: contract.location_address || '', location_type: 'fixed', client_id: contract.client_id || null })
    .select('id').maybeSingle()
  return error ? null : data?.id || null
}
