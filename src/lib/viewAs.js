// v1.0.234 · "Ver como" (owner account only): opens the real portal of an employee, a seller or a
// marketing login to see exactly what that person sees. Nothing can be changed from inside it:
//   • every database / file WRITE is refused in the browser (src/lib/supabase.js setReadOnly);
//   • every /api call that is not a read is refused here;
//   • the sales data is read for that seller by the server (view_as), which accepts it only from the owner.
import { setReadOnly, SUPABASE_URL } from './supabase'

/** The owner's login(s). Other admins do not get "Ver como". */
export const OWNER_EMAILS = ['admin@kuripuro.com', ...String(import.meta.env?.VITE_OWNER_EMAILS || '').split(',')].map(s => s.trim().toLowerCase()).filter(Boolean)
export const isOwner = user => user?.role === 'admin' && OWNER_EMAILS.includes(String(user.email || '').toLowerCase())

export const VIEW_AS_BLOCKED = {
  pt: 'Ver como — somente leitura. Nada foi alterado.',
  en: 'View as — read only. Nothing was changed.',
  ja: '表示のみ（変更はされていません）。',
}

let active = null
let originalFetch = null

const blocked = () => new Response(JSON.stringify({ error: VIEW_AS_BLOCKED.pt, view_as: true }), { status: 403, headers: { 'Content-Type': 'application/json' } })

function wrappedFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input?.url || ''
  const isApi = url.startsWith('/api/') || url.startsWith(`${window.location.origin}/api/`)
  const method = String(init.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase()
  // files sent straight to storage (signed upload links) are writes too
  if (active && url.startsWith(SUPABASE_URL) && method !== 'GET' && method !== 'HEAD' && !/\/storage\/v1\/object\/(list|sign)\//.test(url)) return Promise.resolve(blocked())
  if (!active || !isApi) return originalFetch(input, init)
  if (method !== 'GET' && method !== 'HEAD') return Promise.resolve(blocked())
  // the person's own data, read by the server on the owner's behalf
  if (/\/api\/(sales-data|sales\?)/.test(url) && active.role === 'salesperson') {
    const next = `${url}${url.includes('?') ? '&' : '?'}view_as=${encodeURIComponent(active.id)}`
    return originalFetch(typeof input === 'string' ? next : new Request(next, input), init)
  }
  return originalFetch(input, init)
}

export function startViewAs(target) {
  active = target
  setReadOnly(true)
  if (!originalFetch) { originalFetch = window.fetch.bind(window); window.fetch = wrappedFetch }
}
export function stopViewAs() {
  active = null
  setReadOnly(false)
  if (originalFetch) { window.fetch = originalFetch; originalFetch = null }
}
export const viewingAs = () => active
