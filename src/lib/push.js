// Browser side of Web Push: service worker, permission and the subscription saved on the server.
// iPhone/iPad only allow push for a site added to the Home Screen (iOS 16.4+).

const DISMISS_KEY = 'kp_push_dismissed_at'
const OWNER_KEY = 'kp_push_owner'

const read = k => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* private mode */ } }

export const isIOS = () => typeof navigator !== 'undefined'
  && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
export const isStandalone = () => typeof window !== 'undefined'
  && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true)

export const pushSupported = () => typeof window !== 'undefined'
  && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/** 'unsupported' | 'ios-needs-home' | 'denied' | 'granted' | 'default' */
export function pushState() {
  if (isIOS() && !isStandalone()) return 'ios-needs-home'
  if (!pushSupported()) return 'unsupported'
  return Notification.permission
}

const ownerOf = user => (user ? `${user.role}:${user.id}` : '')

function keyToBytes(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

async function registration() {
  const existing = await navigator.serviceWorker.getRegistration('/')
  return existing || navigator.serviceWorker.register('/sw.js', { scope: '/' })
}

let publicKeyCache = null
async function publicKey() {
  if (publicKeyCache) return publicKeyCache
  const r = await fetch('/api/push?op=key', { cache: 'no-store' })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || !data.configured || !data.publicKey) throw new Error('not-configured')
  publicKeyCache = data.publicKey
  return publicKeyCache
}

async function saveOnServer(sub, user, lang) {
  const r = await fetch('/api/push?op=subscribe', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), role: user.role, user_id: user.id, lang }),
  })
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
  write(OWNER_KEY, ownerOf(user))
}

/** Asks permission (must run from a tap) and saves the subscription. */
export async function enablePush(user, lang) {
  if (!pushSupported()) throw new Error('unsupported')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error(permission)
  const key = await publicKey()
  const reg = await registration()
  await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription())
    || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(key) })
  await saveOnServer(sub, user, lang)
  write(DISMISS_KEY, null)
  return true
}

/** On every app start: if this browser already allowed push, keep the server row tied to whoever is signed in. */
export async function syncPush(user, lang) {
  if (!user || pushState() !== 'granted') return false
  try {
    const reg = await navigator.serviceWorker.getRegistration('/')
    const sub = reg && await reg.pushManager.getSubscription()
    if (!sub) return false
    await saveOnServer(sub, user, lang)
    return true
  } catch { return false }
}

export async function isSubscribed() {
  if (!pushSupported()) return false
  try {
    const reg = await navigator.serviceWorker.getRegistration('/')
    return Boolean(reg && await reg.pushManager.getSubscription())
  } catch { return false }
}

/** Turned off, or on logout: the server forgets this browser so the next person on the phone gets nothing meant for the last one. */
export async function disablePush({ keepBrowser = false } = {}) {
  write(OWNER_KEY, null)
  if (!pushSupported()) return
  try {
    const reg = await navigator.serviceWorker.getRegistration('/')
    const sub = reg && await reg.pushManager.getSubscription()
    if (!sub) return
    await fetch('/api/push?op=unsubscribe', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }), keepalive: true,
    }).catch(() => {})
    if (!keepBrowser) await sub.unsubscribe()
  } catch { /* ignore */ }
}

export async function sendTestPush(user) {
  const r = await fetch('/api/push?op=test', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: user?.role, user_id: user?.id }),
  })
  return r.ok ? (await r.json()).sent || 0 : 0
}

export const pushDismissedRecently = (days = 7) => {
  const at = Number(read(DISMISS_KEY) || 0)
  return at && Date.now() - at < days * 86400_000
}
export const dismissPush = () => write(DISMISS_KEY, String(Date.now()))
export const pushOwner = () => read(OWNER_KEY) || ''

/** A notification opens the app at /?tab=<screen>. Read-only, so it is safe in a useState initializer. */
export function tabFromUrl(allowed) {
  try {
    const tab = new URLSearchParams(window.location.search).get('tab')
    return tab && allowed.includes(tab) ? tab : null
  } catch { return null }
}

/** Call once after the portal mounts, so a reload does not reopen the same screen. */
export function clearTabParam() {
  try {
    const params = new URLSearchParams(window.location.search)
    if (!params.has('tab')) return
    params.delete('tab')
    const rest = params.toString()
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`)
  } catch { /* ignore */ }
}
