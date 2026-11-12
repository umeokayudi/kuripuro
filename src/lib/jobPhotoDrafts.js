// v1.0.199 · Photos taken during a job are kept on the phone (IndexedDB) right away.
// Before, the Before/After photos lived only in the page memory until "Finish": when the phone
// closed the page (a heavy video, low memory, the app went to the background for long), every
// photo of the job was lost. Now they come back by themselves when the app opens again, and
// leave this phone only once the job no longer needs them (started / finished / removed).
// Everything is try/catch: without IndexedDB (private tab) the app works as before.

const DB_NAME = 'kp-job-photo-drafts'
const STORE = 'photos'
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000
/** Key used for Before photos taken while no job is running yet. */
export const NEXT_JOB_KEY = 'next'

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'))
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run(mode, fn) {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      let result
      Promise.resolve(fn(tx.objectStore(STORE))).then(r => { result = r }, reject)
      tx.oncomplete = () => resolve(result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

const all = (store) => new Promise((resolve, reject) => {
  const r = store.getAll()
  r.onsuccess = () => resolve(r.result || [])
  r.onerror = () => reject(r.error)
})

/** Saves one photo of the job (key = job id, or NEXT_JOB_KEY before the job starts). */
export async function saveDraftPhoto(key, { id, slot, file }) {
  if (!file) return false
  try {
    await run('readwrite', s => {
      s.put({ id: String(id), key: String(key), slot, blob: file, name: file.name || 'photo.jpg', type: file.type || 'image/jpeg', createdAt: Date.now() })
    })
    return true
  } catch {
    return false
  }
}

export async function removeDraftPhoto(id) {
  try { await run('readwrite', s => { s.delete(String(id)) }) } catch { /* ignore */ }
}

/**
 * Photos kept for this key, oldest first, as `{ id, slot, file }` ready for the photo list.
 * Old leftovers (> 3 days) are cleaned on the way.
 */
export async function loadDraftPhotos(key) {
  try {
    const rows = await run('readonly', s => all(s))
    const now = Date.now()
    const old = rows.filter(r => now - (r.createdAt || 0) > MAX_AGE_MS)
    if (old.length) run('readwrite', s => { old.forEach(r => s.delete(r.id)) }).catch(() => {})
    return rows
      .filter(r => r.key === String(key) && r.blob && now - (r.createdAt || 0) <= MAX_AGE_MS)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(r => {
        const file = r.blob instanceof File ? r.blob : new File([r.blob], r.name || 'photo.jpg', { type: r.type || r.blob.type || 'image/jpeg' })
        return { id: r.id, slot: r.slot, file }
      })
  } catch {
    return []
  }
}

/**
 * Keeps the stored photos equal to the photo list on screen: new ones are saved under `key`,
 * the ones no longer on screen (removed, started, finished) are deleted.
 * `known` is a Map id → key kept by the caller between calls.
 */
export function syncDraftPhotos(known, key, photos) {
  const onScreen = new Set(photos.map(p => String(p.id)))
  for (const p of photos) {
    const id = String(p.id)
    if (known.has(id) || !p.file) continue
    known.set(id, key)
    saveDraftPhoto(key, { id, slot: p.slot, file: p.file })
  }
  for (const id of [...known.keys()]) {
    if (onScreen.has(id)) continue
    known.delete(id)
    removeDraftPhoto(id)
  }
}
