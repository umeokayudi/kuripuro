import {
  clearSalesSessionCookie,
  createSalesSession,
  hashSalesPassword,
  salesDb,
  salesSessionConfigured,
  setSalesSessionCookie,
  verifySalesPassword,
} from './_salesSession.js'

const attempts = new Map()

function limited(req) {
  const key = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0]
  const now = Date.now()
  const old = attempts.get(key) || { count: 0, reset: now + 15 * 60_000 }
  if (old.reset <= now) { old.count = 0; old.reset = now + 15 * 60_000 }
  old.count += 1
  attempts.set(key, old)
  return old.count > 12
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (!salesSessionConfigured()) return res.status(503).json({ error: 'Configure SUPABASE_SERVICE_ROLE_KEY e SALES_SESSION_SECRET no servidor.' })

  if (req.method === 'DELETE') {
    clearSalesSessionCookie(res)
    return res.status(200).json({ success: true })
  }
  if (req.method === 'GET') {
    const { readSalesSession } = await import('./_salesSession.js')
    const user = readSalesSession(req)
    return res.status(user ? 200 : 401).json(user ? { user } : { error: 'Sessão expirada.' })
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (limited(req)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' })

  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  if (!email || !password) return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' })

  try {
    const db = salesDb()
    const { data: admin } = await db.from('admins').select('id,name,email,password').eq('email', email).maybeSingle()
    if (admin && admin.password === password) {
      const user = { id: admin.id, name: admin.name, email: admin.email, role: 'admin' }
      setSalesSessionCookie(res, createSalesSession(user))
      return res.status(200).json({ success: true, user })
    }

    const { data: seller } = await db.from('salespeople')
      .select('id,full_name,email,password_hash,phone,is_active')
      .eq('email', email).eq('is_active', true).maybeSingle()
    if (!seller || !verifySalesPassword(password, seller.password_hash, email)) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos.' })
    }

    if (!String(seller.password_hash || '').startsWith('scrypt$')) {
      await db.from('salespeople').update({ password_hash: hashSalesPassword(password) }).eq('id', seller.id)
    }
    const user = { id: seller.id, name: seller.full_name, email: seller.email, role: 'salesperson', phone: seller.phone || '' }
    setSalesSessionCookie(res, createSalesSession(user))
    return res.status(200).json({ success: true, user })
  } catch (error) {
    return res.status(500).json({ error: 'Não foi possível iniciar a sessão comercial.' })
  }
}
