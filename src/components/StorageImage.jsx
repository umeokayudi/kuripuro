import { useEffect, useState } from 'react'
import { isHeicUrl, viewablePhotoUrl } from '../lib/photoUrl'
import { useLang } from '../hooks/useLang'

export default function StorageImage({ url, alt = 'foto', style, onClick }) {
  const { tr } = useLang()
  const [src, setSrc] = useState(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const displayUrl = viewablePhotoUrl(url)
  const heic = isHeicUrl(url)

  useEffect(() => {
    setFailed(false)
    setLoading(true)
    setSrc(displayUrl)
  }, [displayUrl])

  if (!url) return null

  if (failed && style?.width && Number(style.width) <= 100) {
    const label = tr('Open photo', '写真を開く', 'Abrir foto')
    return (
      <a href={displayUrl} target="_blank" rel="noreferrer" className="storage-image-failed-compact"
        title={label} aria-label={label}
        style={{ width: Number(style.width), height: Number(style.width) }}>
        <span aria-hidden="true">▧</span><small>↗</small>
      </a>
    )
  }

  if (failed) {
    return (
      <div className="storage-image-failed" style={{
        width: style?.width && Number(style.width) <= 100 ? 'min(100%, 220px)' : style?.width,
        minWidth: style?.width && Number(style.width) <= 100 ? 180 : undefined,
        height: 'auto', minHeight: 92, flexShrink: 0,
      }}>
        <span aria-hidden="true" className="storage-image-failed-icon">▧</span>
        <div className="storage-image-failed-copy">{tr('Photo preview unavailable', '写真をプレビューできません', 'Pré-visualização da foto indisponível')}</div>
        <a href={displayUrl} target="_blank" rel="noreferrer" className="storage-image-failed-link">{tr('Open photo ↗', '写真を開く ↗', 'Abrir foto ↗')}</a>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', ...style }}>
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--surface2)', borderRadius: 8, fontSize: 12, color: 'var(--text3)',
        }}>
          Carregando...
        </div>
      )}
      <img
        src={src}
        alt={alt}
        onLoad={() => setLoading(false)}
        onError={() => { setLoading(false); setFailed(true) }}
        onClick={onClick}
        style={{
          width: '100%',
          borderRadius: 8,
          objectFit: 'cover',
          aspectRatio: '1',
          cursor: onClick ? 'zoom-in' : 'default',
          display: loading ? 'none' : 'block',
        }}
      />
      {heic && !loading && !failed && (
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
          Foto HEIC — se não aparecer, use o botão abaixo
        </div>
      )}
    </div>
  )
}
