const SUPABASE_HOST = (import.meta.env.VITE_SUPABASE_URL || 'https://fxsakrshmldmkdmbevna.supabase.co').replace(/^https?:\/\//, '')

export function isStoragePhotoUrl(url) {
  if (!url) return false
  if (url.startsWith('jobs/') || url.startsWith('claims/')) return true
  try {
    const host = new URL(url).host
    return host.includes('supabase.co') && url.includes('/storage/')
  } catch {
    return false
  }
}

/** URL que o navegador consegue carregar (proxy para bucket privado) */
export function viewablePhotoUrl(url) {
  if (!url) return null
  if (url.startsWith('data:') || url.startsWith('blob:')) return url
  if (isStoragePhotoUrl(url)) return `/api/photo?url=${encodeURIComponent(url)}`
  return url
}

export function isHeicUrl(url) {
  return /\.heic($|\?)/i.test(url || '') || /\.heif($|\?)/i.test(url || '')
}
