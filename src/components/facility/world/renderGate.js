// v1.0.102 · The 3D only draws while someone can see it: it stops with the tab hidden or the canvas
// off screen, and calms down to a few frames per second (none when the window is out of focus) once
// nobody has touched it for a few seconds. Keeps the rest of the page (menu, buttons) responsive.
export function renderGate(host, { idleMs = 4000, idleFps = 6 } = {}) {
  let docOn = typeof document === 'undefined' || !document.hidden
  let viewOn = true
  let focusOn = typeof document === 'undefined' || !document.hasFocus || document.hasFocus()
  let last = performance.now()
  let lastDraw = 0
  let resume = null
  const wake = () => { if (docOn && viewOn) resume?.() }
  const poke = () => { last = performance.now(); wake() }
  const onVis = () => { docOn = !document.hidden; if (docOn) poke() }
  const onFocus = () => { focusOn = true; poke() }
  const onBlur = () => { focusOn = false }
  document.addEventListener('visibilitychange', onVis)
  window.addEventListener('focus', onFocus)
  window.addEventListener('blur', onBlur)
  const events = ['pointerdown', 'pointermove', 'wheel', 'touchstart', 'keydown']
  events.forEach(e => host.addEventListener(e, poke, { passive: true }))
  let io = null
  if (typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver(entries => {
      viewOn = entries.some(en => en.isIntersecting)
      if (viewOn) poke()
    })
    io.observe(host)
  }
  return {
    /** false = stop the loop until `onResume` is called again */
    active: () => docOn && viewOn,
    /** should this frame be drawn? busy = an animation the user is waiting for (fly-to, walking) */
    shouldDraw(now, busy = false) {
      if (busy || now - last < idleMs) { lastDraw = now; return true }
      if (!focusOn || !idleFps) return false
      if (now - lastDraw >= 1000 / idleFps) { lastDraw = now; return true }
      return false
    },
    poke,
    set onResume(fn) { resume = fn },
    dispose() {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      events.forEach(e => host.removeEventListener(e, poke))
      io?.disconnect()
      resume = null
    },
  }
}
