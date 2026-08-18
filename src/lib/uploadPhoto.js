import { supabase } from './supabase'
import { prepareImageForUpload } from './imageUpload'

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

/** Upload de foto para o bucket service-photos. Retorna o path (ex: jobs/xxx/start_0.jpg). */
export async function uploadJobPhoto(path, file) {
  const prepared = await prepareImageForUpload(file)
  const jpgPath = String(path).replace(/\.[^.]+$/, '.jpg')
  const buf = await prepared.arrayBuffer()

  try {
    const resp = await fetch('/api/upload-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: jpgPath,
        data: toBase64(buf),
        contentType: 'image/jpeg',
      }),
    })
    const result = await resp.json()
    if (resp.ok && result.path) return result.path
  } catch {
    // fallback abaixo
  }

  const { error } = await supabase.storage
    .from('service-photos')
    .upload(jpgPath, prepared, { upsert: true, contentType: 'image/jpeg' })

  if (error) throw new Error('Falha ao enviar foto: ' + error.message)
  return jpgPath
}
