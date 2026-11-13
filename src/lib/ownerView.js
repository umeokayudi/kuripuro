import { setDbToken } from './supabase'

// v1.0.239 · "Ver como" do dono — browser side. The server (api/_owner-view.js) decides who may
// switch; this file only asks it and swaps the saved login (kp_user) for the account it returns.

const VIEW_KEY = 'kp_owner_view' // { role, name } while the owner is viewing as a linked account

async function call(op, { method = 'GET', body } = {}) {
  const response = await fetch(`/api/owner-view?op=${encodeURIComponent(op)}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.error || `Erro ${response.status}`), { status: response.status })
  return data
}

let statusPromise = null
/** { isOwner, canClaim?, viewing, owner, links, saved }. Non-owners always get isOwner:false. */
export function fetchOwnerStatus({ fresh = false } = {}) {
  if (fresh || !statusPromise) statusPromise = call('status').catch(() => ({ isOwner: false }))
  return statusPromise
}

export const fetchOwnerLog = () => call('log').then(r => r.log || [])
export const claimOwner = () => call('claim', { method: 'POST', body: {} }).then(r => { statusPromise = null; return r })
export const saveOwnerLinks = links => call('links', { method: 'POST', body: links }).then(r => { statusPromise = null; return r })

export function savedViewAs() {
  try { return JSON.parse(localStorage.getItem(VIEW_KEY) || 'null') } catch { return null }
}

/** Switch the real session, then reload into that account's own portal. */
export async function switchView(to) {
  const result = await call('switch', { method: 'POST', body: { to } })
  // v1.0.234 database key per person: the new account's key, never the owner's (null = none on this server)
  setDbToken(result.db_token || null)
  try {
    localStorage.setItem('kp_user', JSON.stringify(result.user))
    if (result.viewing) localStorage.setItem(VIEW_KEY, JSON.stringify(result.viewing))
    else localStorage.removeItem(VIEW_KEY)
  } catch {}
  window.location.assign('/')
  return result
}

export function clearViewAs() {
  try { localStorage.removeItem(VIEW_KEY) } catch {}
}
