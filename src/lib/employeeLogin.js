import { normalizeLoginKey } from './portalStores'

export const EMPLOYEE_LOGIN_FIELDS =
  'id, full_name, email, password, is_active, contract_type, hourly_rate, fixed_salary, salary_type, score'

export function employeeToSession(emp) {
  if (!emp) return null
  return {
    id: emp.id,
    name: emp.full_name,
    email: emp.email,
    role: 'employee',
    contract_type: emp.contract_type,
    hourly_rate: emp.hourly_rate,
    fixed_salary: emp.fixed_salary,
    salary_type: emp.salary_type,
    score: emp.score,
  }
}

function activeWithPassword(rows, password) {
  const pw = String(password || '').trim()
  if (!pw) return []
  return (rows || []).filter(r => r && r.is_active !== false && String(r.password || '') === pw)
}

function uniqueMatch(list) {
  return list.length === 1 ? list[0] : null
}

/** Pure matcher: case-insensitive email, unique full name, unique first name. */
export function pickEmployeeForLogin(rows, login, password) {
  const key = normalizeLoginKey(login)
  const pw = String(password || '').trim()
  if (!key || !pw) return null

  const list = activeWithPassword(rows, pw)
  if (!list.length) return null

  const byEmail = list.filter(r => normalizeLoginKey(r.email) === key)
  const emailHit = uniqueMatch(byEmail)
  if (emailHit) return emailHit
  if (byEmail.length > 1) return byEmail[0]

  const byFull = list.filter(r => normalizeLoginKey(r.full_name) === key)
  const fullHit = uniqueMatch(byFull)
  if (fullHit) return fullHit

  const byFirst = list.filter(r => normalizeLoginKey(String(r.full_name || '').split(/\s+/)[0]) === key)
  return uniqueMatch(byFirst)
}

export function pickByNormalizedEmail(rows, login) {
  const key = normalizeLoginKey(login)
  if (!key) return null
  const hits = (rows || []).filter(r => normalizeLoginKey(r.email) === key)
  return hits[0] || null
}

export async function findEmployeeForLogin(supabase, login, password) {
  const key = normalizeLoginKey(login)
  const pw = String(password || '').trim()
  if (!key || !pw) return null

  const { data: byEmail } = await supabase
    .from('employees')
    .select(EMPLOYEE_LOGIN_FIELDS)
    .eq('email', key)
    .eq('password', pw)
    .eq('is_active', true)
    .maybeSingle()
  if (byEmail) return byEmail

  const { data: byIlike, error: ilikeErr } = await supabase
    .from('employees')
    .select(EMPLOYEE_LOGIN_FIELDS)
    .ilike('email', key)
    .eq('password', pw)
    .eq('is_active', true)

  if (!ilikeErr && byIlike?.length) {
    const hit = pickEmployeeForLogin(byIlike, login, password)
    if (hit) return hit
  }

  const { data: byPass } = await supabase
    .from('employees')
    .select(EMPLOYEE_LOGIN_FIELDS)
    .eq('password', pw)
    .eq('is_active', true)

  return pickEmployeeForLogin(byPass, login, password)
}

export async function findAdminForLogin(supabase, login, password) {
  const key = normalizeLoginKey(login)
  const pw = String(password || '').trim()
  if (!key || !pw) return null

  const { data: exact } = await supabase
    .from('admins')
    .select('*')
    .eq('email', key)
    .eq('password', pw)
    .maybeSingle()
  if (exact) return exact

  const { data: rows } = await supabase
    .from('admins')
    .select('*')
    .eq('password', pw)

  return pickByNormalizedEmail(rows, login)
}
