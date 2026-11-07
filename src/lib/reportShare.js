// v1.0.186 · "Enviar PDF + vídeo": the service report as a real PDF file together with the video
// files of the service, in one go. On the phone it opens the share sheet (LINE, WhatsApp, Mail…)
// with every file attached; where files cannot be shared (most computers) it downloads them.
// The PDF itself has, for each video, its cover, a QR code and a link that opens the video.
import { contractPdfBlob, downloadBlob } from './contractPdf'
import { reportHtml, storagePublicUrl } from './workReport'
import { isVideoPath } from './workMedia'

// Bigger than this and LINE/WhatsApp refuse or the phone runs out of memory: the link in the PDF still works.
export const MAX_SHARE_BYTES = 80 * 1024 * 1024

const isVideo = p => p && (p.kind === 'video' || isVideoPath(p.path))

/** Every video in the report (service photos + period/day services), once, in order. */
export function reportVideos(r) {
  if (!r) return []
  const all = [
    ...(r.photos || []),
    ...(r.stores || []).flatMap(st => (st.services || []).filter(sv => sv.include !== false).flatMap(sv => sv.media || [])),
  ].filter(p => isVideo(p) && p.include !== false && p.path)
  const seen = new Set()
  return all.filter(p => (seen.has(p.path) ? false : seen.add(p.path))).map(p => ({ path: p.path, url: storagePublicUrl(p.path) }))
}

const safe = s => String(s || '').normalize('NFKC').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60)

export function reportBaseName(r) {
  const doc = r?.lang === 'pt' ? 'relatorio' : r?.lang === 'en' ? 'report' : '作業報告書'
  return [doc, safe(r?.location || r?.title || r?.client_name), r?.work_date || r?.day?.date || r?.to || ''].filter(Boolean).join('_')
}

/** The PDF exactly like the print version (video → cover + QR + link). */
export async function reportPdfFile(r, html = reportHtml(r)) {
  // lazy images never load in the hidden frame the PDF is drawn from → load them all now
  const ready = String(html).replace(/\sloading="lazy"/g, '')
  const blob = await contractPdfBlob(ready.replace(/<body(\s[^>]*)?>/i, m => (/class=/.test(m) ? m.replace(/class="/, 'class="as-pdf ') : m.replace('<body', '<body class="as-pdf"'))))
  return new File([blob], `${reportBaseName(r)}.pdf`, { type: 'application/pdf' })
}

async function videoFile(v, i, base) {
  const res = await fetch(v.url)
  if (!res.ok) throw new Error(`video ${res.status}`)
  const blob = await res.blob()
  const ext = (String(v.path).split('.').pop() || 'mp4').toLowerCase()
  return new File([blob], `${base}_video${i + 1}.${ext}`, { type: blob.type || (ext === 'mov' ? 'video/quicktime' : 'video/mp4') })
}

export function shareText(r, videos, tr) {
  const name = [r?.client_name, r?.location].filter(Boolean).join(' ')
  const head = tr(`Service report — ${name} ${r?.work_date || ''}`, `作業報告書 — ${name}様 ${r?.work_date || ''}`, `Relatório de serviço — ${name} ${r?.work_date || ''}`).trim()
  if (!videos.length) return head
  const lines = videos.map((v, i) => `${tr('Video', '動画', 'Vídeo')}${videos.length > 1 ? ` ${i + 1}` : ''}: ${v.url}`)
  return [head, ...lines].join('\n')
}

/**
 * Builds the files. Returns { files, pdf, videos, skipped } — `skipped` = videos left out because
 * they could not be downloaded or the total got too big (their link is in the PDF and the text).
 */
export async function prepareReportShare(r, { html, onStep } = {}) {
  onStep?.('pdf')
  const pdf = await reportPdfFile(r, html)
  const videos = reportVideos(r)
  const files = [pdf]
  const skipped = []
  let total = pdf.size
  const base = reportBaseName(r)
  for (let i = 0; i < videos.length; i++) {
    onStep?.('video', i + 1, videos.length)
    try {
      const f = await videoFile(videos[i], i, base)
      if (total + f.size > MAX_SHARE_BYTES) { skipped.push(videos[i]); continue }
      total += f.size
      files.push(f)
    } catch {
      skipped.push(videos[i])
    }
  }
  return { files, pdf, videos, skipped }
}

export const canShareFiles = files => {
  try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files })) } catch { return false }
}

/**
 * Opens the share sheet with the files (must run right after a tap on iPhone). Falls back to
 * only the PDF when the phone refuses the videos. Returns 'shared' | 'cancelled' | 'unsupported' | 'blocked'.
 */
export async function shareFiles(files, { title, text } = {}) {
  const tries = [files, files.slice(0, 1)]
  for (const set of tries) {
    if (!canShareFiles(set)) continue
    try {
      await navigator.share({ files: set, title, text })
      return set.length === files.length ? 'shared' : 'shared-pdf-only'
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled'
      if (e?.name === 'NotAllowedError') return 'blocked' // the tap "expired" while preparing → ask for one more tap
    }
  }
  return 'unsupported'
}

/** Computer: save the PDF and the videos on this device. */
export function downloadFiles(files) {
  files.forEach((f, i) => setTimeout(() => downloadBlob(f, f.name), i * 400))
}
