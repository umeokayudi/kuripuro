/** Pack/parse extra before/after photos in the existing text columns. */

export const PHOTO_URL_SEP = '||'

export function parsePhotoUrls(value) {
  if (value == null) return []
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean)
  const raw = String(value).trim()
  if (!raw) return []
  if (raw.startsWith('[')) {
    try {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return arr.map(v => String(v || '').trim()).filter(Boolean)
    } catch { /* fall through */ }
  }
  if (raw.includes(PHOTO_URL_SEP)) return raw.split(PHOTO_URL_SEP).map(v => v.trim()).filter(Boolean)
  if (raw.includes('\n')) return raw.split('\n').map(v => v.trim()).filter(Boolean)
  return [raw]
}

export function packPhotoUrls(urls) {
  const list = parsePhotoUrls(urls)
  if (!list.length) return null
  if (list.length === 1) return list[0]
  return JSON.stringify(list)
}

export function primaryPhotoUrl(value) {
  return parsePhotoUrls(value)[0] || null
}

export function photoUrlCount(value) {
  return parsePhotoUrls(value).length
}
