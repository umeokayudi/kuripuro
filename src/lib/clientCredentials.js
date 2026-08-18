import { normalizeLoginKey } from './portalStores'

export async function findClientUserForLogin(supabase, login, password) {
  const key = normalizeLoginKey(login)
  const pw = (password || '').trim()
  if (!key || !pw) return null

  const fields = 'id, client_id, client_name, location_name, contact_name, email, password, is_active'

  const { data: byEmail } = await supabase
    .from('client_users')
    .select(fields)
    .eq('email', key)
    .eq('password', pw)
    .eq('is_active', true)
    .maybeSingle()

  if (byEmail) return byEmail

  const { data: candidates } = await supabase
    .from('client_users')
    .select(fields)
    .eq('password', pw)
    .eq('is_active', true)
    .not('location_name', 'is', null)

  if (!candidates?.length) return null

  return candidates.find(u => normalizeLoginKey(u.location_name) === key) || null
}

export function clientUserToSession(clientUser) {
  return {
    id: clientUser.id,
    name: clientUser.contact_name?.trim() || clientUser.location_name || clientUser.client_name || clientUser.email,
    email: clientUser.email,
    role: 'client',
    client_id: clientUser.client_id,
    client_name: clientUser.client_name,
    location_name: clientUser.location_name,
  }
}

export async function updateClientCredentials(supabase, userId, { currentPassword, newEmail, newPassword }) {
  const { data: row, error: fetchErr } = await supabase
    .from('client_users')
    .select('id, email, password')
    .eq('id', userId)
    .single()

  if (fetchErr || !row) return { success: false, error: fetchErr?.message || 'Account not found' }
  if (row.password !== (currentPassword || '').trim()) {
    return { success: false, error: 'Current password is incorrect' }
  }

  const patch = {}
  if (newEmail?.trim()) patch.email = newEmail.trim().toLowerCase()
  if (newPassword?.trim()) {
    if (newPassword.trim().length < 6) return { success: false, error: 'Password must be at least 6 characters' }
    patch.password = newPassword.trim()
  }

  if (!Object.keys(patch).length) return { success: false, error: 'Nothing to update' }

  const { error } = await supabase.from('client_users').update(patch).eq('id', userId)
  if (error) {
    if (error.message?.includes('unique') || error.code === '23505') {
      return { success: false, error: 'This email is already in use' }
    }
    return { success: false, error: error.message }
  }

  return { success: true, email: patch.email || row.email }
}
