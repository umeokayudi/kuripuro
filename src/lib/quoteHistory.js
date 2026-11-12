// v1.0.211 · Quote history (見積書): who sent, reopened, accepted… kept next to the quote in Storage
// (service-photos/quotes/<quoteId>/history.json), so no SQL is needed. The quote row keeps its number
// and its first sent_at; this file keeps every step.
import { supabase, SUPABASE_URL } from './supabase'

const BUCKET = 'service-photos'
const validId = id => /^[\w-]{6,64}$/.test(String(id || ''))
export const quoteFolder = id => `quotes/${id}`
const historyPath = id => `${quoteFolder(id)}/history.json`

export function storageUrl(path) {
  if (!path) return ''
  if (/^(https?:|data:|blob:)/.test(path)) return path
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${String(path).split('/').map(encodeURIComponent).join('/')}`
}

export async function loadQuoteHistory(id) {
  if (!validId(id)) return []
  try {
    const r = await fetch(`${storageUrl(historyPath(id))}?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return []
    const j = await r.json()
    return Array.isArray(j?.events) ? j.events : []
  } catch { return [] }
}

/** Adds one step: { action: 'sent'|'reopened'|'accepted'|'declined'|…, by, note }. Never throws. */
export async function addQuoteHistory(id, event) {
  if (!validId(id)) return
  try {
    const events = await loadQuoteHistory(id)
    events.push({ at: new Date().toISOString(), ...event })
    const body = new Blob([JSON.stringify({ quote_id: id, events })], { type: 'application/json' })
    await supabase.storage.from(BUCKET).upload(historyPath(id), body, { upsert: true, contentType: 'application/json', cacheControl: '0' })
  } catch (err) { console.warn('[quoteHistory]', err?.message || err) }
}
