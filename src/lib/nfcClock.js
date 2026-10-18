// Ponto por NFC: the worker taps the sticker at the location to start and to finish a job.
// Web NFC only exists in Chrome on Android; everywhere else the normal button keeps working
// and the job records 'no_device'. Every failure here falls back to "NFC off".
import { businessName } from './nearbyJob.js'

/** Serial number as stored: upper-case hex without separators ("04:a2:5f" → "04A25F"). */
export function normalizeTagUid(raw) {
  return String(raw || '').replace(/[^0-9a-f]/gi, '').toUpperCase()
}

/** Whether NFC is asked for this worker: their own setting wins, else the global switch. */
export function nfcActiveFor(employeeSetting, globalEnabled) {
  if (employeeSetting === 'on') return true
  if (employeeSetting === 'off') return false
  return Boolean(globalEnabled)
}

const norm = s => String(s || '').trim().toLowerCase()

/**
 * Checks a read tag against the job.
 * ok          — the tag belongs to this job's location (or client, when the tag has no location)
 * other_place — registered for somewhere else
 * unknown     — not registered (or turned off)
 */
export function matchTag(uid, tags, job) {
  const id = normalizeTagUid(uid)
  const tag = (tags || []).find(t => t.is_active !== false && normalizeTagUid(t.tag_uid) === id)
  if (!id || !tag) return { status: 'unknown', tag: null }
  const place = norm(businessName(job))
  if (tag.location_name) {
    return { status: norm(tag.location_name) === place ? 'ok' : 'other_place', tag }
  }
  if (tag.client_id && job?.client_id) {
    return { status: tag.client_id === job.client_id ? 'ok' : 'other_place', tag }
  }
  if (tag.client_name && (job?.client_name || place)) {
    const c = norm(tag.client_name)
    return { status: c === norm(job.client_name) || c === place ? 'ok' : 'other_place', tag }
  }
  return { status: 'other_place', tag }
}

/** Where a tag is registered, for messages. */
export function tagPlace(tag) {
  if (!tag) return ''
  return [tag.location_name, tag.client_name].filter(Boolean).join(' · ') || tag.label || normalizeTagUid(tag.tag_uid)
}

export function nfcSupported() {
  return typeof window !== 'undefined' && 'NDEFReader' in window
}

/**
 * Starts listening for one tag. Call it straight from a button tap (Chrome asks permission on the first use).
 * Returns { promise, cancel }: promise resolves with the serial number, rejects on error or cancel.
 */
export function readOneTag() {
  const ctrl = new AbortController()
  const promise = new Promise((resolve, reject) => {
    if (!nfcSupported()) { reject(new Error('unsupported')); return }
    try {
      const reader = new window.NDEFReader()
      reader.onreading = ev => { resolve(normalizeTagUid(ev.serialNumber)); ctrl.abort() }
      reader.onreadingerror = () => reject(new Error('read_error'))
      reader.scan({ signal: ctrl.signal }).catch(reject)
      ctrl.signal.addEventListener('abort', () => reject(new Error('cancelled')))
    } catch (err) { reject(err) }
  })
  return { promise, cancel: () => ctrl.abort() }
}

/** Global switch + this worker's setting + active tags. Any error (tables not created yet) → off. */
export async function loadNfcConfig(supabase, employeeId) {
  try {
    const [settings, emp, tags] = await Promise.all([
      supabase.from('nfc_settings').select('enabled').eq('id', 1).maybeSingle(),
      supabase.from('employees').select('nfc_clock').eq('id', employeeId).maybeSingle(),
      supabase.from('nfc_tags').select('*').eq('is_active', true),
    ])
    if (settings.error || tags.error) return { active: false, tags: [] }
    return {
      active: nfcActiveFor(emp.error ? null : emp.data?.nfc_clock, settings.data?.enabled),
      tags: tags.data || [],
    }
  } catch {
    return { active: false, tags: [] }
  }
}

/** Saves the start/finish result on the job and marks the tag as seen. Never throws. */
export async function saveNfcResult(supabase, jobId, phase, result) {
  if (!result || !jobId) return
  try {
    const fields = phase === 'start'
      ? { nfc_start_tag: result.uid || null, nfc_start_status: result.status }
      : { nfc_end_tag: result.uid || null, nfc_end_status: result.status }
    await supabase.from('jobs').update(fields).eq('id', jobId)
    if (result.tag?.id) await supabase.from('nfc_tags').update({ last_seen_at: new Date().toISOString() }).eq('id', result.tag.id)
  } catch (ex) { console.log('nfc fields skipped', ex?.message) }
}
