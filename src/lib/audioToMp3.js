// v1.0.212 · Voice recordings → MP3 before they go to the AI.
// Phones record audio/webm (Chrome/Android) or audio/mp4 (iPhone). The Meta Model API (Muse)
// only reads MP3 or WAV, so the browser converts the recording here: mono, 16 kHz, 32 kbps
// (5 minutes ≈ 1.2 MB, smaller than the original). Gemini reads MP3 too, so this works with
// either provider. If the browser cannot decode the file, the original goes as before.

const RATE = 16000
const KBPS = 32

export async function toMp3(blob) {
  const type = String(blob?.type || '').toLowerCase()
  if (!blob || /audio\/(mpeg|mp3|wav|x-wav|wave)/.test(type)) return blob
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext
    if (!Ctx || !Offline) return blob
    const ctx = new Ctx()
    const buffer = await blob.arrayBuffer()
    // old Safari only has the callback form; new browsers return a promise
    const decoded = await new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(buffer, resolve, reject)
      if (p && typeof p.then === 'function') p.then(resolve, reject)
    })
    ctx.close?.()
    const frames = Math.max(1, Math.ceil(decoded.duration * RATE))
    const offline = new Offline(1, frames, RATE)
    const src = offline.createBufferSource()
    src.buffer = decoded
    src.connect(offline.destination)
    src.start(0)
    const rendered = await offline.startRendering()
    const f32 = rendered.getChannelData(0)
    const pcm = new Int16Array(f32.length)
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]))
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    const { Mp3Encoder } = await import('@breezystack/lamejs')
    const encoder = new Mp3Encoder(1, RATE, KBPS)
    const out = []
    for (let i = 0; i < pcm.length; i += 1152) {
      const chunk = encoder.encodeBuffer(pcm.subarray(i, i + 1152))
      if (chunk.length) out.push(new Uint8Array(chunk))
    }
    const end = encoder.flush()
    if (end.length) out.push(new Uint8Array(end))
    const mp3 = new Blob(out, { type: 'audio/mpeg' })
    return mp3.size > 200 ? mp3 : blob
  } catch {
    return blob
  }
}
