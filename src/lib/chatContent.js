// A chat message is plain text; a photo is sent as "[photo] <storage path>".
const PHOTO_RE = /^\[photo\]\s+(\S+)$/

export const photoMessage = path => `[photo] ${path}`

export function chatPhoto(content) {
  const m = PHOTO_RE.exec(String(content || '').trim())
  return m ? m[1] : null
}

/** Short text for lists and toasts. */
export function chatPreview(content, photoLabel = '📷') {
  // markers (#job:<id>, #rate:<id>) are for the app, not for people
  return chatPhoto(content) ? photoLabel : String(content || '').replace(/\n?#(job|rate):[\w-]+\s*$/, '').trim()
}

/** Day label key for grouping: YYYY-MM-DD in Tokyo time. */
export function chatDayKey(iso) {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
}
