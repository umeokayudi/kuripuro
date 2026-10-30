import { supabase } from './supabase'

// v1.0.107 · Key box codes: who may reveal them and the log of who did.
export const KEY_ROLES = ['admin', 'employee']

export function canRevealKey(user, roles = KEY_ROLES) {
  return !!user && roles.includes(user.role)
}

const STAMP = /^\[\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?\]/

/** First line of jobs.description is the key box / access line; stamped note lines are not. */
export function splitKeyLine(description) {
  const lines = String(description || '').split('\n')
  if (!lines[0].trim() || STAMP.test(lines[0].trim())) return { key: '', rest: lines.join('\n').trim() }
  return { key: lines[0].trim(), rest: lines.slice(1).join('\n').trim() }
}

/** One row per reveal. Returns false while sql/2026-10-30_registro_keybox.sql is not applied. */
export async function logKeyReveal(user, { source, refId = null, label = null } = {}) {
  if (!user) return false
  try {
    const { error } = await supabase.from('key_reveal_log').insert({
      viewer_id: user.id != null ? String(user.id) : null,
      viewer_name: user.name || user.email || null,
      viewer_role: user.role,
      source: source || 'other',
      ref_id: refId != null ? String(refId) : null,
      ref_label: label,
    })
    return !error
  } catch {
    return false
  }
}

/** Latest reveals for the admin; null when the table is not there yet. */
export async function loadKeyReveals(limit = 100) {
  const { data, error } = await supabase.from('key_reveal_log').select('*').order('created_at', { ascending: false }).limit(limit)
  return error ? null : (data || [])
}
