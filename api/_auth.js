/**
 * Server-side guards for sensitive API routes.
 * Set ADMIN_API_SECRET on Vercel and VITE_ADMIN_API_SECRET in the frontend build.
 * When ADMIN_API_SECRET is unset, routes stay open (backward compatible).
 */

export function isAdminSecretConfigured() {
  return Boolean(process.env.ADMIN_API_SECRET)
}

export function requireAdminSecret(req, res) {
  const secret = process.env.ADMIN_API_SECRET
  if (!secret) return true

  const provided = req.headers['x-kuripuro-admin-key']
  if (provided !== secret) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}

/** Block destructive DDL in production unless admin secret is configured and valid. */
export function requireAdminSecretStrict(req, res) {
  const secret = process.env.ADMIN_API_SECRET
  if (process.env.VERCEL_ENV === 'production' && !secret) {
    res.status(503).json({
      error: 'ADMIN_API_SECRET is required for this operation in production',
    })
    return false
  }
  return requireAdminSecret(req, res)
}

/**
 * Requires the signed login cookie (set by /api/sales-session at login) for
 * routes that cost money (Gemini) or touch files. Returns the user or null
 * after answering 401.
 */
export async function requireAppSession(req, res, roles = ['admin', 'employee']) {
  const { requireSalesSession } = await import('./_salesSession.js')
  return requireSalesSession(req, res, roles)
}

// Per-person ceiling on AI calls, so a leaked or looping session cannot run up
// the Gemini bill. Kept in memory per server instance: a soft limit, not a quota.
const usage = new Map()

export function aiRateLimited(user, res, { max = 40, windowMin = 10 } = {}) {
  const key = `${user.role}:${user.id}`
  const now = Date.now()
  const entry = usage.get(key)
  if (!entry || entry.reset <= now) {
    usage.set(key, { count: 1, reset: now + windowMin * 60_000 })
    return false
  }
  entry.count += 1
  if (entry.count <= max) return false
  res.status(429).json({ error: 'Muitas análises seguidas. Aguarde alguns minutos e tente de novo.' })
  return true
}

/** Admin-only routes: a valid admin login, or the old shared secret when it is configured. */
export async function requireAdmin(req, res) {
  const secret = process.env.ADMIN_API_SECRET
  if (secret && req.headers['x-kuripuro-admin-key'] === secret) return true
  return Boolean(await requireAppSession(req, res, ['admin']))
}
