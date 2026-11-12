// v1.0.211 · Images attached to a 見積書 (e.g. a demonstration sheet), shown to the client in the portal
// together with the quote. No SQL: files live in the public service-photos bucket next to the quote's
// history — service-photos/quotes/<quoteId>/attachments/<name>.jpg — and are listed from Storage.
import { supabase } from './supabase'
import { uploadJobPhoto } from './uploadPhoto'
import { quoteFolder, storageUrl } from './quoteHistory'

const BUCKET = 'service-photos'
const validId = id => /^[\w-]{6,64}$/.test(String(id || ''))
const dir = id => `${quoteFolder(id)}/attachments`

/** [{ path, url, name, at }] newest last. Never throws. */
export async function listQuoteAttachments(id) {
  if (!validId(id)) return []
  try {
    const { data, error } = await supabase.storage.from(BUCKET).list(dir(id), { limit: 100, sortBy: { column: 'name', order: 'asc' } })
    if (error) return []
    return (data || []).filter(f => f.name && !f.name.startsWith('.') && f.id !== null)
      .map(f => ({ path: `${dir(id)}/${f.name}`, url: storageUrl(`${dir(id)}/${f.name}`), name: f.name, at: f.created_at || '' }))
  } catch { return [] }
}

export async function uploadQuoteAttachment(id, file) {
  if (!validId(id)) throw new Error('Salve o orçamento antes de anexar imagens.')
  if (!/^image\//.test(file?.type || '')) throw new Error('Só imagens (JPG, PNG, HEIC…).')
  return uploadJobPhoto(`${dir(id)}/img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`, file)
}

export async function deleteQuoteAttachment(path) {
  if (!String(path).includes('/attachments/')) throw new Error('path')
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw new Error(error.message)
}
