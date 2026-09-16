export const ADMIN_VIEW_KEY = 'kp_admin_view_mode'
export const ADMIN_VIEW_BREAKPOINT = 900

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
