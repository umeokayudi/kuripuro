// v1.0.211 · PDF anexado ao e-mail de confirmação: capa com a lista do dia + uma página por serviço
// (loja, tipo, horário, responsável, notas e fotos de antes/depois). Feito no servidor com jsPDF e a
// fonte Noto Sans JP (o jsPDF grava só os caracteres usados, então o arquivo fica pequeno).
import { readFile } from 'node:fs/promises'
import { jsPDF } from 'jspdf'
import { longDate } from '../src/lib/clientEmailContent.js'

const FONT_FILE = new URL('./_fonts/NotoSansJP_400Regular.ttf', import.meta.url)
const FONT_CDN = 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans-jp@0.4.4/400Regular/NotoSansJP_400Regular.ttf'
let fontB64 = null

async function loadFont() {
  if (fontB64) return fontB64
  let bytes
  try { bytes = await readFile(FONT_FILE) } catch {
    const r = await fetch(FONT_CDN)
    if (!r.ok) throw new Error(`fonte japonesa indisponível (${r.status})`)
    bytes = Buffer.from(await r.arrayBuffer())
  }
  fontB64 = bytes.toString('base64')
  return fontB64
}

const PAGE_W = 595.28, PAGE_H = 841.89, M = 40
const INK = [15, 23, 42], GREY = [100, 116, 139], LINE = [226, 232, 240], BLUE = [37, 99, 235]

const pick = (lang, ja, en, pt) => (lang === 'en' ? en : lang === 'pt' ? pt : ja)

/** JPEG / PNG only (webp/heic are skipped): returns 'JPEG' | 'PNG' | null. */
export function imageType(buf) {
  if (!buf || buf.length < 8) return null
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'JPEG'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'PNG'
  return null
}

/**
 * @param {object} p
 * @param {object} p.client { company_name }
 * @param {string} p.date
 * @param {Array} p.services serviceLine() + { photos: { before: Buffer[], after: Buffer[] } }
 * @param {Array} p.notDone
 * @param {'day'|'spot'} p.kind
 * @returns {Promise<Buffer>}
 */
export async function buildReportPdf({ client, date, services = [], notDone = [], kind = 'day', lang = 'ja' }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  doc.addFileToVFS('NotoSansJP.ttf', await loadFont())
  doc.addFont('NotoSansJP.ttf', 'NotoSansJP', 'normal')
  doc.setFont('NotoSansJP', 'normal')
  const title = pick(lang, '作業報告書', 'Service report', 'Relatório de serviço')
  doc.setProperties({ title: `${title} ${date} ${client?.company_name || ''}`, creator: 'KuriPuro' })

  const T = {
    company: pick(lang, '御中', '', ''),
    date: pick(lang, '作業日', 'Date', 'Data'),
    list: pick(lang, '作業一覧', 'Services', 'Serviços'),
    store: pick(lang, '店舗', 'Store', 'Loja'),
    type: pick(lang, '作業内容', 'Service', 'Tipo'),
    time: pick(lang, '作業時間', 'Time', 'Horário'),
    staff: pick(lang, '担当', 'Done by', 'Responsável'),
    notes: pick(lang, '備考', 'Notes', 'Observações'),
    before: pick(lang, '作業前', 'Before', 'Antes'),
    after: pick(lang, '作業後', 'After', 'Depois'),
    noPhoto: pick(lang, '写真なし', 'no photo', 'sem foto'),
    notDone: pick(lang, '未実施', 'Not carried out', 'Não realizado'),
    issuer: 'KuriPuro（Umeoka Group）',
  }
  const timeOf = s => (s.start || s.end ? `${s.start || '—'}〜${s.end || '—'}` : '—')
  const W = PAGE_W - 2 * M
  let y = M

  const text = (t, x, size, color = INK) => { doc.setFontSize(size); doc.setTextColor(...color); doc.text(String(t ?? ''), x, y) }
  const width = (t, size) => { doc.setFontSize(size); return doc.getTextWidth(String(t || '')) }
  const cut = (t, w, size) => {
    const full = String(t || '')
    let s = full
    while (s && width(s, size) > w) s = s.slice(0, -1)
    return s.length < full.length ? `${s.slice(0, -1)}…` : s
  }
  const wrap = (t, size, w) => {
    const lines = []
    for (const para of String(t || '').split(/\n/)) {
      let cur = ''
      for (const ch of [...para]) {
        if (width(cur + ch, size) > w && cur) {
          const sp = cur.lastIndexOf(' ')
          if (sp > 0 && /[A-Za-z0-9À-ÿ]/.test(ch)) { lines.push(cur.slice(0, sp)); cur = cur.slice(sp + 1) + ch } else { lines.push(cur); cur = ch }
        } else cur += ch
      }
      lines.push(cur)
    }
    return lines
  }
  const newPage = () => { doc.addPage(); y = M }
  const need = h => { if (y + h > PAGE_H - M) newPage() }
  const rule = () => { doc.setDrawColor(...LINE); doc.setLineWidth(0.7); doc.line(M, y, PAGE_W - M, y) }

  // ── cover ──
  y = M + 18
  text(title, M, 22); y += 28
  text(`${client?.company_name || ''} ${T.company}`.trim(), M, 14); y += 20
  text(`${T.date}：${longDate(date, lang)}`, M, 11, GREY); y += 26
  const cols = [M, M + 190, M + 340, M + 430]
  if (kind !== 'spot') {
    text(T.list, M, 12, BLUE); y += 8; rule(); y += 16
    for (const [i, h] of [T.store, T.type, T.time, T.staff].entries()) text(h, cols[i], 9, GREY)
    y += 16
    for (const s of services) {
      need(18)
      text(cut(s.store, 182, 10), cols[0], 10)
      text(cut(s.type, 144, 9), cols[1], 9)
      text(timeOf(s), cols[2], 9)
      text(cut(s.staff, 85, 9), cols[3], 9)
      y += 16
    }
    for (const s of notDone) {
      need(18)
      text(cut(s.store, 182, 10), cols[0], 10, GREY)
      text(cut(s.type, 144, 9), cols[1], 9, GREY)
      text(T.notDone, cols[2], 9, GREY)
      y += 16
    }
  }

  // ── one page per service (a spot continues on the cover) ──
  for (const [i, s] of services.entries()) {
    if (kind === 'spot' && i === 0) y += 4
    else newPage()
    y += 14
    text(kind === 'spot' ? s.store : `${i + 1}. ${s.store}`, M, 15); y += 10; rule(); y += 18
    for (const [k, v] of [[T.type, s.type], [T.time, timeOf(s)], [T.staff, s.staff]]) {
      if (!v) continue
      text(k, M, 9.5, GREY)
      for (const ln of wrap(v, 10.5, W - 70)) { text(ln, M + 70, 10.5); y += 15 }
      y += 2
    }
    if (s.notes) {
      const lines = wrap(s.notes, 10, W - 70)
      need(Math.min(lines.length, 6) * 15 + 8)
      text(T.notes, M, 9.5, GREY)
      for (const ln of lines) { need(15); text(ln, M + 70, 10); y += 15 }
      y += 2
    }
    y += 10
    // photos: before | after, side by side
    const before = s.photos?.before || [], after = s.photos?.after || []
    const rows = Math.max(before.length, after.length, 1)
    const colW = (W - 14) / 2, maxH = 190
    need(30)
    text(T.before, M, 10, BLUE); text(T.after, M + colW + 14, 10, BLUE); y += 8
    for (let r = 0; r < rows; r++) {
      const imgs = [before[r], after[r]].map(buf => {
        const type = imageType(buf)
        if (!type) return null
        try {
          const data = new Uint8Array(buf)
          const p = doc.getImageProperties(data)
          const sc = Math.min(colW / p.width, maxH / p.height)
          return { data, type, w: p.width * sc, h: p.height * sc }
        } catch { return null }
      })
      const h = Math.max(40, ...imgs.map(m => (m ? m.h : 0)))
      need(h + 10)
      imgs.forEach((m, c) => {
        const x = M + c * (colW + 14)
        if (m) {
          try { doc.addImage(m.data, m.type, x + (colW - m.w) / 2, y + (h - m.h) / 2, m.w, m.h, undefined, 'FAST') } catch { /* broken photo: leave the space */ }
        } else if (r === 0) {
          const keep = y; y += 20; text(T.noPhoto, x, 9, GREY); y = keep
        }
      })
      y += h + 10
    }
  }

  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFontSize(8); doc.setTextColor(...GREY)
    doc.text(`${T.issuer}  ·  ${p} / ${pages}`, M, PAGE_H - 22)
  }
  return Buffer.from(doc.output('arraybuffer'))
}
