// v1.0.154 · Route settings with NO database change: one small JSON in the public bucket
// service-photos/settings/rota.json (same way as the service reports).
//   cutoff  'HH:MM' of the evening before: after it, "esperado" with no mark = SEM CONFIRMAÇÃO and a
//           free job nobody took = SEM COBERTURA (and both go to the bell that same night).
//   planB   { '<store key>': [employeeId 1º reserva, employeeId 2º reserva] } — display only.
import { supabase } from './supabase.js'
import { SHIFT_CUTOFF } from './dayPanel.js'

const BUCKET = 'service-photos'
const PATH = 'settings/rota.json'
export const ROUTE_SETTINGS_CHANGED = 'kp-route-settings-changed'
export const storeKey = s => String(s || '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim()

export const DEFAULT_ROUTE_SETTINGS = { cutoff: SHIFT_CUTOFF, planB: {} }
let cache = null

/** Clean what was read (anything odd falls back to the defaults). */
export function normalizeRouteSettings(raw) {
  const cutoff = /^([01]\d|2[0-3]):[0-5]\d$/.test(raw?.cutoff || '') ? raw.cutoff : SHIFT_CUTOFF
  const planB = {}
  for (const [k, v] of Object.entries(raw?.planB || {})) {
    const ids = (Array.isArray(v) ? v : []).filter(x => typeof x === 'string' && x).slice(0, 2)
    if (ids.length) planB[storeKey(k)] = ids
  }
  return { cutoff, planB }
}

export async function fetchRouteSettings({ fresh = false } = {}) {
  if (cache && !fresh) return cache
  try {
    const url = supabase.storage.from(BUCKET).getPublicUrl(PATH).data?.publicUrl
    const r = url ? await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' }) : null
    cache = normalizeRouteSettings(r?.ok ? await r.json() : null)
  } catch {
    cache = normalizeRouteSettings(null)
  }
  return cache
}

export async function saveRouteSettings(next) {
  const clean = normalizeRouteSettings(next)
  const body = new Blob([JSON.stringify({ ...clean, updated_at: new Date().toISOString() })], { type: 'application/json' })
  const { error } = await supabase.storage.from(BUCKET).upload(PATH, body, { upsert: true, contentType: 'application/json', cacheControl: '0' })
  if (error) throw new Error(error.message)
  cache = clean
  try { window.dispatchEvent(new Event(ROUTE_SETTINGS_CHANGED)) } catch { /* SSR */ }
  return clean
}

/** Set (or clear, with an empty list) the plan B of one store. */
export async function savePlanB(store, ids) {
  const cur = await fetchRouteSettings({ fresh: true })
  const planB = { ...cur.planB }
  const list = (ids || []).filter(Boolean).slice(0, 2)
  if (list.length) planB[storeKey(store)] = list
  else delete planB[storeKey(store)]
  return saveRouteSettings({ ...cur, planB })
}
