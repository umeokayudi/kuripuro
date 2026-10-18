// Compressão de vídeo no navegador (sem servidor): toca o arquivo num <video> fora da tela,
// desenha os quadros num canvas reduzido e grava com MediaRecorder em qualidade menor.
// Tudo com try/catch: se o aparelho não suportar (ex.: iOS antigo), usa o original quando é pequeno.

export const VIDEO_MAX_SECONDS = 90
const MAX_SIDE = 640
const FPS = 24
const VIDEO_BPS = 700_000
const AUDIO_BPS = 64_000
const SKIP_BYTES = 6 * 1024 * 1024       // já pequeno: envia como está
const MAX_RESULT_BYTES = 40 * 1024 * 1024
const MAX_ORIGINAL_BYTES = 25 * 1024 * 1024

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
]

export class VideoCompressError extends Error {
  constructor(code, message) {
    super(message || code)
    this.code = code // 'too_large' | 'not_video' | 'aborted'
  }
}

export function pickRecorderMime() {
  try {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null
    return MIME_CANDIDATES.find(m => MediaRecorder.isTypeSupported(m)) || null
  } catch {
    return null
  }
}

/** Tipo/extensão aceitos pelo upload (webm, mp4 ou mov do iPhone). */
export function videoTypeInfo(type, name = '') {
  const base = String(type || '').toLowerCase().split(';')[0].trim()
  if (base === 'video/webm') return { contentType: 'video/webm', ext: 'webm' }
  if (base === 'video/mp4' || base === 'video/x-m4v') return { contentType: 'video/mp4', ext: 'mp4' }
  if (base === 'video/quicktime') return { contentType: 'video/quicktime', ext: 'mov' }
  const ext = String(name).split('.').pop().toLowerCase()
  if (ext === 'webm') return { contentType: 'video/webm', ext: 'webm' }
  if (ext === 'mov') return { contentType: 'video/quicktime', ext: 'mov' }
  if (ext === 'mp4' || ext === 'm4v') return { contentType: 'video/mp4', ext: 'mp4' }
  return null
}

function originalResult(file) {
  const info = videoTypeInfo(file.type, file.name)
  if (!info) throw new VideoCompressError('not_video')
  if (file.size > MAX_ORIGINAL_BYTES) throw new VideoCompressError('too_large')
  return { blob: file, ...info, size: file.size, compressed: false }
}

function waitFor(el, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`timeout: ${event}`)) }, timeoutMs)
    const ok = () => { cleanup(); resolve() }
    const fail = () => { cleanup(); reject(new Error('video load error')) }
    const cleanup = () => { clearTimeout(timer); el.removeEventListener(event, ok); el.removeEventListener('error', fail) }
    el.addEventListener(event, ok, { once: true })
    el.addEventListener('error', fail, { once: true })
  })
}

/**
 * Comprime um vídeo escolhido pelo funcionário.
 * Chame direto do onChange do <input type=file> (gesto do usuário) para o áudio funcionar.
 * @returns {Promise<{blob: Blob, contentType: string, ext: string, size: number, compressed: boolean}>}
 */
export async function compressVideo(file, { onProgress, signal } = {}) {
  if (!file || !(String(file.type).startsWith('video/') || videoTypeInfo(file.type, file.name))) {
    throw new VideoCompressError('not_video')
  }
  if (file.size <= SKIP_BYTES && videoTypeInfo(file.type, file.name)) return originalResult(file)

  const mimeType = pickRecorderMime()
  const canCapture = typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function'
  if (!mimeType || !canCapture) return originalResult(file)

  // AudioContext criado já aqui, ainda dentro do gesto do usuário
  let audioCtx = null
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (Ctx) audioCtx = new Ctx()
  } catch { audioCtx = null }

  const src = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.playsInline = true
  video.setAttribute('playsinline', '')
  video.setAttribute('webkit-playsinline', '')
  video.preload = 'auto'
  video.src = src
  // Fora da tela, mas no DOM (Safari não decodifica quadros de vídeo solto)
  Object.assign(video.style, { position: 'fixed', left: '-10000px', top: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' })
  document.body.appendChild(video)

  let recorder = null
  let drawTimer = null
  let canvasStream = null
  const cleanup = () => {
    try { clearInterval(drawTimer) } catch { /* ignora */ }
    try { video.pause() } catch { /* ignora */ }
    try { canvasStream?.getTracks().forEach(t => t.stop()) } catch { /* ignora */ }
    try { audioCtx?.close() } catch { /* ignora */ }
    try { video.removeAttribute('src'); video.load() } catch { /* ignora */ }
    try { video.remove() } catch { /* ignora */ }
    URL.revokeObjectURL(src)
  }

  try {
    await waitFor(video, 'loadedmetadata', 15000)
    const w0 = video.videoWidth, h0 = video.videoHeight
    if (!w0 || !h0) throw new Error('no video track')
    const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(2, Math.round(w0 * scale / 2) * 2)
    canvas.height = Math.max(2, Math.round(h0 * scale / 2) * 2)
    const ctx = canvas.getContext('2d')
    canvasStream = canvas.captureStream(FPS)
    const tracks = [...canvasStream.getVideoTracks()]

    // Áudio: WebAudio (não toca no alto-falante) e, se não der, captureStream do próprio vídeo
    let hasAudio = false
    try {
      if (audioCtx) {
        const source = audioCtx.createMediaElementSource(video)
        const dest = audioCtx.createMediaStreamDestination()
        source.connect(dest)
        const at = dest.stream.getAudioTracks()
        if (at.length) { tracks.push(...at); hasAudio = true }
        if (audioCtx.state === 'suspended') await audioCtx.resume().catch(() => {})
      }
    } catch { hasAudio = false }
    if (!hasAudio) {
      try {
        const cap = video.captureStream?.() || video.mozCaptureStream?.()
        const at = cap?.getAudioTracks?.() || []
        if (at.length) { tracks.push(...at); hasAudio = true }
      } catch { /* sem áudio */ }
    }
    if (!hasAudio) video.muted = true

    const stream = new MediaStream(tracks)
    const chunks = []
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: VIDEO_BPS, audioBitsPerSecond: AUDIO_BPS })
    recorder.ondataavailable = ev => { if (ev.data && ev.data.size) chunks.push(ev.data) }
    const stopped = new Promise(resolve => { recorder.onstop = resolve })

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : VIDEO_MAX_SECONDS
    const limit = Math.min(duration, VIDEO_MAX_SECONDS)
    const draw = () => {
      try { ctx.drawImage(video, 0, 0, canvas.width, canvas.height) } catch { /* quadro ainda não pronto */ }
      onProgress?.(Math.min(1, video.currentTime / limit))
      if (video.currentTime >= VIDEO_MAX_SECONDS && recorder.state === 'recording') {
        video.pause()
        recorder.stop()
      }
    }

    try {
      await video.play()
    } catch {
      // Autoplay bloqueado: tenta sem som
      video.muted = true
      await video.play()
    }
    draw()
    recorder.start(1000)
    drawTimer = setInterval(draw, Math.round(1000 / FPS))

    await new Promise((resolve, reject) => {
      const onAbort = () => reject(new VideoCompressError('aborted'))
      if (signal?.aborted) return onAbort()
      signal?.addEventListener('abort', onAbort, { once: true })
      video.addEventListener('ended', resolve, { once: true })
      video.addEventListener('error', () => reject(new Error('video playback error')), { once: true })
      stopped.then(resolve)
    })
    if (recorder.state === 'recording') recorder.stop()
    await stopped
    onProgress?.(1)

    const outType = mimeType.split(';')[0]
    const blob = new Blob(chunks, { type: outType })
    cleanup()
    if (!blob.size) return originalResult(file)
    const info = videoTypeInfo(outType)
    // Se a "compressão" ficou maior que o original, ou grande demais, usa o original (se couber)
    if (blob.size >= file.size || blob.size > MAX_RESULT_BYTES) {
      try { return originalResult(file) } catch (err) {
        if (blob.size <= MAX_RESULT_BYTES) return { blob, ...info, size: blob.size, compressed: true }
        throw err
      }
    }
    return { blob, ...info, size: blob.size, compressed: true }
  } catch (err) {
    try { if (recorder && recorder.state !== 'inactive') recorder.stop() } catch { /* ignora */ }
    cleanup()
    if (err instanceof VideoCompressError) throw err
    console.warn('video compress fallback:', err?.message)
    return originalResult(file)
  }
}
