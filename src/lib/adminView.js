export const ADMIN_VIEW_KEY = 'kp_admin_view_mode'
export const ADMIN_VIEW_BREAKPOINT = 900
export const ADMIN_PHONE_WIDTH = 430
export const ADMIN_PHONE_STAGE_MIN = 720

export function readAdminDesktopMode(width) {
  const w = Number.isFinite(width)
    ? width
    : (typeof window !== 'undefined' ? window.innerWidth : ADMIN_VIEW_BREAKPOINT)
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(ADMIN_VIEW_KEY) : null
    if (saved === 'desktop') return true
    if (saved === 'mobile') return false
  } catch {}
  return w >= ADMIN_VIEW_BREAKPOINT
}

export function writeAdminViewMode(desktop) {
  try {
    localStorage.setItem(ADMIN_VIEW_KEY, desktop ? 'desktop' : 'mobile')
  } catch {}
}

/** On a wide monitor, Mobile is a 430px phone chrome; on a real phone it stays full-bleed. */
export function isAdminPhoneStage(desktopMode, width) {
  if (desktopMode) return false
  const w = Number.isFinite(width)
    ? width
    : (typeof window !== 'undefined' ? window.innerWidth : ADMIN_PHONE_STAGE_MIN)
  return w >= ADMIN_PHONE_STAGE_MIN
}

export function isAdminMobileTabPath(pathname) {
  const path = String(pathname || '')
  if (path === '/') return true
  if (path === '/jobs' || path.startsWith('/jobs/')) return true
  if (path === '/reports') return true
  if (path === '/ai') return true
  return false
}
