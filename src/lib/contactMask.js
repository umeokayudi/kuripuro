// v1.0.117 · Lists show phones and e-mails masked; the full value stays on the person's own page.
// And one phone number belongs to one person (employees + sellers share the same check).

export const phoneDigits = p => String(p || '').replace(/\D/g, '')

/** "090-1234-5678" → "090-****-5678": keeps the first 3 and last 4 digits, separators as typed. */
export function maskPhone(p) {
  const s = String(p || '').trim()
  const total = phoneDigits(s).length
  if (total < 8) return s ? '•••' : ''
  let seen = 0
  return s.replace(/\d/g, d => { seen++; return seen <= 3 || seen > total - 4 ? d : '*' })
}

/** "hanako@email.com" → "ha***@email.com". */
export function maskEmail(e) {
  const s = String(e || '').trim()
  const at = s.indexOf('@')
  if (at < 1) return s ? '•••' : ''
  const name = s.slice(0, at)
  return `${name.slice(0, Math.min(2, name.length - 1) || 1)}***${s.slice(at)}`
}

/**
 * Who else already uses this phone. `people` = [{ id, name, phone, kind }].
 * Same number = same digits (ignoring dashes/spaces; a leading +81 counts as 0).
 */
export function phoneOwner(people, phone, exceptId) {
  const key = normPhone(phone)
  if (key.length < 8) return null
  return (people || []).find(p => p.id !== exceptId && normPhone(p.phone) === key) || null
}
function normPhone(p) {
  const d = phoneDigits(p)
  return d.startsWith('81') && d.length >= 11 ? '0' + d.slice(2) : d
}

/** Loads everyone with a phone (employees + sellers) for phoneOwner. */
export async function loadPhoneBook(supabase) {
  const [e, s] = await Promise.all([
    supabase.from('employees').select('id,full_name,phone').not('phone', 'is', null),
    supabase.from('salespeople').select('id,full_name,phone').not('phone', 'is', null),
  ])
  return [
    ...(e.data || []).map(r => ({ id: r.id, name: r.full_name, phone: r.phone, kind: 'employee' })),
    ...(s.data || []).map(r => ({ id: r.id, name: r.full_name, phone: r.phone, kind: 'salesperson' })),
  ]
}

/** Returns the error text when the phone is taken, else null. */
export async function phoneTakenMessage(supabase, phone, exceptId, L) {
  if (phoneDigits(phone).length < 8) return null
  const owner = phoneOwner(await loadPhoneBook(supabase).catch(() => []), phone, exceptId)
  return owner ? L(`This phone already belongs to ${owner.name}. Each person needs their own number.`, `この電話番号はすでに${owner.name}さんが使っています。1人1番号にしてください。`, `Este telefone já é de ${owner.name}. Cada pessoa precisa do próprio número.`) : null
}
