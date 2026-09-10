import StorageImage from './StorageImage'

const thumbStyle = (size) => ({
  width: size,
  height: size,
  borderRadius: 6,
  objectFit: 'cover',
  cursor: 'pointer',
  border: '1px solid var(--border)',
  flexShrink: 0,
})

/**
 * Before/after job photos — compact thumbnails or full grid with labels.
 */
export default function JobPhotos({
  photoStartUrl,
  photoEndUrl,
  beforeLabel = 'Before',
  afterLabel = 'After',
  variant = 'compact',
  size = 56,
  onPhotoClick,
  style,
}) {
  if (!photoStartUrl && !photoEndUrl) return null

  if (variant === 'compact') {
    const items = [
      photoStartUrl && { url: photoStartUrl, label: beforeLabel },
      photoEndUrl && { url: photoEndUrl, label: afterLabel },
    ].filter(Boolean)

    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', ...style }}>
        {items.map(({ url, label }) => (
          <StorageImage
            key={url}
            url={url}
            alt={label}
            onClick={onPhotoClick ? (e) => { e?.stopPropagation?.(); onPhotoClick(url) } : undefined}
            style={thumbStyle(size)}
          />
        ))}
      </div>
    )
  }

  return (
    <div style={style}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {photoStartUrl && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>{beforeLabel}</div>
            <StorageImage url={photoStartUrl} alt={beforeLabel} onClick={onPhotoClick ? () => onPhotoClick(photoStartUrl) : undefined} />
          </div>
        )}
        {photoEndUrl && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>{afterLabel}</div>
            <StorageImage url={photoEndUrl} alt={afterLabel} onClick={onPhotoClick ? () => onPhotoClick(photoEndUrl) : undefined} />
          </div>
        )}
      </div>
    </div>
  )
}
