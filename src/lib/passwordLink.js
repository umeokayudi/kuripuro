// v1.0.117 · A new login sets its own password through a one-time link (no SQL needed).
// The office never types the password: the row is saved with a random "setup:<token>"
// placeholder, the link carries the token, and the first save replaces it. Login refuses
// any password that still starts with the prefix, so the placeholder never opens a session.
export const SETUP_PREFIX = 'setup:'

const TABLES = { employee: 'employees', client: 'client_users' }

export const isSetupPassword = pw => String(pw || '').startsWith(SETUP_PREFIX)

export function newSetupToken() {
  const bytes = new Uint8Array(24)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 40)
}

export const setupPassword = token => SETUP_PREFIX + token

export function setupLink(kind, email, token, origin = globalThis.location?.origin || '') {
  const q = new URLSearchParams({ k: kind, e: String(email || '').trim().toLowerCase(), t: token })
  return `${origin}/set-password?${q}`
}

export function readSetupLink(search) {
  const q = new URLSearchParams(search || '')
  const kind = q.get('k'), email = (q.get('e') || '').trim().toLowerCase(), token = q.get('t') || ''
  if (!TABLES[kind] || !email || !/^[a-z0-9]{20,64}$/.test(token)) return null
  return { kind, email, token }
}

/** Same rule as "change password" in the app: 8+ characters, not the placeholder. */
export function passwordProblem(pw, again) {
  const p = String(pw || '')
  if (p.trim().length < 8) return 'short'
  if (isSetupPassword(p)) return 'invalid'
  if (again != null && again !== p) return 'mismatch'
  return null
}

/** Replaces the placeholder with the chosen password. Returns 'ok' | 'used' (link already used or wrong). */
export async function completeSetup(supabase, { kind, email, token, password }) {
  const table = TABLES[kind]
  if (!table) return 'used'
  const { data, error } = await supabase.from(table).update({ password: password.trim() })
    .eq('email', email).eq('password', setupPassword(token)).select('id')
  if (error) throw error
  return data?.length ? 'ok' : 'used'
}
