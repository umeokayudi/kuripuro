import {
  clearSalesSessionCookie,
  createSalesSession,
  hashSalesPassword,
  salesDb,
  salesSessionConfigured,
  setSalesSessionCookie,
  verifySalesPassword,
  EMPLOYEE_SESSION_TTL,
} from './_salesSession.js'

const attempts = new Map()

function clientKey(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()
}

// Only failed attempts count, so a shared office Wi-Fi with many correct logins is never blocked.
function limited(req) {
  const entry = attempts.get(clientKey(req))
  if (!entry) return false
  if (entry.reset <= Date.now()) { attempts.delete(clientKey(req)); return false }
  return entry.count >= 12
}

function recordFailure(req) {
  const key = clientKey(req)
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || entry.reset <= now) attempts.set(key, { count: 1, reset: now + 15 * 60_000 })
  else entry.count += 1
}

async function isOtherAccount(db, email) {
  if (!email.includes('@')) return true // client store logins use the store name
  const [emp, client] = await Promise.all([
    db.from('employees').select('id').eq('email', email).limit(1).maybeSingle(),
    db.from('client_users').select('id').eq('email', email).limit(1).maybeSingle(),
  ])
  return Boolean(emp.data || client.data)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (!salesSessionConfigured()) return res.status(503).json({ error: 'Configure SUPABASE_SERVICE_ROLE_KEY e SALES_SESSION_SECRET no servidor.' })

  if (req.method === 'DELETE') {
    clearSalesSessionCookie(res)
    return res.status(200).json({ success: true })
  }
  if (req.method === 'GET') {
    const { readSalesSession, sellerAccess } = await import('./_salesSession.js')
    const user = readSalesSession(req)
    if (user?.role === 'salesperson') {
      const { data } = await sellerAccess(user.id).catch(() => ({}))
      if (data) user.team = data.team === 'marketing' ? 'marketing' : 'sales'
    }
    return res.status(user ? 200 : 401).json(user ? { user } : { error: 'Sessão expirada.' })
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (limited(req)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' })

  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  if (!email || !password) return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' })
  // v1.0.117 · a login still waiting for its set-password link ("setup:<token>") never opens a session
  if (password.startsWith('setup:')) return res.status(401).json({ error: 'E-mail ou senha incorretos.' })

  try {
    const db = salesDb()
    const { data: admin } = await db.from('admins').select('id,name,email,password').eq('email', email).maybeSingle()
    if (admin && admin.password === password) {
      const user = { id: admin.id, name: admin.name, email: admin.email, role: 'admin' }
      // Admins stay signed in on the app for weeks (kp_user in localStorage), so the
      // server session must last as long or Sales Team, Marketing and the AI stop working.
      setSalesSessionCookie(res, createSalesSession(user, EMPLOYEE_SESSION_TTL), EMPLOYEE_SESSION_TTL)
      return res.status(200).json({ success: true, user })
    }

    // Employees get a signed session too, so their AI can only ever read their own account.
    const { data: emp } = await db.from('employees')
      .select('id,full_name,email,password,contract_type,hourly_rate,fixed_salary,salary_type,score')
      .eq('email', email).eq('is_active', true).maybeSingle()
    if (emp && emp.password === password) {
      const user = { id: emp.id, name: emp.full_name, email: emp.email, role: 'employee', contract_type: emp.contract_type, hourly_rate: emp.hourly_rate, fixed_salary: emp.fixed_salary, salary_type: emp.salary_type, score: emp.score }
      setSalesSessionCookie(res, createSalesSession(user, EMPLOYEE_SESSION_TTL), EMPLOYEE_SESSION_TTL)
      return res.status(200).json({ success: true, user })
    }

    const sellerQuery = cols => db.from('salespeople').select(cols).eq('email', email).eq('is_active', true).maybeSingle()
    let { data: seller, error: sellerErr } = await sellerQuery('id,full_name,email,password_hash,phone,is_active,team')
    // Before the team column exists every sales login is a seller.
    if (sellerErr) ({ data: seller } = await sellerQuery('id,full_name,email,password_hash,phone,is_active'))
    if (!seller || !verifySalesPassword(password, seller.password_hash, email)) {
      // Employee and client logins also pass here first; only count a failure
      // when no other account type matches, which the browser checks next.
      if (!(await isOtherAccount(db, email))) recordFailure(req)
      return res.status(401).json({ error: 'E-mail ou senha inválidos.' })
    }

    if (!String(seller.password_hash || '').startsWith('scrypt$')) {
      await db.from('salespeople').update({ password_hash: hashSalesPassword(password) }).eq('id', seller.id)
    }
    const user = { id: seller.id, name: seller.full_name, email: seller.email, role: 'salesperson', phone: seller.phone || '', team: seller.team === 'marketing' ? 'marketing' : 'sales' }
    // Same 30-day session as employees: kp_user stays in the browser, so a 12h cookie
    // made sellers look signed in while every Sales portal call failed. Deactivation
    // still applies at once (requireActiveSalesSession checks is_active per request).
    setSalesSessionCookie(res, createSalesSession(user, EMPLOYEE_SESSION_TTL), EMPLOYEE_SESSION_TTL)
    return res.status(200).json({ success: true, user })
  } catch (error) {
    return res.status(500).json({ error: 'Não foi possível iniciar a sessão comercial.' })
  }
}
