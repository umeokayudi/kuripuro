// v1.0.102 · Admin global search. Before, every key stroke ran "%text%" over the whole jobs table
// (no index, can time out on the free plan) and a store name that only lives in locations / contracts
// was never found ("Kodama" → nothing). Now: clients, places and invoices come from a small list kept
// in memory for 5 minutes and matched here (case, accents and full-width letters ignored), and jobs
// are searched only in a window around today plus every job of the clients / places that matched.
// v1.0.114 · people (employees) are searched too, and results come back in fixed groups
// cliente → local → serviço → fatura → pessoa (see groupResults).
import { supabase } from './supabase'

/** lower case, no accents, full-width → normal, spaces squeezed */
export function normSearch(s) {
  return String(s || '').normalize('NFKC').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** every word of the query appears in the text */
export function matches(text, query) {
  const t = normSearch(text)
  return normSearch(query).split(' ').filter(Boolean).every(w => t.includes(w))
}

let cache = null
let cacheAt = 0
async function baseIndex() {
  if (cache && Date.now() - cacheAt < 5 * 60000) return cache
  const [cl, loc, sc, inv, emp] = await Promise.all([
    supabase.from('clients').select('*').limit(2000),
    supabase.from('locations').select('id,name,client_id,address').limit(3000),
    supabase.from('service_contracts').select('id,client_id,location_name,location_address').limit(3000),
    supabase.from('faturas').select('id,client_id,client_name,issue_date,due_date,total,status,period_start').order('issue_date', { ascending: false }).limit(2000),
    supabase.from('employees').select('id,full_name,job_role,is_active').limit(1000),
  ])
  if (cl.error && inv.error) throw cl.error
  cache = { clients: cl.data || [], locations: loc.data || [], contracts: sc.data || [], invoices: inv.data || [], people: emp.data || [] }
  cacheAt = Date.now()
  return cache
}
export function resetSearchIndex() { cache = null }

const shift = (days) => new Date(Date.now() + days * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })

export const SEARCH_GROUPS = ['client', 'place', 'job', 'invoice', 'person']

/** results → [{ type, items }] in SEARCH_GROUPS order, empty groups left out */
export function groupResults(results) {
  return SEARCH_GROUPS.map(type => ({ type, items: (results || []).filter(r => r.type === type) })).filter(g => g.items.length)
}

/** places from saved locations AND from contracts (a store that only exists in Contracts, e.g. Kodama Yurakucho),
 * one row per name; a contract row fills the client / address a location row is missing */
export function placeIndex(locations, contracts) {
  const byName = new Map()
  for (const p of [
    ...(locations || []).map(l => ({ id: l.id, name: l.name, client_id: l.client_id, address: l.address, contractOnly: false })),
    ...(contracts || []).map(c => ({ id: `sc-${c.id}`, name: c.location_name, client_id: c.client_id, address: c.location_address, contractOnly: true })),
  ]) {
    if (!p.name) continue
    const k = normSearch(p.name)
    const had = byName.get(k)
    if (!had) byName.set(k, p)
    else byName.set(k, { ...had, client_id: had.client_id || p.client_id, address: had.address || p.address })
  }
  return [...byName.values()]
}

/** → [{ type: 'client'|'place'|'job'|'invoice'|'person', title, meta, to, id }] */
export async function globalSearch(q, { limit = 6 } = {}) {
  const idx = await baseIndex()
  const clientName = Object.fromEntries(idx.clients.map(c => [c.id, c.company_name]))
  const clients = idx.clients.filter(c => matches([c.company_name, c.contact_name, c.company_name_kana, c.name_kana, c.email].filter(Boolean).join(' '), q))
  const places = placeIndex(idx.locations, idx.contracts).filter(p => matches(`${p.name} ${p.address || ''} ${clientName[p.client_id] || ''}`, q))
  const people = idx.people.filter(e => e.full_name && matches(e.full_name, q))
  const invoices = idx.invoices.filter(f => matches(`${f.client_name || clientName[f.client_id] || ''} ${f.status || ''}`, q))

  // jobs: by title in the last 180 / next 90 days, plus the jobs of the clients that matched
  const safe = String(q).replace(/[%,_()]/g, ' ').trim()
  const ids = clients.map(c => c.id).concat(places.map(p => p.client_id)).filter(Boolean)
  const [byTitle, byClient] = await Promise.all([
    safe ? supabase.from('jobs').select('id,title,client_id,scheduled_date,status').gte('scheduled_date', shift(-180)).lte('scheduled_date', shift(90))
      .ilike('title', `%${safe}%`).order('scheduled_date', { ascending: false }).limit(limit) : { data: [] },
    ids.length ? supabase.from('jobs').select('id,title,client_id,scheduled_date,status').in('client_id', [...new Set(ids)].slice(0, 50))
      .gte('scheduled_date', shift(-180)).order('scheduled_date', { ascending: false }).limit(limit) : { data: [] },
  ])
  const jobs = [...new Map([...(byTitle.data || []), ...(byClient.data || [])].map(j => [j.id, j])).values()].slice(0, limit)

  return [
    ...clients.slice(0, limit).map(x => ({ type: 'client', title: x.company_name || x.contact_name || 'Client', meta: x.contact_name && x.company_name ? x.contact_name : '', to: '/clients', id: x.id })),
    ...places.slice(0, limit).map(p => ({ type: 'place', title: p.name, meta: clientName[p.client_id] || p.address || '', contractOnly: p.contractOnly, to: '/clients', id: p.client_id || p.id })),
    ...jobs.map(x => ({ type: 'job', title: x.title || 'Job', meta: [clientName[x.client_id], x.scheduled_date].filter(Boolean).join(' · '), to: '/jobs', id: x.id })),
    ...invoices.slice(0, limit).map(x => ({ type: 'invoice', title: x.client_name || clientName[x.client_id] || 'Invoice', meta: [x.status, x.due_date].filter(Boolean).join(' · '), to: '/faturas', id: x.id })),
    ...people.slice(0, limit).map(e => ({ type: 'person', title: e.full_name, meta: e.job_role || '', inactive: e.is_active === false, to: '/employees', id: e.id })),
  ]
}
