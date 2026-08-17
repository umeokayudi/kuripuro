import { useEffect, useState } from 'react'
import { isHeicUrl, viewablePhotoUrl } from '../lib/photoUrl'

export default function StorageImage({ url, alt = 'foto', style, onClick }) {
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

  if (failed) {
    return (
      <div style={{
        ...style,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--surface2)',
        borderRadius: 8,
        padding: 12,
        gap: 8,
        minHeight: 120,
      }}>
        <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>Não foi possível exibir a foto</div>
        <a href={displayUrl} target="_blank" rel="noreferrer" className="btn btn-sm">Abrir / baixar foto</a>
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
