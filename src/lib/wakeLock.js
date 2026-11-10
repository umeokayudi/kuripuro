// v1.0.199 · Keeps the phone screen on while a video is being compressed or sent.
// A phone that locks its screen pauses the page, so a long upload stopped in the middle and
// only went on when the app was opened again (some videos arrived ~1 h after the job).
// Counted: several tasks can hold it; the screen may sleep again when the last one ends.
// Best effort: browsers without the Wake Lock API simply keep working as before.

let holders = 0
let sentinel = null

async function request() {
  try {
    if (typeof navigator === 'undefined' || !navigator.wakeLock?.request) return
    if (sentinel || document.visibilityState !== 'visible') return
    sentinel = await navigator.wakeLock.request('screen')
    sentinel.addEventListener?.('release', () => { sentinel = null })
  } catch { sentinel = null }
}

// The system drops the lock when the app goes to the background: ask again when it is back.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (holders > 0 && document.visibilityState === 'visible') request()
  })
}

/** Keeps the screen on until the returned function is called (call it once). */
export function holdScreenOn() {
  holders++
  request()
  let done = false
  return () => {
    if (done) return
    done = true
    holders = Math.max(0, holders - 1)
    if (holders === 0 && sentinel) {
      const s = sentinel
      sentinel = null
      s.release?.().catch(() => {})
    }
  }
}
