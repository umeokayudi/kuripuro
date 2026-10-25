// Fila de vídeos ainda não enviados, guardada no próprio celular (IndexedDB).
// O vídeo entra na fila antes do envio e só sai quando o Storage confirma. Se o app fechar,
// a tela bloquear ou a internet cair, ele é enviado de novo quando o app abrir ou a rede voltar.
// Tudo com try/catch: sem IndexedDB (aba anônima etc.) o envio segue normal, só sem a fila.

const DB_NAME = 'kp-video-queue'
const STORE = 'pending'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

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

async function withStore(mode, fn) {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const store = tx.objectStore(STORE)
      let result
      Promise.resolve(fn(store)).then(r => { result = r }, reject)
      tx.oncomplete = () => resolve(result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

const reqToPromise = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
})

/** Guarda o vídeo na fila. Devolve o id (ou null se o aparelho não deixar guardar). */
export async function enqueueVideo(jobId, { blob, contentType, ext }) {
  const id = `${jobId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  try {
    await withStore('readwrite', store => { store.put({ id, jobId, blob, contentType, ext, createdAt: Date.now(), attempts: 0 }) })
    return id
  } catch {
    return null
  }
}

export async function removeQueuedVideo(id) {
  if (!id) return
  try { await withStore('readwrite', store => { store.delete(id) }) } catch { /* ignora */ }
}

export async function listQueuedVideos() {
  try {
    const all = await withStore('readonly', store => reqToPromise(store.getAll()))
    return (all || []).sort((a, b) => a.createdAt - b.createdAt)
  } catch {
    return []
  }
}

async function markAttempt(item) {
  try { await withStore('readwrite', store => { store.put({ ...item, attempts: (item.attempts || 0) + 1, lastTry: Date.now() }) }) } catch { /* ignora */ }
}

const inFlight = new Set()
const isLimitError = (err) => /Limite/.test(err?.message || '')

async function sendItem(item, upload, onProgress) {
  inFlight.add(item.id)
  try {
    const path = await upload(item.jobId, item, { onProgress })
    await removeQueuedVideo(item.id)
    return path
  } catch (err) {
    // Limite de vídeos do serviço: tentar de novo não resolve
    if (isLimitError(err)) await removeQueuedVideo(item.id)
    else await markAttempt(item)
    throw err
  } finally {
    inFlight.delete(item.id)
  }
}

/**
 * Guarda o vídeo na fila e já tenta enviar. Se falhar, ele continua na fila (err.queued = true)
 * e `flushVideoQueue` manda depois. `upload(jobId, video, { onProgress })` é o uploadJobVideo.
 */
export async function enqueueAndSend(jobId, video, upload, { onProgress } = {}) {
  const id = await enqueueVideo(jobId, video)
  if (!id) return upload(jobId, video, { onProgress })
  try {
    return await sendItem({ id, jobId, ...video, attempts: 0, createdAt: Date.now() }, upload, onProgress)
  } catch (err) {
    err.queued = !isLimitError(err)
    throw err
  }
}

let running = null

/**
 * Envia o que estiver na fila, um por vez (pula o que já está sendo enviado agora).
 * Vídeos com mais de 7 dias são descartados. Chamadas ao mesmo tempo reaproveitam a mesma rodada.
 * @returns {Promise<{sent: number, failed: number}>}
 */
export function flushVideoQueue(upload) {
  if (running) return running
  running = (async () => {
    let sent = 0
    let failed = 0
    for (const item of await listQueuedVideos()) {
      if (inFlight.has(item.id)) continue
      if (Date.now() - (item.createdAt || 0) > MAX_AGE_MS || !item.blob) {
        await removeQueuedVideo(item.id)
        continue
      }
      try {
        await sendItem(item, upload)
        sent++
      } catch {
        failed++
      }
    }
    return { sent, failed }
  })().finally(() => { running = null })
  return running
}
