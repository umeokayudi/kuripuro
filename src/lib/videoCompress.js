// Compressão de vídeo no navegador (sem servidor).
// 1) Caminho rápido: WebCodecs (Mediabunny) decodifica e recodifica em H.264 720p, bem mais
//    rápido que o tempo real (um vídeo de 60s leva poucos segundos num celular recente).
// 2) Reserva: toca o arquivo num <video> fora da tela, desenha os quadros num canvas reduzido e
//    grava com MediaRecorder (leva o tempo do vídeo).
// Tudo com try/catch: se o aparelho não suportar nada disso, usa o original quando cabe.

export const VIDEO_MAX_SECONDS = 60
const MAX_SIDE = 720
const FPS = 24
const VIDEO_BPS = 1_500_000
const AUDIO_BPS = 64_000
const SKIP_BYTES = 4 * 1024 * 1024       // já pequeno: envia como está
const MAX_RESULT_BYTES = 40 * 1024 * 1024
// O vídeo vai direto ao Storage (URL assinada), então o limite é o do Supabase (50 MB), não o da Vercel
const MAX_ORIGINAL_BYTES = 45 * 1024 * 1024
// Caminho rápido (WebCodecs)
const FAST_MAX_SIDE = 720
const FAST_FPS = 30
const FAST_VIDEO_BPS = 2_000_000 // ~2 Mbps H.264, 720p, max 60 s
const FAST_AUDIO_BPS = 64_000
const COPY_AUDIO = new Set(['aac', 'opus', 'mp3'])

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
    this.code = code // 'too_large' | 'not_video' | 'aborted' | 'too_long'
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

const even = (n) => Math.max(2, Math.round(n / 2) * 2)

/** Tamanho de saída: lado maior até `maxSide`, sem aumentar, sempre par (exigência do H.264). */
export function targetSize(width, height, maxSide = FAST_MAX_SIDE) {
  if (!width || !height) return null
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return { width: even(width * scale), height: even(height * scale) }
}

export function canUseWebCodecs() {
  return typeof window !== 'undefined' && typeof window.VideoEncoder === 'function' && typeof window.VideoDecoder === 'function'
}

/**
 * Caminho rápido com WebCodecs. Devolve null quando o aparelho não consegue (aí usamos o MediaRecorder).
 * A biblioteca só é baixada quando alguém escolhe um vídeo.
 */
async function compressWithWebCodecs(file, { onProgress, signal }) {
  if (!canUseWebCodecs()) return null
  const mb = await import('mediabunny')
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS })
  let conversion = null
  const onAbort = () => { conversion?.cancel().catch(() => {}) }
  try {
    const videoTrack = await input.getPrimaryVideoTrack()
    if (!videoTrack || !(await videoTrack.canDecode())) return null
    const size = targetSize(videoTrack.displayWidth, videoTrack.displayHeight)
    if (!size) return null
    const bitrate = FAST_VIDEO_BPS
    const videoCodec = await mb.getFirstEncodableVideoCodec(['avc'], { ...size, bitrate })
    if (!videoCodec) return null
    const audioTrack = await input.getPrimaryAudioTrack().catch(() => null)
    const audioCodec = audioTrack && (await audioTrack.canDecode().catch(() => false))
      ? await mb.getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: Math.min(2, audioTrack.numberOfChannels || 2), sampleRate: 48000, bitrate: FAST_AUDIO_BPS }).catch(() => null)
      : null

    const duration = await input.computeDuration().catch(() => 0)
    const end = duration > 0 ? Math.min(duration, VIDEO_MAX_SECONDS) : VIDEO_MAX_SECONDS
    const target = new mb.BufferTarget()
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target })
    conversion = await mb.Conversion.init({
      input,
      output,
      tracks: 'primary',
      trim: { start: 0, end },
      showWarnings: false,
      video: { ...size, fit: 'contain', codec: videoCodec, bitrate, frameRate: FAST_FPS, forceTranscode: true },
      // Áudio AAC do celular é copiado como está (é pequeno); sem codificador, tenta copiar também
      audio: !audioTrack ? { discard: true }
        : (COPY_AUDIO.has(audioTrack.codec) || !audioCodec) ? {}
          : { codec: audioCodec, bitrate: FAST_AUDIO_BPS },
    })
    if (!conversion.isValid || !conversion.utilizedTracks.some(t => t.type === 'video')) return null
    conversion.onProgress = (p) => onProgress?.(Math.min(1, Math.max(0, p)))
    if (signal?.aborted) throw new VideoCompressError('aborted')
    signal?.addEventListener('abort', onAbort, { once: true })
    await conversion.execute()
    if (signal?.aborted) throw new VideoCompressError('aborted')
    const buffer = target.buffer
    if (!buffer || !buffer.byteLength) return null
    const blob = new Blob([buffer], { type: 'video/mp4' })
    onProgress?.(1)
    return { blob, contentType: 'video/mp4', ext: 'mp4', size: blob.size, compressed: true }
  } catch (err) {
    if (signal?.aborted || err instanceof VideoCompressError || err?.name === 'ConversionCanceledError') throw new VideoCompressError('aborted')
    console.warn('webcodecs compress fallback:', err?.message)
    return null
  } finally {
    signal?.removeEventListener('abort', onAbort)
    try { input.dispose() } catch { /* ignora */ }
  }
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

  const fast = await compressWithWebCodecs(file, { onProgress, signal })
  if (fast && fast.size < file.size) return fast
  if (fast) {
    try { return originalResult(file) } catch { return fast }
  }
  onProgress?.(0)

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
