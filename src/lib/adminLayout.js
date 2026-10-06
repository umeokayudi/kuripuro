export const ADMIN_MOBILE_MAX = 900
export const ADMIN_VIEW_KEY = 'kp_admin_view'

export function readAdminViewPref() {
  try {
    const v = localStorage.getItem(ADMIN_VIEW_KEY)
    if (v === 'mobile' || v === 'desktop' || v === 'auto') return v
  } catch {}
  return 'auto'
}

export function writeAdminViewPref(value) {
  try { localStorage.setItem(ADMIN_VIEW_KEY, value) } catch {}
}

export function isAdminMobileLayout(width, pref = 'auto') {
  if (pref === 'mobile') return true
  if (pref === 'desktop') return false
  return Number(width) <= ADMIN_MOBILE_MAX
}

export const ADMIN_MOBILE_TABS = [
  { to: '/ai', key: 'ai' },
  { to: '/', key: 'dashboard' },
  { to: '/jobs', key: 'jobs' },
  { to: '/mitsumori', key: 'mitsumori' },
]

export function adminTabActive(pathname, to) {
  if (to === '/') return pathname === '/'
  return pathname === to || pathname.startsWith(`${to}/`)
}
