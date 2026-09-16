import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function wrapNodeResponse(res) {
  if (typeof res.status === 'function' && typeof res.send === 'function') return res
  res.status = (code) => {
    res.statusCode = code
    return res
  }
  res.json = (obj) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(obj))
    return res
  }
  res.send = (body) => {
    if (body == null) {
      res.end()
      return res
    }
    if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
      res.end(body)
      return res
    }
    if (typeof body === 'object') {
      if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(body))
      return res
    }
    res.end(String(body))
    return res
  }
  return res
}

/** Serve `/api/*.js` Vercel handlers during Vite so photos and reports work locally. */
function vercelApiDevPlugin() {
  return {
    name: 'vercel-api-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const raw = req.url || ''
        if (!raw.startsWith('/api/')) return next()
        const pathname = raw.split('?')[0]
        const name = pathname.replace(/^\/api\//, '').replace(/\/$/, '')
        if (!name || name.includes('..') || name.startsWith('_') || name.includes('/')) return next()

        const file = path.resolve(process.cwd(), 'api', `${name}.js`)
        try {
          const mod = await import(pathToFileURL(file).href)
          const handler = mod.default
          if (typeof handler !== 'function') return next()
          const u = new URL(raw, 'http://localhost')
          req.query = Object.fromEntries(u.searchParams)
          await handler(req, wrapNodeResponse(res))
        } catch (err) {
          if (err.code === 'ERR_MODULE_NOT_FOUND') return next()
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: err.message }))
          }
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), vercelApiDevPlugin()],
})
