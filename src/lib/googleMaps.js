/**
 * Google Maps JavaScript API: chave e carregamento do script.
 * A chave vem da env da Vercel NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (ou VITE_GOOGLE_MAPS_API_KEY),
 * lida no build pelo Vite (envPrefix em vite.config.js). Sem chave, o mapa nem tenta carregar.
 */
export function mapsApiKey() {
  const env = import.meta.env || {}
  return String(env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || env.VITE_GOOGLE_MAPS_API_KEY || '').trim()
}

let loading = null
let authFailed = false
const authListeners = new Set()

/** Avisa quando o Google recusa a chave (chave errada, API desligada ou site fora da restrição). */
export function onMapsAuthFailure(fn) {
  if (authFailed) fn()
  authListeners.add(fn)
  return () => authListeners.delete(fn)
}

export function loadGoogleMaps(key, lang = 'ja') {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.google?.maps?.Map) return Promise.resolve(window.google)
  if (loading) return loading
  window.gm_authFailure = () => {
    authFailed = true
    authListeners.forEach(fn => fn())
  }
  loading = new Promise((resolve, reject) => {
    const cb = `__kpGmaps${Date.now()}`
    window[cb] = async () => {
      delete window[cb]
      try {
        const g = window.google
        if (g.maps.importLibrary) await Promise.all([g.maps.importLibrary('core'), g.maps.importLibrary('maps')])
        resolve(g)
      } catch (e) { loading = null; reject(e) }
    }
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&language=${encodeURIComponent(lang)}&region=JP&callback=${cb}&loading=async`
    s.async = true
    s.onerror = () => { loading = null; s.remove(); reject(new Error('Google Maps script failed')) }
    document.head.appendChild(s)
  })
  return loading
}
