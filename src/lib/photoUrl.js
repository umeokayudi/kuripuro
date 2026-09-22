import { primaryPhotoUrl } from './jobPhotoUrls'

export function isStoragePhotoUrl(url) {
  if (!url) return false
  const raw = primaryPhotoUrl(url) || String(url)
  if (raw.startsWith('jobs/') || raw.startsWith('claims/')) return true
  try {
    const host = new URL(raw).host
    return host.includes('supabase.co') && raw.includes('/storage/')
  } catch {
    return false
  }
}

/** URL que o navegador consegue carregar (proxy para bucket privado) */
export function viewablePhotoUrl(url) {
  const raw = primaryPhotoUrl(url) || url
  if (!raw) return null
  if (String(raw).startsWith('data:') || String(raw).startsWith('blob:')) return raw
  if (isStoragePhotoUrl(raw)) return `/api/photo?url=${encodeURIComponent(raw)}`
  return raw
}

export function isHeicUrl(url) {
  const raw = primaryPhotoUrl(url) || url
  return /\.heic($|\?)/i.test(raw || '') || /\.heif($|\?)/i.test(raw || '')
}
