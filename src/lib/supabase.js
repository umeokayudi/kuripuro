import { createClient } from '@supabase/supabase-js'

const DEFAULT_URL = 'https://fxsakrshmldmkdmbevna.supabase.co'
const DEFAULT_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4c2FrcnNobWxkbWtkbWJldm5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExMjYwMTEsImV4cCI6MjA5NjcwMjAxMX0.OSnexIDC2bflyDmCTd_pjvcbswB77ri5lDdccEfANMo'

export const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || DEFAULT_URL
export const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || DEFAULT_ANON_KEY

// v1.0.234 · database key per person. After login the server may hand this browser a short-lived
// key that says who is signed in (see api/_salesSession.js createDbToken). When there is one, every
// database and file request goes out with it instead of the public key; when there is none (server
// without SUPABASE_JWT_SECRET, local dev) everything works exactly as before.
const DB_TOKEN_KEY = 'kp_db_token'
let dbToken = null
try { dbToken = localStorage.getItem(DB_TOKEN_KEY) || null } catch { /* private window */ }
export function setDbToken(token) {
  dbToken = token || null
  try { if (dbToken) localStorage.setItem(DB_TOKEN_KEY, dbToken); else localStorage.removeItem(DB_TOKEN_KEY) } catch { /* ignore */ }
}
export const hasDbToken = () => Boolean(dbToken)
let refreshing = null
/** Asks the server for a fresh key using the login cookie. Resolves to true when one arrived. */
export function refreshDbToken() {
  if (!refreshing) {
    refreshing = fetch('/api/sales-session', { credentials: 'same-origin', cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.db_token) { setDbToken(d.db_token); return true } return false })
      .catch(() => false)
      .finally(() => { refreshing = null })
  }
  return refreshing
}
const withToken = (init = {}) => {
  if (!dbToken) return init
  const headers = new Headers(init.headers || {})
  headers.set('Authorization', `Bearer ${dbToken}`)
  return { ...init, headers }
}
// v1.0.234 · "Ver como" (owner looking at somebody's portal): reads go through, every write is refused
// here, before it leaves the browser. Listing and signing files are reads even though they use POST.
let readOnly = false
export function setReadOnly(on) { readOnly = !!on }
const isWrite = (input, init = {}) => {
  const method = String(init.method || 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') return false
  const url = typeof input === 'string' ? input : input?.url || ''
  return !/\/storage\/v1\/object\/(list|sign)\//.test(url)
}
async function dbFetch(input, init) {
  if (readOnly && isWrite(input, init)) {
    return new Response(JSON.stringify({ message: 'Ver como — somente leitura. Nada foi alterado.', code: 'view_as' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  }
  const response = await fetch(input, withToken(init))
  if (response.status !== 401 || !dbToken) return response
  // the key ran out (24 h): get a new one with the login cookie and try once more
  const sent = dbToken
  if (!(await refreshDbToken()) && dbToken === sent) return response
  return fetch(input, withToken(init))
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { fetch: dbFetch } })
