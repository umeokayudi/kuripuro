export const MIN_LOGIN_PASSWORD = 6

export function validateEmail(email) {
  const value = String(email || '').trim().toLowerCase()
  if (!value) return { ok: false, error: 'email_required' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { ok: false, error: 'invalid_email' }
  return { ok: true, value }
}

export function validateNewPassword(password, { required = false } = {}) {
  const value = String(password || '').trim()
  if (!value) {
    if (required) return { ok: false, error: 'password_required' }
    return { ok: true, value: null }
  }
  if (value.length < MIN_LOGIN_PASSWORD) return { ok: false, error: 'password_too_short' }
  return { ok: true, value }
}

/**
 * Build an email/password patch.
 * `requireCurrent` is for the person changing their own login.
 */
export function buildCredentialPatch({
  currentEmail,
  storedPassword,
  submittedCurrent,
  newEmail,
  newPassword,
  requireCurrent = true,
} = {}) {
  if (requireCurrent) {
    const given = String(submittedCurrent || '')
    if (!given || given !== String(storedPassword || '')) {
      return { ok: false, error: 'wrong_current_password' }
    }
  }

  const patch = {}
  if (newEmail != null && String(newEmail).trim()) {
    const em = validateEmail(newEmail)
    if (!em.ok) return em
    if (em.value !== String(currentEmail || '').trim().toLowerCase()) patch.email = em.value
  }

  const pw = validateNewPassword(newPassword)
  if (!pw.ok) return pw
  if (pw.value) patch.password = pw.value

  if (!Object.keys(patch).length) return { ok: false, error: 'nothing_to_update' }
  return { ok: true, patch }
}

export async function updateRowCredentials(supabase, {
  table,
  id,
  currentEmail,
  storedPassword,
  submittedCurrent,
  newEmail,
  newPassword,
  requireCurrent = true,
  extraPatch = {},
}) {
  const built = buildCredentialPatch({
    currentEmail,
    storedPassword,
    submittedCurrent,
    newEmail,
    newPassword,
    requireCurrent,
  })
  if (!built.ok) return built

  const { error } = await supabase
    .from(table)
    .update({ ...built.patch, ...extraPatch })
    .eq('id', id)

  if (error) {
    if (error.message?.includes('unique') || error.code === '23505') {
      return { ok: false, error: 'email_taken' }
    }
    return { ok: false, error: 'update_failed', detail: error.message }
  }

  return { ok: true, patch: built.patch }
}
