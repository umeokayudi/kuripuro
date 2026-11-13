// Fake KIRI Engine for the local test stack: accepts an upload, says "processing" once, then "ready",
// and hands back a zip with a tiny .glb (a coloured box). No real service is called, no credit is spent.
import { deflateRawSync, crc32 } from 'node:zlib'

function tinyGlb() {
  const pos = new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, -1, 1.2, -1, 1, 1.2, -1, 1, 1.2, 1, -1, 1.2, 1])
  const idx = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0])
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)])
  const json = Buffer.from(JSON.stringify({
    asset: { version: '2.0', generator: 'kuripuro-mock' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.18, 0.36, 0.96, 1], metallicFactor: 0, roughnessFactor: 0.9 }, doubleSided: true }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 }, { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength, target: 34963 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-1, 0, -1], max: [1, 1.2, 1] }, { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' }],
  }))
  const pad = (b, fill) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)])
  const j = pad(json, 0x20), b = pad(bin, 0)
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8)
  const jh = Buffer.alloc(8); jh.writeUInt32LE(j.length, 0); jh.writeUInt32LE(0x4e4f534a, 4)
  const bh = Buffer.alloc(8); bh.writeUInt32LE(b.length, 0); bh.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([head, jh, j, bh, b])
}

function zipOne(name, data) {
  const comp = deflateRawSync(data)
  const n = Buffer.from(name)
  const crc = crc32(data)
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8)
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26)
  const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10)
  cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(n.length, 28); cen.writeUInt32LE(0, 42)
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(30 + n.length + comp.length, 16)
  return Buffer.concat([local, n, comp, cen, n, end])
}

const jobs = new Map()
export const kiriCalls = []

export async function kiriFake(req, res, url, bodyBuffer, port) {
  const send = (status, data, type = 'application/json') => { res.writeHead(status, { 'content-type': type }); res.end(type === 'application/json' ? JSON.stringify(data) : data) }
  if (url.pathname === '/_kiri/file.zip') return send(200, zipOne('scan/model.glb', tinyGlb()), 'application/zip')
  if (req.headers.authorization !== 'Bearer mock-kiri') return send(401, { code: 401, ok: false, msg: 'bad key' })
  if (url.pathname === '/_kiri/v1/open/balance') return send(200, { code: 0, ok: true, msg: 'success', data: { balance: Math.max(0, 9 - jobs.size) } })
  const m = /^\/_kiri\/v1\/open\/3dgs\/(image|video)$/.exec(url.pathname)
  if (m && req.method === 'POST') {
    const text = bodyBuffer.toString('latin1')
    const files = (text.match(/name="(imagesFiles|videoFile)"/g) || []).length
    const serialize = `mock-${jobs.size + 1}`
    jobs.set(serialize, 0)
    kiriCalls.push({ kind: m[1], files, bytes: bodyBuffer.length, glb: /name="fileFormat"\r\n\r\nGLB/i.test(text), mesh: /name="isMesh"\r\n\r\n1/.test(text) })
    return send(200, { code: 0, ok: true, msg: 'success', data: { serialize, calculateType: 1 } })
  }
  const serialize = url.searchParams.get('serialize')
  if (url.pathname === '/_kiri/v1/open/model/getStatus') {
    if (!jobs.has(serialize)) return send(200, { code: 2008, ok: false, msg: 'not found' })
    const n = jobs.get(serialize); jobs.set(serialize, n + 1)
    return send(200, { code: 0, ok: true, data: { serialize, status: n === 0 ? 0 : 2 } })
  }
  if (url.pathname === '/_kiri/v1/open/model/getModelZip') return send(200, { code: 0, ok: true, data: { serialize, modelUrl: `http://127.0.0.1:${port}/_kiri/file.zip` } })
  return send(404, { code: 404, ok: false, msg: 'no route' })
}
