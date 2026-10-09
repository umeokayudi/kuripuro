import { createHmac, timingSafeEqual, randomBytes, scryptSync, createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const COOKIE = 'kp_sales_session'
const SESSION_TTL = 60 * 60 * 12
const URL = process.env.VITE_SUPABASE_URL || 'https://fxsakrshmldmkdmbevna.supabase.co'

export function salesDb() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY precisa estar configurada no servidor.')
  return createClient(URL, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export function salesSessionConfigured() {
  return Boolean(process.env.SALES_SESSION_SECRET && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

function secret() {
  const value = process.env.SALES_SESSION_SECRET
  if (!value || value.length < 32) throw new Error('SALES_SESSION_SECRET deve ter pelo menos 32 caracteres.')
  return value
}

function sign(value) {
  return createHmac('sha256', secret()).update(value).digest('base64url')
}

export function createSalesSession(user) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL,
  })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function readSalesSession(req) {
  const cookie = String(req.headers?.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))
  const token = cookie?.slice(COOKIE.length + 1)
  if (!token) return null
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra) return null
  const expected = Buffer.from(sign(payload))
  const supplied = Buffer.from(signature)
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!data.sub || !['admin', 'salesperson'].includes(data.role) || data.exp < Date.now() / 1000) return null
    return { id: data.sub, role: data.role, name: data.name, email: data.email }
  } catch { return null }
}

export function setSalesSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1'
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL}${secure ? '; Secure' : ''}`)
}

export function clearSalesSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1'
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`)
}

export function requireSalesSession(req, res, roles = ['admin', 'salesperson']) {
  if (!salesSessionConfigured()) {
    res.status(503).json({ error: 'Configure SUPABASE_SERVICE_ROLE_KEY e SALES_SESSION_SECRET no servidor para ativar o portal comercial.' })
    return null
  }
  const user = readSalesSession(req)
  if (!user || !roles.includes(user.role)) {
    res.status(401).json({ error: 'Sessão comercial inválida ou expirada.' })
    return null
  }
  return user
}

/** Like requireSalesSession, but also refuses sellers deactivated after they signed in. */
export async function requireActiveSalesSession(req, res, roles = ['admin', 'salesperson']) {
  const user = requireSalesSession(req, res, roles)
  if (!user || user.role !== 'salesperson') return user
  const { data, error } = await salesDb().from('salespeople').select('is_active').eq('id', user.id).maybeSingle()
  if (error || !data?.is_active) {
    clearSalesSessionCookie(res)
    res.status(401).json({ error: 'Sessão comercial inválida ou expirada.' })
    return null
  }
  return user
}

/** Browsers report the same file with different MIME spellings (codecs, x- prefixes). */
export function normalizeMime(value) {
  const base = String(value || '').toLowerCase().split(';')[0].trim()
  const aliases = {
    'audio/x-m4a': 'audio/mp4', 'audio/m4a': 'audio/mp4', 'audio/aac': 'audio/mp4', 'audio/x-aac': 'audio/mp4',
    'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/mp3': 'audio/mpeg', 'image/jpg': 'image/jpeg',
  }
  return aliases[base] || base
}

export const SALES_BUCKET = 'sales-private'

/** True when a private sales object belongs to this user (admins can read all). */
export function ownsSalesObject(user, path, prefixes = ['cards', 'meetings', 'contracts']) {
  const clean = String(path || '')
  if (clean.includes('..') || clean.startsWith('/')) return false
  const [prefix, owner] = clean.split('/')
  if (!prefixes.includes(prefix)) return false
  return user.role === 'admin' || owner === user.id
}

export function hashSalesPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(String(password), salt, 64).toString('hex')
  return `scrypt$${salt}$${hash}`
}

export function verifySalesPassword(password, stored, email = '') {
  const value = String(stored || '')
  if (value.startsWith('scrypt$')) {
    const [, salt, expectedHex] = value.split('$')
    if (!salt || !expectedHex) return false
    const expected = Buffer.from(expectedHex, 'hex')
    const actual = scryptSync(String(password), salt, expected.length)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }
  // Upgrade path for accounts created by the old commercial branch.
  const legacy = createHash('sha256').update(`${String(email).trim().toLowerCase()}|${String(password)}`).digest('hex')
  const expected = Buffer.from(value)
  const actual = Buffer.from(legacy)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export { COOKIE }
