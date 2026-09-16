import { useEffect, useState } from 'react'
import { isHeicUrl, viewablePhotoUrl } from '../lib/photoUrl'

export default function StorageImage({
  url,
  alt = 'photo',
  style,
  onClick,
  fit = 'cover',
  aspect,
}) {
  const [src, setSrc] = useState(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const displayUrl = viewablePhotoUrl(url)
  const heic = isHeicUrl(url)
  const contain = fit === 'contain'

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
        <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center' }}>Photo could not be displayed</div>
        <a href={displayUrl} target="_blank" rel="noreferrer" className="btn btn-sm">Open / download photo</a>
      </div>
    )
  }

  return (
    <div style={{
      position: 'relative',
      background: contain ? '#111827' : undefined,
      borderRadius: 8,
      overflow: 'hidden',
      aspectRatio: aspect,
      ...style,
    }}>
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: contain ? '#111827' : 'var(--surface2)', borderRadius: 8, fontSize: 12, color: 'var(--text3)',
        }}>
          Loading...
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
          height: contain || style?.height || aspect ? '100%' : 'auto',
          borderRadius: 8,
          objectFit: contain ? 'contain' : 'cover',
          objectPosition: 'center',
          cursor: onClick ? 'zoom-in' : 'default',
          display: loading ? 'none' : 'block',
          background: contain ? '#111827' : undefined,
        }}
      />
      {heic && !loading && !failed && (
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
          HEIC photo — open fullscreen if it does not display
        </div>
      )}
    </div>
  )
}
