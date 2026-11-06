// v1.0.164 · The admin's own signature on one service ("Adicionar minha assinatura" at the end of
// the job detail in Reports). No SQL: one small JSON per job in the public service-photos bucket,
//   job-signatures/<jobId>.json  →  { url (PNG data URL), name, by_id, at }
// The one-tap report and the day report print it as the owner's signature.
import { supabase } from './supabase'
import { storagePublicUrl } from './workReport'

const BUCKET = 'service-photos'
const pathOf = jobId => `job-signatures/${jobId}.json`

export async function loadJobAdminSignature(jobId) {
  if (!jobId) return null
  try {
    const r = await fetch(`${storagePublicUrl(pathOf(jobId))}?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return null
    const j = await r.json()
    return j?.url ? j : null
  } catch { return null }
}

export async function saveJobAdminSignature(jobId, { url, name, byId }) {
  if (!jobId || !url) throw new Error('Assinatura?')
  const sig = { url, name: name || '', by_id: byId || null, at: new Date().toISOString() }
  const body = new Blob([JSON.stringify(sig)], { type: 'application/json' })
  const { error } = await supabase.storage.from(BUCKET).upload(pathOf(jobId), body, { upsert: true, contentType: 'application/json', cacheControl: '0' })
  if (error) throw new Error(error.message)
  return sig
}

export async function removeJobAdminSignature(jobId) {
  const { error } = await supabase.storage.from(BUCKET).remove([pathOf(jobId)])
  if (error) throw new Error(error.message)
}
