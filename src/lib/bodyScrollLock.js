let locks = 0
let previousOverflow = ''

/** Nested-safe body scroll lock (modal + lightbox). */
export function lockBodyScroll() {
  if (typeof document === 'undefined') return () => {}
  if (locks === 0) {
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  locks += 1
  return unlockBodyScroll
}

export function unlockBodyScroll() {
  if (typeof document === 'undefined') return
  locks = Math.max(0, locks - 1)
  if (locks === 0) {
    document.body.style.overflow = previousOverflow
    previousOverflow = ''
  }
}
