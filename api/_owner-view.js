// v1.0.240 · "Ver como" do dono: the owner (one admin login, chosen in Usuários) switches the
// REAL server session to his own linked employee or seller login and back, without a password.
//
// Rules (all checked here, on the server — the button being hidden is only cosmetic):
// - Only the admin whose id is saved as owner can switch. Nobody else, not even another admin.
// - The owner can only switch to the ONE employee and ONE sales login linked to him in the config.
// - While viewing, the normal session cookie belongs to that account (same permissions and data
//   as when it signs in itself). A second signed cookie (kp_owner_view) remembers the owner, and is
//   only accepted by this route, to come back. It can never be used as a login session.
// - Nothing about anyone's access changes: this only issues sessions of the owner's own accounts.
// - Every switch is logged.
//
// Storage (no SQL): private bucket system-private (no storage policies → service role only):
//   owner-view/config.json = { owner_admin_id, employee_id, salesperson_id, updated_at, updated_by }
//   owner-view/log/<iso>-<rand>.json = { at, owner_id, owner_name, from, to, to_id, to_name, ip }
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto'
import {
  createSalesSession,
  createDbToken,
  readSalesSession,
  salesDb,
  salesSessionConfigured,
  EMPLOYEE_SESSION_TTL,
  COOKIE,
} from './_salesSession.js'
import { PRIVATE_JSON_BUCKET } from './_sales-visits.js'

export const OWNER_COOKIE = 'kp_owner_view'
const CONFIG_PATH = 'owner-view/config.json'
const LOG_DIR = 'owner-view/log'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ROLES = ['admin', 'employee', 'salesperson']

// v1.0.251 · the owner's login(s), same list the read-only "Ver como…" uses (api/_sales-data.js).
// Only an admin with one of these e-mails can be (or become) the owner; anything else is inert.
export function ownerEmails() {
  return String(process.env.OWNER_EMAILS || 'admin@kuripuro.com').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)
}
const isOwnerEmail = email => ownerEmails().includes(String(email || '').trim().toLowerCase())

function ownerKey() {
  const value = process.env.SALES_SESSION_SECRET
  if (!value || value.length < 32) throw new Error('SALES_SESSION_SECRET deve ter pelo menos 32 caracteres.')
  // Domain-separated from the login cookie, so one can never be passed off as the other.
  return `${value}:owner-view`
}

function sign(value) {
  return createHmac('sha256', ownerKey()).update(value).digest('base64url')
}

function cookieAttrs(maxAge) {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1'
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

export function ownerCookieToken(ownerId, ttl = EMPLOYEE_SESSION_TTL) {
  const payload = Buffer.from(JSON.stringify({ kind: 'owner-view', sub: ownerId, exp: Math.floor(Date.now() / 1000) + ttl })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function readOwnerCookie(req) {
  const raw = String(req.headers?.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${OWNER_COOKIE}=`))
  const token = raw?.slice(OWNER_COOKIE.length + 1)
  if (!token) return null
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra) return null
  const expected = Buffer.from(sign(payload))
  const supplied = Buffer.from(signature)
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (data.kind !== 'owner-view' || !UUID.test(String(data.sub || '')) || data.exp < Date.now() / 1000) return null
    return data.sub
  } catch { return null }
}

// ── config + log (private storage) ────────────────────────────────────────

export async function readOwnerConfig(db) {
  const bucket = db.storage.from(PRIVATE_JSON_BUCKET)
  const { data: found, error: listError } = await bucket.list('owner-view', { search: 'config.json', limit: 5 })
  if (listError) throw listError
  if (!(found || []).some(f => f.name === 'config.json')) return null
  const { data, error } = await bucket.download(CONFIG_PATH)
  if (error) throw error
  const cfg = JSON.parse(await data.text())
  return cfg && UUID.test(String(cfg.owner_admin_id || '')) ? cfg : null
}

async function writeOwnerConfig(db, cfg) {
  const { error } = await db.storage.from(PRIVATE_JSON_BUCKET)
    .upload(CONFIG_PATH, Buffer.from(JSON.stringify(cfg)), { contentType: 'application/json', upsert: true, cacheControl: '0' })
  if (error) throw error
}

async function writeLog(db, entry) {
  const path = `${LOG_DIR}/${entry.at.replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}.json`
  const { error } = await db.storage.from(PRIVATE_JSON_BUCKET)
    .upload(path, Buffer.from(JSON.stringify(entry)), { contentType: 'application/json', upsert: false })
  if (error) throw error
}

async function readLog(db, limit = 20) {
  const bucket = db.storage.from(PRIVATE_JSON_BUCKET)
  const { data: files, error } = await bucket.list(LOG_DIR, { limit, sortBy: { column: 'name', order: 'desc' } })
  if (error || !files?.length) return []
  const rows = await Promise.all(files.filter(f => f.name.endsWith('.json')).map(async f => {
    const { data } = await bucket.download(`${LOG_DIR}/${f.name}`)
    try { return data ? JSON.parse(await data.text()) : null } catch { return null }
  }))
  return rows.filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

// ── the real accounts (same fields as the login in _sales-session.js) ─────

async function loadAdmin(db, id) {
  const { data } = await db.from('admins').select('id,name,email').eq('id', id).maybeSingle()
  return data ? { id: data.id, name: data.name, email: data.email, role: 'admin' } : null
}

async function loadEmployee(db, id) {
  if (!UUID.test(String(id || ''))) return null
  const { data } = await db.from('employees')
    .select('id,full_name,email,contract_type,hourly_rate,fixed_salary,salary_type,score,is_active')
    .eq('id', id).maybeSingle()
  if (!data || data.is_active === false) return null
  return { id: data.id, name: data.full_name, email: data.email, role: 'employee', contract_type: data.contract_type, hourly_rate: data.hourly_rate, fixed_salary: data.fixed_salary, salary_type: data.salary_type, score: data.score }
}

async function loadSeller(db, id) {
  if (!UUID.test(String(id || ''))) return null
  let { data, error } = await db.from('salespeople').select('id,full_name,email,phone,is_active,team').eq('id', id).maybeSingle()
  if (error) ({ data } = await db.from('salespeople').select('id,full_name,email,phone,is_active').eq('id', id).maybeSingle())
  if (!data || !data.is_active) return null
  return { id: data.id, name: data.full_name, email: data.email, role: 'salesperson', phone: data.phone || '', team: data.team === 'marketing' ? 'marketing' : 'sales' }
}

// v1.0.253 · the owner's own accounts are found by the server, with no setup screen:
// 1) ids saved before (Usuários, v1.0.240) win; 2) env OWNER_EMPLOYEE_ID / OWNER_SALESPERSON_ID;
// 3) the ONE active account whose name starts with OWNER_LINK_NAME (default "Alexandre").
// If there is none, or more than one, that entry simply does not appear (nothing is guessed).
// The owner can only ever enter these two accounts; nothing else is reachable from here.
const KNOWN_OWNER_EMPLOYEE = '4c064fb5-e39d-4086-a798-f6e670730bac' // Alexandre (src/lib/employeeLang.js)
const linkName = () => String(process.env.OWNER_LINK_NAME || 'Alexandre').trim().toLowerCase()
const startsWithName = n => {
  const v = String(n || '').trim().toLowerCase(), want = linkName()
  return Boolean(want) && (v === want || v.startsWith(want + ' '))
}

async function onlyOne(db, table, activeCol) {
  const { data, error } = await db.from(table).select(`id,full_name,${activeCol}`).ilike('full_name', `${linkName()}%`)
  if (error) return null
  const rows = (data || []).filter(r => r[activeCol] !== false && r[activeCol] !== null && startsWithName(r.full_name))
  return rows.length === 1 ? rows[0].id : null
}

export async function resolveOwnerLinks(db, cfg) {
  let employeeId = cfg.employee_id || (UUID.test(String(process.env.OWNER_EMPLOYEE_ID || '')) ? process.env.OWNER_EMPLOYEE_ID : null)
  let sellerId = cfg.salesperson_id || (UUID.test(String(process.env.OWNER_SALESPERSON_ID || '')) ? process.env.OWNER_SALESPERSON_ID : null)
  if (!employeeId) employeeId = (await loadEmployee(db, KNOWN_OWNER_EMPLOYEE)) ? KNOWN_OWNER_EMPLOYEE : await onlyOne(db, 'employees', 'is_active')
  if (!sellerId) sellerId = await onlyOne(db, 'salespeople', 'is_active')
  return { ...cfg, employee_id: employeeId || null, salesperson_id: sellerId || null }
}

const loaders = { admin: loadAdmin, employee: loadEmployee, salesperson: loadSeller }

/**
 * Who is the owner behind this request, or null.
 * - signed in as the owner admin himself, or
 * - signed in as one of his linked accounts AND carrying a valid owner cookie for the current owner.
 */
function ownerBehind(req, session, cfg) {
  if (!cfg || !session) return null
  if (session.role === 'admin' && session.id === cfg.owner_admin_id) return { id: cfg.owner_admin_id, viewing: false }
  const fromCookie = readOwnerCookie(req)
  if (fromCookie !== cfg.owner_admin_id) return null
  const linked = (session.role === 'employee' && session.id === cfg.employee_id)
    || (session.role === 'salesperson' && session.id === cfg.salesperson_id)
  return linked ? { id: cfg.owner_admin_id, viewing: true } : null
}

function setCookies(res, sessionUser, ownerId) {
  const cookies = [`${COOKIE}=${createSalesSession(sessionUser, EMPLOYEE_SESSION_TTL)}; ${cookieAttrs(EMPLOYEE_SESSION_TTL)}`]
  cookies.push(ownerId
    ? `${OWNER_COOKIE}=${ownerCookieToken(ownerId)}; ${cookieAttrs(EMPLOYEE_SESSION_TTL)}`
    : `${OWNER_COOKIE}=; ${cookieAttrs(0)}`)
  res.setHeader('Set-Cookie', cookies)
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 64)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (!salesSessionConfigured()) return res.status(503).json({ error: 'Configure SUPABASE_SERVICE_ROLE_KEY e SALES_SESSION_SECRET no servidor.' })
  const session = readSalesSession(req)
  if (!session) return res.status(401).json({ error: 'Sessão expirada.' })
  const first = v => Array.isArray(v) ? v[0] : v
  const op = String(first(req.query?.op) || (req.method === 'GET' ? 'status' : '')).trim()

  try {
    const db = salesDb()
    let cfg = await readOwnerConfig(db)
    // A config whose owner is not (or no longer) an owner login does nothing and can be claimed again.
    if (cfg && !isOwnerEmail((await loadAdmin(db, cfg.owner_admin_id))?.email)) cfg = null
    // v1.0.253 · no "Definir como dono" step any more: while nobody owns it, the owner login
    // (OWNER_EMAILS, checked against the admins table, not only the cookie) IS the owner.
    // (While inside a linked account the owner is named by the signed owner cookie instead.)
    if (!cfg) {
      const candidate = session.role === 'admin' ? session.id : readOwnerCookie(req)
      const me = candidate ? await loadAdmin(db, candidate) : null
      if (me && isOwnerEmail(me.email)) cfg = { owner_admin_id: me.id, employee_id: null, salesperson_id: null }
    }
    if (cfg) cfg = await resolveOwnerLinks(db, cfg)
    const owner = ownerBehind(req, session, cfg)

    // ── GET status: everyone may ask; non-owners only learn "no" ──
    if (req.method === 'GET' && op === 'status') {
      if (!owner) {
        // An admin may claim ownership only while nobody owns it yet.
        return res.status(200).json({ isOwner: false, canClaim: session.role === 'admin' && !cfg && isOwnerEmail(session.email) })
      }
      const [emp, seller, ownerAdmin] = await Promise.all([
        cfg.employee_id ? loadEmployee(db, cfg.employee_id) : null,
        cfg.salesperson_id ? loadSeller(db, cfg.salesperson_id) : null,
        loadAdmin(db, cfg.owner_admin_id),
      ])
      return res.status(200).json({
        isOwner: true,
        viewing: owner.viewing ? { role: session.role, name: session.name, team: session.team || null } : null,
        owner: ownerAdmin ? { id: ownerAdmin.id, name: ownerAdmin.name } : { id: cfg.owner_admin_id, name: '' },
        links: {
          employee: emp ? { id: emp.id, name: emp.name } : null,
          salesperson: seller ? { id: seller.id, name: seller.name, team: seller.team } : null,
        },
        // ids saved even if that login was deactivated since (so the settings can say so)
        saved: { employee_id: cfg.employee_id || null, salesperson_id: cfg.salesperson_id || null },
      })
    }

    if (req.method === 'GET' && op === 'log') {
      if (!owner || owner.viewing) return res.status(403).json({ error: 'Só a conta do dono.' })
      return res.status(200).json({ log: await readLog(db, 20) })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const body = req.body || {}

    // ── POST claim: the owner login (OWNER_EMAILS) makes ITSELF the owner, by id. Locked afterwards. ──
    if (op === 'claim') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Só um administrador.' })
      if (cfg) return res.status(409).json({ error: 'A conta do dono já foi definida. Só ela pode mudar as contas vinculadas.' })
      const me = await loadAdmin(db, session.id)
      if (!me || !isOwnerEmail(me.email)) return res.status(403).json({ error: 'Só a conta do dono.' })
      const next = { owner_admin_id: me.id, employee_id: null, salesperson_id: null, updated_at: new Date().toISOString(), updated_by: me.id }
      await writeOwnerConfig(db, next)
      await writeLog(db, { at: next.updated_at, owner_id: me.id, owner_name: me.name, action: 'claim', ip: clientIp(req) }).catch(() => {})
      return res.status(200).json({ success: true })
    }

    // ── POST links: only the owner, signed in as himself ──
    if (op === 'links') {
      if (!owner || owner.viewing) return res.status(403).json({ error: 'Só a conta do dono pode vincular contas.' })
      const employeeId = body.employee_id ? String(body.employee_id) : null
      const sellerId = body.salesperson_id ? String(body.salesperson_id) : null
      if (employeeId && !(await loadEmployee(db, employeeId))) return res.status(400).json({ error: 'Funcionário não encontrado ou inativo.' })
      if (sellerId && !(await loadSeller(db, sellerId))) return res.status(400).json({ error: 'Conta de vendas não encontrada ou inativa.' })
      const next = { ...cfg, employee_id: employeeId, salesperson_id: sellerId, updated_at: new Date().toISOString(), updated_by: session.id }
      await writeOwnerConfig(db, next)
      await writeLog(db, { at: next.updated_at, owner_id: session.id, owner_name: session.name, action: 'links', employee_id: employeeId, salesperson_id: sellerId, ip: clientIp(req) }).catch(() => {})
      return res.status(200).json({ success: true })
    }

    // ── POST switch: real session of the chosen linked account ──
    if (op === 'switch') {
      if (!owner) return res.status(403).json({ error: 'Só a conta do dono pode alternar a visão.' })
      const to = String(body.to || '')
      if (!ROLES.includes(to)) return res.status(400).json({ error: 'Papel inválido.' })
      const targetId = to === 'admin' ? cfg.owner_admin_id : to === 'employee' ? cfg.employee_id : cfg.salesperson_id
      if (!targetId) return res.status(400).json({ error: 'Esta conta não está vinculada ao dono.' })
      const target = await loaders[to](db, targetId)
      if (!target) return res.status(400).json({ error: 'A conta vinculada está inativa ou não existe mais.' })
      const ownerAdmin = to === 'admin' ? target : await loadAdmin(db, cfg.owner_admin_id)
      if (!ownerAdmin) return res.status(403).json({ error: 'Conta do dono não encontrada.' })

      // Log first: a switch that cannot be recorded does not happen.
      await writeLog(db, {
        at: new Date().toISOString(), owner_id: ownerAdmin.id, owner_name: ownerAdmin.name, action: 'switch',
        from: session.role, from_id: session.id, from_name: session.name, to, to_id: target.id, to_name: target.name, ip: clientIp(req),
      })
      setCookies(res, target, to === 'admin' ? null : ownerAdmin.id)
      return res.status(200).json({ success: true, user: target, db_token: createDbToken(target), viewing: to === 'admin' ? null : { role: to, name: target.name, team: target.team || null } })
    }

    return res.status(404).json({ error: 'Operação desconhecida.' })
  } catch (error) {
    return res.status(500).json({ error: 'Não foi possível concluir. Tente de novo.' })
  }
}
