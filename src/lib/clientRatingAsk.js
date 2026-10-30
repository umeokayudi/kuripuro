// v1.0.115 · At the end of every job the client gets one chat message asking for a rating.
// The message carries "#rate:<job id>"; the client portal turns it into 1–5 stars that save
// to client_ratings (same table as the visit sheet). One message per job, never for test clients.
import { supabase } from './supabase'
import { isTestName } from './testData'
import { contractForAgendaJob } from './agenda'

const RATE_RE = /\n?#rate:([\w-]+)\s*$/

export const rateMarker = id => `#rate:${id}`

/** → job id asked in the message, or null */
export function rateJobId(content) {
  const m = RATE_RE.exec(String(content || ''))
  return m ? m[1] : null
}

/** message text without the marker */
export function stripRateMarker(content) {
  return String(content || '').replace(RATE_RE, '').trim()
}

/** The text the client reads: English + Japanese together (the client portal has only EN / JA, and the choice is per device). */
export function rateMessage(job) {
  const place = String(job?.title || '').split(' — ')[0] || job?.client_name || ''
  const day = String(job?.scheduled_date || '').slice(5).replace('-', '/')
  return [
    `✅ ${place} ${day}`.trim(),
    'Cleaning finished. How was it? Tap the stars. · 清掃が完了しました。星をタップして評価してください。',
    rateMarker(job.id),
  ].join('\n')
}

/** Fire-and-forget after a job is completed. Returns true when a message was sent. */
export async function askClientRating(job) {
  try {
    if (!job?.id) return false
    let clientId = job.client_id
    if (!clientId) {
      const { data: contracts } = await supabase.from('service_contracts').select('client_id,location_name,service_type,is_active').eq('is_active', true)
      clientId = contractForAgendaJob(job, contracts || [])?.client_id
    }
    if (!clientId) return false
    const { data: client } = await supabase.from('clients').select('id,company_name').eq('id', clientId).maybeSingle()
    if (!client || isTestName(client.company_name) || isTestName(job.client_name)) return false
    const [{ data: asked }, { data: rated }] = await Promise.all([
      supabase.from('client_messages').select('id').eq('client_id', clientId).like('content', `%${rateMarker(job.id)}%`).limit(1),
      supabase.from('client_ratings').select('id').eq('job_id', job.id).limit(1),
    ])
    if (asked?.length || rated?.length) return false
    const { error } = await supabase.from('client_messages').insert({
      client_id: clientId, client_name: client.company_name, location_name: String(job.title || '').split(' — ')[0] || null,
      sender: 'admin', content: rateMessage(job), read: false,
    })
    return !error
  } catch {
    return false
  }
}
