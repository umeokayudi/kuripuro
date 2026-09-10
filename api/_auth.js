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
