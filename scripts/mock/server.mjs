#!/usr/bin/env node
// Local test stack: the real API handlers (api/*.js) + an in-memory fake of Supabase.
// Nothing here reaches the production database, e-mail, push or AI.
//   node scripts/mock/server.mjs            → http://localhost:5199 (API + fake database)
//   npx vite --config scripts/mock/vite.config.mjs   → http://localhost:5173 (the app)
import http from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const PORT = Number(process.env.MOCK_PORT || 5199)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
process.env.VITE_SUPABASE_URL = `http://127.0.0.1:${PORT}/_sb`
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role'
process.env.SUPABASE_ANON_KEY = 'mock-anon'
process.env.SALES_SESSION_SECRET = 'mock-secret-mock-secret-mock-secret-mock'
process.env.OWNER_EMAILS = 'admin@kuripuro.com,teste.admin@kuripuro.com'
process.env.CRON_SECRET = 'mock-cron'
process.env.CLIENT_EMAIL_MODE = 'off'
for (const k of ['GEMINI_API_KEY', 'META_AI_API_KEY', 'RESEND_API_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']) if (!process.env.MOCK_KEEP_KEYS) delete process.env[k]

const { rest, storageApi, tables, log } = await import('./db.mjs')
const { seed } = await import('./fixtures.mjs')
seed()

const vercel = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'))
const rewrites = vercel.rewrites.filter(r => r.source.startsWith('/api/')).map(r => {
  const names = []
  const re = new RegExp('^' + r.source.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)' }) + '$')
  return { re, names, destination: r.destination }
})
const handlers = new Map()
async function handlerFor(name) {
  if (!handlers.has(name)) {
    const file = path.join(ROOT, 'api', `${name}.js`)
    handlers.set(name, existsSync(file) && !name.startsWith('_') ? await import(pathToFileURL(file).href) : null)
  }
  return handlers.get(name)
}
const readBody = req => new Promise(resolve => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))) })
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
    if (url.pathname.startsWith('/_sb/')) {
      const raw = await readBody(req)
      const p = url.pathname.slice(5)
      let out
      if (p.startsWith('rest/v1/rpc/')) out = { status: 404, body: { code: 'PGRST202', message: 'function not found (mock)' } }
      else if (p.startsWith('rest/v1/')) {
        let body = null
        try { body = raw.length ? JSON.parse(raw.toString('utf8')) : null } catch {}
        out = rest(req.method, decodeURIComponent(p.slice(8)), url, req.headers, body)
      } else if (p.startsWith('storage/v1/')) out = storageApi(req.method, decodeURIComponent(p.slice(11)), url, req.headers, raw)
      else out = { status: 404, body: { error: 'mock: not found' } }
      if (out.raw) { res.writeHead(out.status, { ...cors, ...out.headers }); return res.end(out.raw) }
      res.writeHead(out.status, { ...cors, 'content-type': 'application/json', ...(out.headers || {}) })
      return res.end(out.body == null ? '' : JSON.stringify(out.body))
    }
    if (url.pathname === '/_mock/reset') { seed(); res.writeHead(200, cors); return res.end('ok') }
    if (url.pathname === '/_mock/state') { res.writeHead(200, { ...cors, 'content-type': 'application/json' }); return res.end(JSON.stringify({ counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])), writes: log.writes.slice(-50) })) }
    if (url.pathname.startsWith('/_mock/table/')) { res.writeHead(200, { ...cors, 'content-type': 'application/json' }); return res.end(JSON.stringify(tables[url.pathname.slice(13)] || null)) }
    if (url.pathname.startsWith('/api/')) {
      let target = url.pathname, query = Object.fromEntries(url.searchParams)
      for (const r of rewrites) {
        const m = target.match(r.re)
        if (!m) continue
        let dest = r.destination
        r.names.forEach((n, i) => { dest = dest.replace(`:${n}`, encodeURIComponent(m[i + 1])) })
        const d = new URL(dest, 'http://x')
        target = d.pathname; query = { ...query, ...Object.fromEntries(d.searchParams) }
        break
      }
      const mod = await handlerFor(target.slice(5))
      if (!mod?.default) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'API route not found (mock)' })) }
      const raw = await readBody(req)
      req.query = query
      const type = String(req.headers['content-type'] || '')
      if (mod.config?.api?.bodyParser !== false) {
        if (type.includes('application/json')) { try { req.body = raw.length ? JSON.parse(raw.toString('utf8')) : {} } catch { req.body = {} } }
        else if (type.includes('text/')) req.body = raw.toString('utf8')
        else req.body = raw.length ? raw : {}
      }
      res.status = code => { res.statusCode = code; return res }
      res.json = obj => { if (!res.headersSent) res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); return res }
      res.send = v => { if (typeof v === 'object' && !Buffer.isBuffer(v)) return res.json(v); res.end(v); return res }
      res.redirect = (a, b) => { res.writeHead(typeof a === 'number' ? a : 302, { location: typeof a === 'number' ? b : a }); res.end(); return res }
      await mod.default(req, res)
      return
    }
    res.writeHead(404); res.end('mock: not found')
  } catch (e) {
    console.error('[mock]', req.method, req.url, e)
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: String(e?.message || e) }))
  }
}).listen(PORT, '127.0.0.1', () => console.log(`[mock] API + fake database on http://127.0.0.1:${PORT}`))
