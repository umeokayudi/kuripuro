import StorageImage from './StorageImage'

const thumbStyle = (size) => ({
  width: size,
  height: size,
  borderRadius: 6,
  cursor: 'pointer',
  border: '1px solid var(--border)',
  flexShrink: 0,
  overflow: 'hidden',
})

/**
 * Before/after job photos — compact thumbnails or a contained 3:4 comparison grid.
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

  const open = (url, urls) => {
    if (!onPhotoClick) return
    onPhotoClick({ url, urls })
  }

  if (variant === 'compact') {
    const items = [
      photoStartUrl && { url: photoStartUrl, label: beforeLabel },
      photoEndUrl && { url: photoEndUrl, label: afterLabel },
    ].filter(Boolean)
    const urls = items.map(item => item.url)

    return (
      <div className="jp-thumbs" style={style}>
        {items.map(({ url, label }) => (
          <StorageImage
            key={url}
            url={url}
            alt={label}
            fit="cover"
            onClick={onPhotoClick ? (e) => { e?.stopPropagation?.(); open(url, urls) } : undefined}
            style={thumbStyle(size)}
          />
        ))}
      </div>
    )
  }

  const urls = [photoStartUrl, photoEndUrl].filter(Boolean)
  const cols = photoStartUrl && photoEndUrl ? 'jp-compare' : 'jp-compare jp-compare-one'

  return (
    <div className={cols} style={style}>
      {photoStartUrl && (
        <figure className="jp-figure">
          <div className="jp-figure-label">{beforeLabel}</div>
          <div className="jp-frame">
            <StorageImage
              url={photoStartUrl}
              alt={beforeLabel}
              fit="contain"
              onClick={onPhotoClick ? () => open(photoStartUrl, urls) : undefined}
              style={{ width: '100%', height: '100%' }}
            />
          </div>
        </figure>
      )}
      {photoEndUrl && (
        <figure className="jp-figure">
          <div className="jp-figure-label">{afterLabel}</div>
          <div className="jp-frame">
            <StorageImage
              url={photoEndUrl}
              alt={afterLabel}
              fit="contain"
              onClick={onPhotoClick ? () => open(photoEndUrl, urls) : undefined}
              style={{ width: '100%', height: '100%' }}
            />
          </div>
        </figure>
      )}
    </div>
  )
}
