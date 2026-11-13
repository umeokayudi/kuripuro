// v1.0.234 · Every photo and video of one service, or of a client in a period, in ONE zip file.
// Built in the browser (lib/zipStore, no compression: photos and videos are already compressed).
// Very large sets are split into parts of ~350 MB so a phone or an old laptop does not run out of memory.
import { supabase } from './supabase'
import { zipFiles } from './zipStore'
import { mediaForJobs } from './workMedia'
import { storagePublicUrl } from './workReport'
import { splitName } from './schedulePlan'

export const PART_BYTES = 350 * 1024 * 1024
// eslint-disable-next-line no-control-regex
const safe = s => String(s || '').normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'servico'
const LABEL = { before: 'antes', after: 'depois' }

/** Folder + file names inside the zip: "2026-10-05 Loja Norte - Deep Clean/antes_1.jpg". Pure. */
export function zipEntries(jobs, media) {
  const entries = []
  const usedFolders = new Map()
  for (const job of [...jobs].sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)) || String(a.title).localeCompare(String(b.title)))) {
    const list = media.get(job.id) || []
    if (!list.length) continue
    const { base, rest } = splitName(job.title)
    let folder = `${job.scheduled_date || 'sem-data'} ${safe(rest ? `${base} - ${rest}` : base)}`
    const n = (usedFolders.get(folder) || 0) + 1
    usedFolders.set(folder, n)
    if (n > 1) folder += ` (${n})`
    const count = {}
    for (const m of list) {
      const kind = m.kind === 'video' ? 'video' : (LABEL[m.section] || 'foto')
      count[kind] = (count[kind] || 0) + 1
      const ext = (String(m.path).split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg'
      entries.push({ path: m.path, name: `${folder}/${kind}_${count[kind]}.${ext}`, job_id: job.id })
    }
  }
  return entries
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

/**
 * Downloads everything of these jobs. onProgress({ stage: 'list'|'files'|'zip', done, total, part }).
 * @returns {{ files, missing, parts, bytes }}
 */
export async function downloadJobsZip(jobs, { name = 'kuripuro-midia', onProgress } = {}) {
  onProgress?.({ stage: 'list', done: 0, total: jobs.length })
  const media = await mediaForJobs(jobs, { onProgress: (done, total) => onProgress?.({ stage: 'list', done, total }) })
  const entries = zipEntries(jobs, media)
  if (!entries.length) return { files: 0, missing: 0, parts: 0, bytes: 0 }
  let part = [], partBytes = 0, parts = 0, files = 0, missing = 0, bytes = 0, i = 0
  const flush = last => {
    if (!part.length) return
    parts++
    onProgress?.({ stage: 'zip', done: files, total: entries.length, part: parts })
    saveBlob(zipFiles(part), `${safe(name)}${last && parts === 1 ? '' : `-parte${parts}`}.zip`)
    part = []; partBytes = 0
  }
  const queue = [...entries]
  const worker = async () => {
    while (queue.length) {
      const e = queue.shift()
      try {
        const r = await fetch(storagePublicUrl(e.path), { cache: 'no-store' })
        if (!r.ok) throw new Error(String(r.status))
        const data = new Uint8Array(await r.arrayBuffer())
        if (partBytes + data.length > PART_BYTES && part.length) flush(false)
        part.push({ name: e.name, data }); partBytes += data.length; bytes += data.length; files++
      } catch { missing++ }
      onProgress?.({ stage: 'files', done: ++i, total: entries.length, part: parts + 1 })
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  flush(true)
  return { files, missing, parts, bytes }
}

const JOB_FIELDS = 'id,title,client_id,client_name,scheduled_date,status,photo_start_url,photo_end_url'

/** Jobs of a client in a period that may have media (anything started or finished). */
export async function jobsForClientPeriod(clientId, from, to) {
  const { data, error } = await supabase.from('jobs').select(JOB_FIELDS).eq('client_id', clientId)
    .gte('scheduled_date', from).lte('scheduled_date', to).neq('status', 'cancelled').order('scheduled_date').limit(3000)
  if (error) throw new Error(error.message)
  return data || []
}
