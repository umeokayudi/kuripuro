// v1.0.102 · After a deploy the open tab still asks for the old file names (/assets/Page-<old hash>.js),
// which no longer exist: "Failed to fetch dynamically imported module". The app then reloads ONCE to
// pick up the new version (file names carry their hash, index.html is never cached). If it fails again
// within 30 s it stops, so a real network problem never turns into a reload loop.
const KEY = 'kp_chunk_reload_at'

export function isChunkError(e) {
  const msg = String(e?.message || e || '')
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading (CSS )?chunk .* failed|Unable to preload CSS/i.test(msg)
}

export function reloadOnceForNewVersion() {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0)
    if (Date.now() - last < 30000) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    return false // no storage: never risk a loop
  }
  window.location.reload()
  return true
}

export function installChunkRecovery() {
  if (typeof window === 'undefined') return
  window.addEventListener('vite:preloadError', e => { if (reloadOnceForNewVersion()) e.preventDefault() })
  window.addEventListener('unhandledrejection', e => { if (isChunkError(e.reason)) reloadOnceForNewVersion() })
}
