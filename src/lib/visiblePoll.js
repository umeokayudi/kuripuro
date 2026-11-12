// v1.0.204 · Automatic refresh that pauses while the tab/app is in the background.
// A screen left open in another tab (or a phone with the app minimised) used to keep hitting the
// database every 10–60 s for nobody. Now the tick is skipped while hidden, and if at least one tick
// was skipped, `fn` runs once as soon as the screen is visible again — so what you see is never older
// than before. Returns a stop function (use it in the effect cleanup).
export function pollWhileVisible(fn, ms) {
  if (typeof document === 'undefined') {
    const id = setInterval(fn, ms)
    return () => clearInterval(id)
  }
  let missed = false
  const id = setInterval(() => {
    if (document.visibilityState === 'hidden') { missed = true; return }
    fn()
  }, ms)
  const onVisible = () => {
    if (document.visibilityState === 'visible' && missed) { missed = false; fn() }
  }
  document.addEventListener('visibilitychange', onVisible)
  return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
}
