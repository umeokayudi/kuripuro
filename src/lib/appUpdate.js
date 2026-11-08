// v1.0.188 · A phone keeps the app open for days, so it kept running an old version after a new one
// was published (Já fiz still showed the Android clock, cards wider than the screen…).
// When the app comes back to the screen (and every 10 min while open) it asks the server which
// version is live; if it is a newer one, it reloads itself — but never in the middle of something
// (a popup open or a field being typed in), and at most once per version.
import { APP_VERSION } from '../version'

const CHECK_EVERY_MS = 10 * 60 * 1000
const RELOADED_KEY = 'kp_reloaded_for'

/** 'v1.0.188' from '2026-11-08-v1.0.188' (the server build label); null when unknown. */
export function versionOfBuild(build) {
  const m = String(build || '').match(/v\d+\.\d+\.\d+/)
  return m ? m[0] : null
}

/** Numeric compare of 'v1.0.188' strings. */
export function compareVersions(a, b) {
  const pa = String(a || '').replace(/^v/, '').split('.').map(Number)
  const pb = String(b || '').replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d > 0 ? 1 : -1
  }
  return 0
}

/** True when the server runs a different (newer) version than this tab. */
export function isNewerBuild(serverBuild, mine = APP_VERSION) {
  const v = versionOfBuild(serverBuild)
  return !!v && compareVersions(v, mine) > 0
}

/** The person is in the middle of something: a popup/sheet is open, a field has focus or a service is running. */
function busy() {
  if (typeof document === 'undefined') return true
  const el = document.activeElement
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true
  if (document.getElementById('active-job-card')) return true
  return !!document.querySelector('.emp-sheet-backdrop, .jf-overlay, .modal-overlay, [role="dialog"], [aria-modal="true"]')
}

async function check() {
  try {
    const r = await fetch('/api/version', { cache: 'no-store', credentials: 'same-origin' })
    if (!r.ok) return
    const { build } = await r.json()
    if (!isNewerBuild(build)) return
    const target = versionOfBuild(build)
    let done = null
    try { done = sessionStorage.getItem(RELOADED_KEY) } catch { /* private mode */ }
    if (done === target) return // already reloaded once for it (CDN still warming up): don't loop
    if (busy()) return // try again on the next check
    try { sessionStorage.setItem(RELOADED_KEY, target) } catch { /* ignore */ }
    window.location.reload()
  } catch { /* offline / local dev: keep running */ }
}

/** Starts the checks; returns a cleanup function. */
export function startAppUpdateWatch() {
  if (typeof window === 'undefined') return () => {}
  const onVisible = () => { if (document.visibilityState === 'visible') check() }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onVisible)
  const t = setInterval(() => { if (document.visibilityState === 'visible') check() }, CHECK_EVERY_MS)
  check()
  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', onVisible)
    clearInterval(t)
  }
}
