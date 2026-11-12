// v1.0.206 · Visitas agendadas do vendedor, guardadas no Storage privado (sem SQL):
// system-private/sales-visits/<sellerId>.json = [{ id, lead_id, date, time, duration_min, status, place, address, note, ... }]
// Only the service role reads/writes this folder (the browser never gets its path).
// system-private: private bucket, any file type, no storage policies → service role only.
// (sales-private only accepts images/PDF/audio, so JSON cannot live there.)
export const PRIVATE_JSON_BUCKET = 'system-private'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const pathOf = sellerId => `sales-visits/${sellerId}.json`

export async function readSellerVisits(db, sellerId) {
  if (!UUID.test(String(sellerId || ''))) return []
  const bucket = db.storage.from(PRIVATE_JSON_BUCKET)
  // Check the file exists first: a "not found" is an empty list, any other failure must stop a
  // save (otherwise a network hiccup would overwrite the seller's visits with an empty list).
  const { data: found, error: listError } = await bucket.list('sales-visits', { search: `${sellerId}.json`, limit: 5 })
  if (listError) throw listError
  if (!(found || []).some(f => f.name === `${sellerId}.json`)) return []
  const { data, error } = await bucket.download(pathOf(sellerId))
  if (error) throw error
  const rows = JSON.parse(await data.text())
  return Array.isArray(rows) ? rows.filter(r => r && r.id && r.date).map(r => ({ ...r, salesperson_id: sellerId })) : []
}

export async function writeSellerVisits(db, sellerId, rows) {
  if (!UUID.test(String(sellerId || ''))) throw Object.assign(new Error('Vendedor inválido.'), { status: 400 })
  const clean = (rows || []).map(({ salesperson_id: _s, ...r }) => r)
  const body = Buffer.from(JSON.stringify(clean))
  const { error } = await db.storage.from(PRIVATE_JSON_BUCKET).upload(pathOf(sellerId), body, { contentType: 'application/json', upsert: true, cacheControl: '0' })
  if (error) throw error
}

/** Admin: every seller's visits (one small file per seller). */
export async function readAllVisits(db, sellerIds = []) {
  const ids = [...new Set((sellerIds || []).filter(id => UUID.test(String(id || ''))))]
  const lists = await Promise.all(ids.map(id => readSellerVisits(db, id).catch(() => [])))
  return lists.flat()
}

/** Pasted / typed lead data kept as the proof of where a lead came from (instead of a card photo). */
export async function saveLeadDump(db, sellerId, payload) {
  const path = `sales-dumps/${sellerId}/dados-${crypto.randomUUID()}.json`
  const { error } = await db.storage.from(PRIVATE_JSON_BUCKET).upload(path, Buffer.from(JSON.stringify(payload)), { contentType: 'application/json', upsert: false })
  if (error) throw error
  return path
}
