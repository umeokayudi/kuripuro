// v1.0.117 · The client's contact person lives in ONE place: the client record (Clients / client sheet).
// Contracts keep a copy only for the printed document; forms show the client's contact read-only
// and send edits to the client sheet. A contract typed for a client without a contact fills it in.

/** Reading rule used by every screen. */
export function clientContact(client) {
  if (!client) return { name: '', phone: '', email: '' }
  return {
    name: String(client.contact_name || client.contact_person || '').trim(),
    phone: String(client.phone || '').trim(),
    email: String(client.email || '').trim(),
  }
}

export const hasClientContact = client => { const c = clientContact(client); return !!(c.name || c.phone) }

/** Fields to fill on the client when a contract brings a contact the client record does not have yet. */
export function missingContactPatch(client, contract) {
  if (!client?.id) return null
  const have = clientContact(client)
  const patch = {}
  const name = String(contract?.contact_name || '').trim()
  const phone = String(contract?.contact_phone || '').trim()
  if (!have.name && name) patch.contact_name = name
  if (!have.phone && phone) patch.phone = phone
  return Object.keys(patch).length ? patch : null
}

/** Saves missingContactPatch (best effort; the contract is already saved). */
export async function fillClientContact(supabase, client, contract) {
  const patch = missingContactPatch(client, contract)
  if (!patch) return false
  const { error } = await supabase.from('clients').update(patch).eq('id', client.id)
  return !error
}
