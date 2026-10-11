import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'

// Turns the printable 業務委託契約書 HTML into an A4 PDF in the browser.
// The page is rendered as an image (so Japanese text looks exactly like the print preview)
// and cut into pages on blank rows, so no line of text is split between two pages.

const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 14
const RENDER_WIDTH = 720
// Wider frame than the page so the phone layout (@media max-width:720px) never applies.
const FRAME_WIDTH = 820

function renderFrame(html) {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${FRAME_WIDTH}px;height:1200px;border:0;visibility:hidden`
    const timer = setTimeout(() => { iframe.remove(); reject(new Error('PDF render timed out')) }, 15000)
    iframe.onload = async () => {
      clearTimeout(timer)
      const doc = iframe.contentDocument
      const style = doc.createElement('style')
      style.textContent = 'html,body{width:720px!important;max-width:none!important;margin:0!important;padding:2px 2px 28px!important;font-size:14px!important}'
      doc.head.appendChild(style)
      try { await doc.fonts?.ready } catch { /* fonts are optional */ }
      await Promise.all([...doc.images].map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r })))
      resolve(iframe)
    }
    iframe.srcdoc = html
    document.body.appendChild(iframe)
  })
}

/** Lowest blank row in [from, to) of the canvas, or `to` when there is none. */
function blankRowAbove(ctx, width, from, to) {
  const band = ctx.getImageData(0, from, width, to - from).data
  for (let y = to - from - 1; y >= 0; y--) {
    let blank = true
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4
      if (band[i] < 245 || band[i + 1] < 245 || band[i + 2] < 245) { blank = false; break }
    }
    if (blank) return from + y
  }
  return to
}

/** A4 PDF Blob for one contract's print HTML. */
export async function contractPdfBlob(html, { footer = '' } = {}) {
  const iframe = await renderFrame(html)
  let canvas
  try {
    const body = iframe.contentDocument.body
    canvas = await html2canvas(body, {
      scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false,
      width: RENDER_WIDTH, windowWidth: FRAME_WIDTH, height: body.scrollHeight, windowHeight: body.scrollHeight,
    })
  } finally {
    iframe.remove()
  }

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const contentW = PAGE_W - MARGIN * 2
  const contentH = PAGE_H - MARGIN * 2 - 6
  const pxPerMm = canvas.width / contentW
  const pagePx = Math.floor(contentH * pxPerMm)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  const cuts = []
  let top = 0
  while (top < canvas.height - 4) {
    let bottom = Math.min(top + pagePx, canvas.height)
    if (bottom < canvas.height) bottom = blankRowAbove(ctx, canvas.width, bottom - Math.floor(pagePx * 0.2), bottom)
    cuts.push([top, bottom])
    top = bottom
  }

  const slice = document.createElement('canvas')
  slice.width = canvas.width
  cuts.forEach(([from, to], i) => {
    if (i) pdf.addPage()
    slice.height = to - from
    const sctx = slice.getContext('2d')
    sctx.fillStyle = '#ffffff'
    sctx.fillRect(0, 0, slice.width, slice.height)
    sctx.drawImage(canvas, 0, from, canvas.width, to - from, 0, 0, canvas.width, to - from)
    pdf.addImage(slice.toDataURL('image/jpeg', 0.82), 'JPEG', MARGIN, MARGIN, contentW, (to - from) / pxPerMm)
    pdf.setFontSize(8)
    pdf.setTextColor(140)
    pdf.text(`${footer}${footer ? '   ' : ''}${i + 1} / ${cuts.length}`, PAGE_W / 2, PAGE_H - 8, { align: 'center' })
  })
  return pdf.output('blob')
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
