// v1.0.174 · Employee face photo ("Meu perfil" → Tirar foto / Escolher da galeria).
// No SQL: one small square JPEG per employee in the public service-photos bucket,
//   employee-faces/<employeeId>.jpg
// Shown as the avatar (employee greeting header, Meu perfil, admin Employees list and profile).
// If the file is missing the <img> fails and the initials are shown instead.
import { supabase } from './supabase'
import { storagePublicUrl } from './workReport'

const BUCKET = 'service-photos'
const SIZE = 512
const LS = 'kp_face_v_'
const listeners = new Set()

export const facePath = id => `employee-faces/${id}.jpg`

// Cache-busting version: the time of the last change made on this device, or the current hour
// (other devices see a new photo within the hour; cacheControl on upload is short too).
export function faceVersion(id) {
  try { const v = localStorage.getItem(LS + id); if (v) return v } catch { /* private mode */ }
  return String(Math.floor(Date.now() / 3_600_000))
}

export function faceUrl(id) {
  if (!id) return ''
  return `${storagePublicUrl(facePath(id))}?v=${faceVersion(id)}`
}

function bump(id, removed = false) {
  const v = removed ? `x${Date.now()}` : String(Date.now())
  try { localStorage.setItem(LS + id, v) } catch { /* ignore */ }
  listeners.forEach(fn => { try { fn(id) } catch { /* ignore */ } })
}

export function onFaceChange(fn) { listeners.add(fn); return () => listeners.delete(fn) }

// Center-crop to a square and shrink to 512×512 JPEG (front camera photos are often 3–5 MB).
export async function squareFace(file) {
  let src = file
  const heic = /\.hei[cf]$/i.test(file?.name || '') || /image\/hei[cf]/i.test(file?.type || '')
  if (heic) {
    try {
      const { default: heic2any } = await import('heic2any')
      const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
      src = Array.isArray(out) ? out[0] : out
    } catch { /* try the browser */ }
  }
  const url = URL.createObjectURL(src)
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Não deu para abrir a foto')); i.src = url })
    const s = Math.min(img.naturalWidth, img.naturalHeight)
    const sx = (img.naturalWidth - s) / 2
    // faces sit in the upper part of a portrait photo: crop a bit higher than the middle
    const sy = img.naturalHeight > img.naturalWidth ? Math.max(0, (img.naturalHeight - s) * 0.3) : (img.naturalHeight - s) / 2
    const c = document.createElement('canvas')
    c.width = SIZE; c.height = SIZE
    c.getContext('2d').drawImage(img, sx, sy, s, s, 0, 0, SIZE, SIZE)
    return await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Não deu para preparar a foto')), 'image/jpeg', 0.86))
  } finally { URL.revokeObjectURL(url) }
}

export async function saveFace(id, file) {
  if (!id || !file) throw new Error('Foto?')
  const blob = await squareFace(file)
  const { error } = await supabase.storage.from(BUCKET).upload(facePath(id), blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '300' })
  if (error) throw new Error(error.message)
  bump(id)
  return faceUrl(id)
}

export async function removeFace(id) {
  const { error } = await supabase.storage.from(BUCKET).remove([facePath(id)])
  if (error) throw new Error(error.message)
  bump(id, true)
}
