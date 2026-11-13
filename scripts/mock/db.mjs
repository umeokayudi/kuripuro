// A small in-memory stand-in for Supabase (PostgREST + Storage), used only by the local test stack
// (scripts/mock/server.mjs). It never talks to the real database.
import { randomUUID } from 'node:crypto'
import { SCHEMA } from './schema.mjs'

export const tables = {}
for (const t of Object.keys(SCHEMA)) tables[t] = []
export const storage = new Map() // "bucket/path" -> { body: Buffer, type, updated }
export const log = { writes: [] }

const pgErr = (status, code, message) => ({ status, body: { code, message, details: null, hint: null } })

function splitTop(s) {
  const out = []; let depth = 0, cur = '', q = false
  for (const ch of s) {
    if (ch === '"') q = !q
    if (!q && ch === '(') depth++
    if (!q && ch === ')') depth--
    if (!q && ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

function coerce(v) {
  if (v === 'null') return null
  if (v === 'true') return true
  if (v === 'false') return false
  return v
}
const unq = v => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v)
const cmp = (a, b) => {
  if (a == null || b == null) return NaN
  const na = Number(a), nb = Number(b)
  if (a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb) && typeof a !== 'boolean') return na - nb
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}
const likeRe = (pat, i) => new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*').replace(/_/g, '.') + '$', i ? 'is' : 's')

function testOp(val, expr) {
  let neg = false
  if (expr.startsWith('not.')) { neg = true; expr = expr.slice(4) }
  const dot = expr.indexOf('.')
  const op = dot < 0 ? expr : expr.slice(0, dot)
  const arg = dot < 0 ? '' : expr.slice(dot + 1)
  let r
  switch (op) {
    case 'eq': r = val != null && String(val) === unq(arg); break
    case 'neq': r = val != null && String(val) !== unq(arg); break
    case 'gt': r = cmp(val, unq(arg)) > 0; break
    case 'gte': r = cmp(val, unq(arg)) >= 0; break
    case 'lt': r = cmp(val, unq(arg)) < 0; break
    case 'lte': r = cmp(val, unq(arg)) <= 0; break
    case 'like': r = val != null && likeRe(unq(arg), false).test(String(val)); break
    case 'ilike': r = val != null && likeRe(unq(arg), true).test(String(val)); break
    case 'is': { const c = coerce(arg); r = c === null ? val == null : val === c; break }
    case 'in': { const list = splitTop(arg.replace(/^\(|\)$/g, '')).map(unq); r = val != null && list.includes(String(val)); break }
    case 'cs': { const list = splitTop(arg.replace(/^[{[(]|[}\])]$/g, '')).map(unq); r = Array.isArray(val) && list.every(x => val.map(String).includes(x)); break }
    default: r = true
  }
  return neg ? !r : r
}

function testLogic(row, expr, mode) {
  const parts = splitTop(expr.replace(/^\(|\)$/g, ''))
  const fn = p => {
    if (p.startsWith('and(')) return testLogic(row, p.slice(3), 'and')
    if (p.startsWith('or(')) return testLogic(row, p.slice(2), 'or')
    const i = p.indexOf('.')
    return testOp(row[p.slice(0, i)], p.slice(i + 1))
  }
  return mode === 'or' ? parts.some(fn) : parts.every(fn)
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])

function parseSelect(sel) {
  if (!sel || sel === '*') return null
  return splitTop(sel).map(s => s.trim()).filter(Boolean).map(s => {
    const m = s.match(/^(?:([\w]+):)?([\w]+)(?:!\w+)?\((.*)\)$/s)
    if (m) return { embed: m[2], alias: m[1] || m[2], inner: m[3] }
    const [a, b] = s.split(':')
    const col = (b || a).split('::')[0]
    return { col, alias: b ? a : col }
  })
}

function project(table, row, sel) {
  if (!sel) return { ...row }
  const out = {}
  for (const f of sel) {
    if (f.embed) {
      const child = tables[f.embed] || []
      const singular = table.replace(/s$/, '')
      const keys = [`${table}_id`, `${singular}_id`]
      const k = keys.find(x => SCHEMA[f.embed]?.includes(x))
      const inner = parseSelect(f.inner)
      if (k) out[f.alias] = child.filter(c => c[k] === row.id).map(c => project(f.embed, c, inner))
      else {
        const fk = `${f.embed.replace(/s$/, '')}_id`
        const one = child.find(c => c.id === row[fk])
        out[f.alias] = one ? project(f.embed, one, inner) : null
      }
    } else if (f.col === '*') Object.assign(out, row)
    else out[f.alias] = row[f.col] ?? null
  }
  return out
}

function checkColumns(table, cols) {
  const known = SCHEMA[table]
  for (const c of cols) if (c && c !== '*' && !known.includes(c)) return pgErr(400, '42703', `column ${table}.${c} does not exist`)
  return null
}

function matchRows(table, params) {
  let rows = tables[table]
  const used = []
  for (const [k, v] of params) {
    if (RESERVED.has(k)) continue
    if (k === 'or') rows = rows.filter(r => testLogic(r, v, 'or'))
    else if (k === 'and') rows = rows.filter(r => testLogic(r, v, 'and'))
    else { used.push(k.split('->')[0]); rows = rows.filter(r => testOp(r[k], v)) }
  }
  return { rows, used }
}

function fill(table, row) {
  const cols = SCHEMA[table]
  const out = {}
  for (const c of cols) out[c] = row[c] === undefined ? null : row[c]
  if (cols.includes('id') && !out.id) out.id = randomUUID()
  const now = new Date().toISOString()
  for (const c of ['created_at', 'updated_at']) if (cols.includes(c) && !out[c]) out[c] = now
  if (cols.includes('is_active') && row.is_active === undefined) out.is_active = true
  return out
}

/** One PostgREST request. Returns { status, body, headers }. */
export function rest(method, table, url, headers, body) {
  if (!SCHEMA[table]) return pgErr(404, 'PGRST205', `Could not find the table 'public.${table}' in the schema cache`)
  const params = [...url.searchParams.entries()]
  const prefer = String(headers.prefer || '')
  const wantObject = String(headers.accept || '').includes('vnd.pgrst.object')
  const selRaw = url.searchParams.get('select')
  const sel = parseSelect(selRaw)
  if (sel) { const e = checkColumns(table, sel.filter(f => !f.embed).map(f => f.col)); if (e) return e }
  const { rows: matched, used } = matchRows(table, params)
  { const e = checkColumns(table, used); if (e) return e }

  const finish = (rows, status = 200) => {
    const total = rows.length
    const order = url.searchParams.get('order')
    if (order) {
      const keys = order.split(',').map(o => { const [c, ...f] = o.split('.'); return { c, desc: f.includes('desc'), nullsFirst: f.includes('nullsfirst') } })
      { const e = checkColumns(table, keys.map(k => k.c)); if (e) return e }
      rows = [...rows].sort((a, b) => {
        for (const k of keys) {
          const x = a[k.c], y = b[k.c]
          if (x == null && y == null) continue
          if (x == null) return k.desc ? -1 : 1
          if (y == null) return k.desc ? 1 : -1
          const d = cmp(x, y); if (d) return k.desc ? -d : d
        }
        return 0
      })
    }
    let from = Number(url.searchParams.get('offset') || 0)
    let lim = url.searchParams.get('limit')
    const range = headers.range && String(headers.range).match(/(\d+)-(\d+)?/)
    if (range) { from = Number(range[1]); if (range[2] != null) lim = Number(range[2]) - from + 1 }
    if (from || lim != null) rows = rows.slice(from, lim != null ? from + Number(lim) : undefined)
    const out = rows.map(r => project(table, r, sel))
    const h = { 'content-range': `${out.length ? from : '*'}-${out.length ? from + out.length - 1 : '*'}/${prefer.includes('count=') ? total : '*'}` }
    if (method === 'HEAD') return { status: 200, body: null, headers: h }
    if (wantObject) {
      if (out.length !== 1) return { status: 406, body: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${out.length} rows`, hint: null }, headers: h }
      return { status, body: out[0], headers: h }
    }
    return { status, body: out, headers: h }
  }

  if (method === 'GET' || method === 'HEAD') return finish(matched)

  const returning = prefer.includes('return=representation')
  if (method === 'POST') {
    const list = Array.isArray(body) ? body : [body || {}]
    { const e = checkColumns(table, [...new Set(list.flatMap(r => Object.keys(r)))]); if (e) return e }
    const conflict = (url.searchParams.get('on_conflict') || (prefer.includes('resolution=') ? (SCHEMA[table].includes('id') ? 'id' : '') : '')).split(',').filter(Boolean)
    const done = []
    for (const raw of list) {
      const existing = conflict.length && tables[table].find(r => conflict.every(c => raw[c] != null && String(r[c]) === String(raw[c])))
      if (existing) {
        if (prefer.includes('resolution=ignore-duplicates')) continue
        if (!prefer.includes('resolution=merge-duplicates')) return pgErr(409, '23505', 'duplicate key value violates unique constraint')
        Object.assign(existing, raw); done.push(existing)
      } else { const row = fill(table, raw); tables[table].push(row); done.push(row) }
    }
    log.writes.push({ at: Date.now(), op: 'insert', table, n: done.length })
    return returning ? finish(done, 201) : { status: 201, body: null }
  }
  if (method === 'PATCH') {
    { const e = checkColumns(table, Object.keys(body || {})); if (e) return e }
    for (const r of matched) Object.assign(r, body)
    log.writes.push({ at: Date.now(), op: 'update', table, n: matched.length })
    return returning ? finish(matched) : { status: 204, body: null }
  }
  if (method === 'DELETE') {
    const gone = new Set(matched)
    tables[table] = tables[table].filter(r => !gone.has(r))
    log.writes.push({ at: Date.now(), op: 'delete', table, n: matched.length })
    return returning ? finish(matched) : { status: 204, body: null }
  }
  return pgErr(405, 'PGRST000', 'method not allowed')
}

/** Storage API (the calls supabase-js makes). */
export function storageApi(method, path, url, headers, raw) {
  const json = () => { try { return JSON.parse(raw.toString('utf8') || '{}') } catch { return {} } }
  const put = (key) => {
    let body = raw, type = headers['content-type'] || 'application/octet-stream'
    if (String(type).startsWith('multipart/form-data')) {
      const boundary = '--' + String(type).split('boundary=')[1]
      const text = raw.toString('latin1')
      const parts = text.split(boundary).filter(p => p.includes('filename='))
      const part = parts[0] || ''
      const headEnd = part.indexOf('\r\n\r\n')
      const ct = part.slice(0, headEnd).match(/Content-Type:\s*([^\r\n]+)/i)
      type = ct ? ct[1].trim() : 'application/octet-stream'
      body = Buffer.from(part.slice(headEnd + 4).replace(/\r\n$/, ''), 'latin1')
    }
    storage.set(key, { body, type, updated: new Date().toISOString() })
    return { status: 200, body: { Key: key, Id: randomUUID() } }
  }
  const serve = key => {
    const f = storage.get(key)
    if (!f) return { status: 400, body: { statusCode: '404', error: 'not_found', message: 'Object not found' } }
    return { status: 200, raw: f.body, headers: { 'content-type': f.type, 'cache-control': 'no-store' } }
  }
  let m
  if ((m = path.match(/^object\/list\/([^/]+)$/)) && method === 'POST') {
    const { prefix = '', limit = 100, offset = 0, search } = json()
    const base = `${m[1]}/${prefix ? prefix.replace(/\/$/, '') + '/' : ''}`
    const names = new Map()
    for (const [k, f] of storage) {
      if (!k.startsWith(base)) continue
      const rest = k.slice(base.length)
      const [first, ...more] = rest.split('/')
      if (search && !first.includes(search)) continue
      if (more.length) names.set(first, { name: first, id: null, updated_at: null, created_at: null, metadata: null })
      else names.set(first, { name: first, id: randomUUID(), updated_at: f.updated, created_at: f.updated, last_accessed_at: f.updated, metadata: { size: f.body.length, mimetype: f.type } })
    }
    return { status: 200, body: [...names.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(offset, offset + limit) }
  }
  if ((m = path.match(/^object\/sign\/([^/]+)$/)) && method === 'POST') {
    const { paths = [] } = json()
    return { status: 200, body: paths.map(p => storage.has(`${m[1]}/${p}`) ? { path: p, signedURL: `/object/sign/${m[1]}/${p}?token=mock`, error: null } : { path: p, signedURL: null, error: 'Either the object does not exist or you do not have access to it' }) }
  }
  if ((m = path.match(/^object\/upload\/sign\/(.+)$/))) {
    if (method === 'POST') return { status: 200, body: { url: `/object/upload/sign/${m[1]}?token=mock`, token: 'mock' } }
    if (method === 'PUT') return put(m[1])
  }
  if ((m = path.match(/^object\/sign\/(.+)$/))) {
    if (method === 'POST') return storage.has(m[1]) ? { status: 200, body: { signedURL: `/object/sign/${m[1]}?token=mock` } } : { status: 400, body: { statusCode: '404', error: 'not_found', message: 'Object not found' } }
    if (method === 'GET') return serve(m[1])
  }
  if ((m = path.match(/^object\/(?:public\/|authenticated\/)?(.+)$/))) {
    if (method === 'GET') return serve(m[1])
    if (method === 'HEAD') return storage.has(m[1]) ? { status: 200, body: null } : { status: 400, body: null }
    if (method === 'POST') {
      if (storage.has(m[1]) && String(headers['x-upsert']) !== 'true') return { status: 400, body: { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' } }
      return put(m[1])
    }
    if (method === 'PUT') return put(m[1])
    if (method === 'DELETE') {
      const bucket = m[1].split('/')[0]
      const { prefixes = [] } = json()
      const gone = []
      for (const p of prefixes) if (storage.delete(`${bucket}/${p}`)) gone.push({ name: p })
      return { status: 200, body: gone }
    }
  }
  return { status: 404, body: { error: 'mock storage: route not found', path } }
}
