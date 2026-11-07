// v1.0.186 · A PDF cannot play a video (phones and PDF readers do not open video inside the file),
// so every video of a service report gets, in the printed / PDF version, its cover picture with ▶,
// a QR code and a clickable "Watch video" link to the video's permanent public address.
// On screen (app, client portal) the video still plays in place, with the same link under it.
import QRCode from 'qrcode'
import { escapeHtml as esc } from './escapeHtml'

const LABEL = {
  ja: { watch: '▶ 動画を見る', hint: 'リンクをタップ、またはQRコードをスマホで読み取ると再生できます' },
  en: { watch: '▶ Watch video', hint: 'Tap the link or scan the QR code with your phone to play it' },
  pt: { watch: '▶ Assistir vídeo', hint: 'Toque no link ou leia o QR code com o celular para assistir' },
}
export const videoLabels = lang => LABEL[lang] || LABEL.ja

/** QR code as an inline SVG string (synchronous, works in the browser and in tests). */
export function qrSvg(text, { size = 72 } = {}) {
  try {
    const { modules } = QRCode.create(String(text || ''), { errorCorrectionLevel: 'M' })
    const n = modules.size
    const q = 2 // quiet zone
    let d = ''
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) if (modules.get(y, x)) d += `M${x + q} ${y + q}h1v1h-1z`
    }
    const w = n + q * 2
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${w} ${w}" shape-rendering="crispEdges"><rect width="${w}" height="${w}" fill="#fff"/><path d="${d}" fill="#0c1c30"/></svg>`
    // as an <img> (data URL): the in-app PDF maker (html2canvas) draws images, not inline SVG
    const b64 = typeof btoa === 'function' ? btoa(svg) : Buffer.from(svg).toString('base64')
    return `<img src="data:image/svg+xml;base64,${b64}" width="${size}" height="${size}" alt="QR">`
  } catch {
    return ''
  }
}

/** Cover picture saved next to each video when it was uploaded (jobs/<id>/video_n.jpg). */
export const posterUrlOf = url => String(url || '').replace(/\.(mp4|webm|mov|m4v)(\?.*)?$/i, '.jpg')

/** Inner HTML of one video cell of the report grid. */
export function videoCellHtml(url, lang) {
  const L = videoLabels(lang)
  const u = esc(url)
  return `<video src="${u}#t=0.5" controls playsinline preload="metadata"></video><span class="vtag">▶</span>`
    + `<a class="vlink" href="${u}" target="_blank" rel="noopener">`
    + `<span class="vposter"><img src="${esc(posterUrlOf(url))}" alt="" onerror="this.style.display='none'"><b>▶</b></span>`
    + `<span class="vrow"><span class="vqr">${qrSvg(url)}</span><span class="vtxt"><b>${esc(L.watch)}</b><small>${esc(L.hint)}</small></span></span>`
    + '</a>'
}

/**
 * CSS for the video cells. `.as-pdf` on <body> (used when the app builds the PDF file itself)
 * gives the same look as the browser's print / "save as PDF".
 */
const PRINT_RULES = sel => `${sel} .vid video,${sel} .vid .vtag{display:none}
${sel} .vqr{display:block}
${sel} .vlink{display:block}
${sel} .vposter{display:block;position:relative;height:0;padding-top:133.33%;background:#1f3a5f;overflow:hidden}
${sel} .vposter img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block}
${sel} .vposter b{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:44px;height:44px;line-height:44px;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;font-size:20px;text-align:center;padding-left:3px}
${sel} .vrow{display:flex;gap:6px;align-items:center;margin-top:4px}
${sel} .vqr img{display:block;width:70px;height:70px;aspect-ratio:auto;flex:0 0 70px}
${sel} .vtxt small{display:block;font-size:8.5px;line-height:1.35;color:#556;margin-top:1px}`

export const VIDEO_STYLE = `.vlink{display:inline-block;margin-top:3px;color:#1f5fbf;font-size:11px;text-decoration:underline;word-break:break-all}
.vposter,.vqr,.vtxt small{display:none}
.vtxt b{font-weight:600}
${PRINT_RULES('.as-pdf')}
@media print{${PRINT_RULES('body')}
.vlink{color:#1f5fbf;text-decoration:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}.vposter{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`
