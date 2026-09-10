/**
 * Fetch wrapper for KuriPuro API routes.
 * Sends x-kuripuro-admin-key when VITE_ADMIN_API_SECRET is configured.
 */

const ADMIN_KEY = import.meta.env.VITE_ADMIN_API_SECRET || ''

export function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {})
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json')
  }
  if (ADMIN_KEY) {
    headers.set('x-kuripuro-admin-key', ADMIN_KEY)
  }
  return fetch(url, { ...options, headers })
}

export function apiPost(url, body) {
  return apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
