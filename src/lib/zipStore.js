// Tiny ZIP writer (no compression) so "download everything" needs no new library.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** files: [{ name, data: Uint8Array | string }] → Blob (application/zip) */
export function zipFiles(files) {
  const enc = new TextEncoder()
  const parts = []
  const central = []
  let offset = 0
  const now = new Date()
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  for (const file of files) {
    const name = enc.encode(file.name)
    const data = typeof file.data === 'string' ? enc.encode(file.data) : file.data
    const crc = crc32(data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true)
    local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true)
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true)
    local.setUint16(26, name.length, true)
    parts.push(new Uint8Array(local.buffer), name, data)
    const head = new DataView(new ArrayBuffer(46))
    head.setUint32(0, 0x02014b50, true); head.setUint16(4, 20, true); head.setUint16(6, 20, true); head.setUint16(8, 0x0800, true)
    head.setUint16(12, dosTime, true); head.setUint16(14, dosDate, true)
    head.setUint32(16, crc, true); head.setUint32(20, data.length, true); head.setUint32(24, data.length, true)
    head.setUint16(28, name.length, true); head.setUint32(42, offset, true)
    central.push(new Uint8Array(head.buffer), name)
    offset += 30 + name.length + data.length
  }
  const centralSize = central.reduce((s, p) => s + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true)
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' })
}

/** Rows → CSV text with a BOM so Excel opens Japanese correctly. */
export function toCsv(rows) {
  const cell = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n')
}
