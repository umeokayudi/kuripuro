// api/cleanup-photos.js
// Apaga fotos de jobs concluídos há mais de 60 dias e reporta o uso de
// armazenamento. Pode ser chamada manualmente (botão no admin) ou por cron.

const SUPABASE_URL = 'https://fxsakrshmldmkdmbevna.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4c2FrcnNobWxkbWtkbWJldm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjYwMTEsImV4cCI6MjA5NjcwMjAxMX0.OSnexIDC2bflyDmCTd_pjvcbswB77ri5lDdccEfANMo'
const BUCKET = 'service-photos'
const DAYS = 60

async function sb(path, options = {}) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  const t = await resp.text()
  try { return JSON.parse(t) } catch { return t }
}

async function listFolder(prefix) {
  const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 1000 }),
  })
  return resp.ok ? await resp.json() : []
}

export default async function handler(req, res) {
  try {
    const dryRun = req.method === 'GET' // GET = só reporta, POST = apaga de verdade
    const cutoff = new Date(Date.now() - DAYS * 86400000).toISOString().split('T')[0]

    // Jobs concluídos antigos que ainda têm foto registrada
    const oldJobs = await sb(`jobs?select=id,scheduled_date,photo_start_url,photo_end_url&status=eq.completed&scheduled_date=lt.${cutoff}&or=(photo_start_url.not.is.null,photo_end_url.not.is.null)&limit=500`)

    let toDelete = []
    for (const j of (Array.isArray(oldJobs) ? oldJobs : [])) {
      const files = await listFolder(`jobs/${j.id}`)
      for (const f of files) toDelete.push(`jobs/${j.id}/${f.name}`)
    }

    let deleted = 0
    if (!dryRun && toDelete.length) {
      const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
        method: 'DELETE',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: toDelete }),
      })
      if (resp.ok) {
        deleted = toDelete.length
        // limpa as URLs no banco
        for (const j of oldJobs) {
          await sb(`jobs?id=eq.${j.id}`, { method: 'PATCH', body: JSON.stringify({ photo_start_url: null, photo_end_url: null }) })
        }
      }
    }

    res.status(200).json({
      cutoffDate: cutoff,
      daysKept: DAYS,
      oldJobsWithPhotos: Array.isArray(oldJobs) ? oldJobs.length : 0,
      filesFound: toDelete.length,
      filesDeleted: deleted,
      mode: dryRun ? 'preview' : 'deleted',
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
