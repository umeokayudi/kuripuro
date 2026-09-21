let locks = 0
let previous = null
let touchBound = false

export const KP_SCROLL_LOCK_EVENT = 'kp-body-scroll-lock'
export const KP_MODAL_CLASS = 'kp-modal-open'

function notify() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(KP_SCROLL_LOCK_EVENT))
}

function findScrollable(target) {
  let el = target
  while (el && el !== document.body && el !== document.documentElement) {
    if (el.nodeType === 1 && el.scrollHeight > el.clientHeight + 1) {
      const oy = typeof window !== 'undefined' && window.getComputedStyle
        ? window.getComputedStyle(el).overflowY
        : el.style?.overflowY
      if (oy === 'auto' || oy === 'scroll' || oy === 'overlay' || el.hasAttribute?.('data-kp-scroll') || el.classList?.contains('emp-job-sheet')) {
        return el
      }
    }
    el = el.parentElement
  }
  return target?.closest?.('[data-kp-scroll], .emp-job-sheet, .photo-lightbox') || null
}

function onTouchMove(e) {
  if (locks === 0) return
  const sheet = findScrollable(e.target)
  if (!sheet) {
    e.preventDefault()
    return
  }
  if (sheet.scrollHeight <= sheet.clientHeight + 1) {
    e.preventDefault()
  }
}

function bindTouchGuard() {
  if (touchBound || typeof document === 'undefined') return
  document.addEventListener('touchmove', onTouchMove, { passive: false })
  touchBound = true
}

function unbindTouchGuard() {
  if (!touchBound || typeof document === 'undefined') return
  document.removeEventListener('touchmove', onTouchMove)
  touchBound = false
}

export function isBodyScrollLocked() {
  return locks > 0
}

/** Nested-safe body scroll lock (modal + lightbox). iOS-safe: position:fixed + class. */
export function lockBodyScroll() {
  if (typeof document === 'undefined') return () => {}
  const html = document.documentElement
  const body = document.body
  if (locks === 0) {
    const scrollY = window.scrollY || window.pageYOffset || 0
    previous = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      htmlOverflow: html.style.overflow,
      htmlOverscroll: html.style.overscrollBehavior,
      scrollY,
    }
    html.classList.add(KP_MODAL_CLASS)
    html.style.overflow = 'hidden'
    html.style.overscrollBehavior = 'none'
    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    bindTouchGuard()
  }
  locks += 1
  notify()
  return unlockBodyScroll
}

export function unlockBodyScroll() {
  if (typeof document === 'undefined') return
  locks = Math.max(0, locks - 1)
  if (locks === 0 && previous) {
    const html = document.documentElement
    const body = document.body
    const { scrollY } = previous
    html.classList.remove(KP_MODAL_CLASS)
    html.style.overflow = previous.htmlOverflow
    html.style.overscrollBehavior = previous.htmlOverscroll
    body.style.overflow = previous.overflow
    body.style.position = previous.position
    body.style.top = previous.top
    body.style.left = previous.left
    body.style.right = previous.right
    body.style.width = previous.width
    previous = null
    unbindTouchGuard()
    window.scrollTo(0, scrollY)
  }
  notify()
}
