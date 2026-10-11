// Signatures are stored as PNG data URLs in jobs.signature_url / service_reports.signature_url.
// Until v1.0.13 the pad drew WHITE strokes on a TRANSPARENT background, so on a white
// report or PDF the signature looked blank. New signatures are dark ink on white.
// signatureForDisplay() turns the old ones into dark ink on white so every report shows them.

export const SIGNATURE_INK = '#0f2747'

const cache = new Map()

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/** Returns a data URL with dark strokes on a white background (or null). */
export async function signatureForDisplay(url) {
  if (!url) return null
  if (cache.has(url)) return cache.get(url)
  const job = (async () => {
    try {
      const img = await loadImage(url)
      const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height
      if (!w || !h) return url
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, w, h)
      const px = data.data
      // Opaque corner = already ink on paper (new format): keep as is.
      if (px[3] === 255) return url
      for (let i = 0; i < px.length; i += 4) {
        const a = px[i + 3] / 255
        // Ink alpha -> dark ink blended on white
        px[i] = Math.round(255 - (255 - 15) * a)
        px[i + 1] = Math.round(255 - (255 - 39) * a)
        px[i + 2] = Math.round(255 - (255 - 71) * a)
        px[i + 3] = 255
      }
      ctx.putImageData(data, 0, 0)
      return canvas.toDataURL('image/png')
    } catch {
      return url
    }
  })()
  cache.set(url, job)
  return job
}
