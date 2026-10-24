// v1.0.73 · Photos and dates of the last cleanings of a store (or of one equipment / area).
// Used by CleaningTimeline in the 3D map, the store sheet (quotes, client requests) and the client sheet.
//
// Entry: { id, date: 'YYYY-MM-DD', who, what, notes, photos: [{ url, label }], source: 'job' | 'log' }
import { supabase } from './supabase'
import { listServiceLog } from './facilityApi'
import { totalSquareMeters } from './facilityModel'

const storeBase = name => String(name || '').split(/\s+[-—–]\s+/)[0].trim().toLowerCase()

/** facility_service_log rows → entries (one per log). */
export function entriesFromLogs(logs = []) {
  return (logs || []).filter(l => l?.service_date).map(l => ({
    id: `log:${l.id}`,
    date: String(l.service_date).slice(0, 10),
    who: l.employee_name || '',
    what: [l.element_name, l.service].filter(Boolean).join(' · '),
    notes: l.notes || '',
    photos: (Array.isArray(l.photos) ? l.photos : []).map(url => ({ url, label: null })),
    source: 'log',
  }))
}

/** Completed jobs → entries; the start photo is "before", the end photo is "after". */
export function entriesFromJobs(jobs = []) {
  return (jobs || []).filter(j => j?.scheduled_date && (j.status === 'completed' || j.completed_at)).map(j => ({
    id: `job:${j.id}`,
    date: String(j.scheduled_date).slice(0, 10),
    who: j.employee_name || '',
    what: String(j.title || '').replace(/^.*? — /, ''),
    notes: '',
    photos: [
      j.photo_start_url && { url: j.photo_start_url, label: 'before' },
      j.photo_end_url && { url: j.photo_end_url, label: 'after' },
    ].filter(Boolean),
    source: 'job',
  }))
}

/** Newest first. */
export function sortEntries(entries) {
  return [...entries].sort((a, b) => b.date.localeCompare(a.date) || (b.photos.length - a.photos.length))
}

/** Size line of a model: "12 × 8 m · 96 m²". */
export function sizeLabel(layout) {
  if (!layout?.width || !layout?.depth) return ''
  return `${layout.width} × ${layout.depth} m · ${totalSquareMeters(layout)} m²`
}

/**
 * Photos of the place itself (to get a sense of size): the store's model photos first,
 * then the equipment photos, then the "after" photos of past cleanings (clean place, newest first).
 */
export function placePhotosOf(model, entries = []) {
  const own = [...(model?.photos || []), ...(model?.layout?.elements || []).flatMap(e => e.photos || [])]
  const after = entries.flatMap(e => e.photos.filter(p => p.label !== 'before').map(p => p.url))
  return [...new Set([...own, ...after])].slice(0, 12)
}

/**
 * Store timeline: completed jobs of that store (title starts with the store name) + facility log.
 * locationName empty → every store of the client.
 */
export async function loadStoreTimeline({ clientId, locationName, model = null, logs = null }) {
  if (!clientId) return []
  const [{ data: jobs }, facilityLogs] = await Promise.all([
    supabase.from('jobs')
      .select('id,title,scheduled_date,status,completed_at,employee_name,photo_start_url,photo_end_url')
      .eq('client_id', clientId)
      .eq('status', 'completed')
      .order('scheduled_date', { ascending: false })
      .limit(200),
    logs ? Promise.resolve(logs) : (model ? listServiceLog({ modelId: model.id }) : listServiceLog({ clientId })),
  ])
  const store = storeBase(locationName)
  const ownJobs = (jobs || []).filter(j => !store || storeBase(j.title).startsWith(store) || String(j.title || '').toLowerCase().startsWith(store))
  const ownLogs = (facilityLogs || []).filter(l => !store || !l.location_name || storeBase(l.location_name) === store)
  return sortEntries([...entriesFromJobs(ownJobs), ...entriesFromLogs(ownLogs)])
}
