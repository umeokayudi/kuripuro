/** Converte/comprime imagem para JPEG antes do upload (HEIC, PNG, etc.) */
export async function prepareImageForUpload(file) {
  if (!file) return null
  const name = (file.name || 'photo.jpg').replace(/\.[^.]+$/, '.jpg')

  if (file.type === 'image/jpeg' && file.size < 2_500_000) {
    return new File([file], name, { type: 'image/jpeg' })
  }

  try {
    const heic = /\.heic$/i.test(file.name) || /\.heif$/i.test(file.name)
      || ['image/heic', 'image/heif'].includes((file.type || '').toLowerCase())
    if (heic) {
      const { default: heic2any } = await import('heic2any')
      const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 })
      const blob = Array.isArray(converted) ? converted[0] : converted
      return new File([blob], name, { type: 'image/jpeg' })
    }
  } catch {
    // segue para canvas
  }

  try {
    const blob = await resizeToJpeg(file)
    if (blob) return new File([blob], name, { type: 'image/jpeg' })
  } catch {}

  return file
}

function resizeToJpeg(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      const max = 1600
      let { width, height } = img
      if (width > max || height > max) {
        const r = Math.min(max / width, max / height)
        width = Math.round(width * r)
        height = Math.round(height * r)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        blob => { URL.revokeObjectURL(objectUrl); resolve(blob) },
        'image/jpeg',
        0.85,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('decode failed')) }
    img.src = objectUrl
  })
}
